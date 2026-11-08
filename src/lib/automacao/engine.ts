import "server-only";
import { db, logEvent } from "../db";
import { authForAccount, authOf, getProfile } from "../profiles";
import { accountInfo, businessPixelIds, getProduct, listAccountCatalogs, listAccountPixels, listCustomAudiences, pixelOwner, sharePixel } from "./meta-ads";
import { getMediaMany, resolveCovers, type MediaAsset } from "./media";
import { normalizeDraft, validateDraft, type DraftData } from "./types";
import { createRun, kick, retryRun, tick, type JobSpec } from "./queue";
import "./executors"; // registra o que cada operação faz

export { tick, kick, retryRun, cancelRun, getRunView, listRuns, jobCounts } from "./queue";

// =====================================================================
// Entrada da Automação de Campanhas: monta os processos e põe na fila.
// =====================================================================

export interface DraftRow {
  id: string;
  name: string;
  account_id: string | null;
  step: number;
  data: DraftData;
  status: "draft" | "queued" | "published" | "failed";
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const { data } = await db().from("auto_drafts").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return { ...(data as DraftRow), data: normalizeDraft(data.data, data.account_id ?? "") };
}

export async function listDrafts(limit = 30): Promise<DraftRow[]> {
  const { data } = await db().from("auto_drafts").select("*").order("updated_at", { ascending: false }).limit(limit);
  return (data ?? []).map((d: any) => ({ ...d, data: normalizeDraft(d.data, d.account_id ?? "") }));
}

const baseName = (n: string) => n.replace(/\.[a-z0-9]+$/i, "");

function adNameFor(pattern: string, n: number, media: string | null, total: number) {
  const name = (pattern || "{midia}").replace(/\{n\}/g, String(n)).replace(/\{midia\}/g, media ? baseName(media) : `Anúncio ${n}`).trim();
  return total > 1 && !/\{n\}|\{midia\}/.test(pattern) ? `${name} ${n}` : name || `Anúncio ${n}`;
}

/** Validação completa antes de publicar: campos + permissões da conexão existente. */
export async function checkBeforePublish(d: DraftData): Promise<string[]> {
  const v = validateDraft(d);
  const errors = [...v[1], ...v[2], ...v[3]];
  if (errors.length) return errors;

  const { data: acc } = await db().from("ad_accounts").select("id,name,account_status,profile_id").eq("id", d.accountId).maybeSingle();
  if (!acc) return ["Conta de anúncio não encontrada nas conexões. Sincronize em Perfis Meta."];
  if (acc.account_status && acc.account_status !== 1) errors.push(`A conta ${acc.name} não está ativa na Meta (status ${acc.account_status}).`);
  const profile = await getProfile(acc.profile_id);
  if (!profile) errors.push("A conta não tem perfil Meta conectado.");
  else {
    if (profile.status === "error") errors.push(`O token do perfil ${profile.name} está com erro: ${profile.last_error ?? "reconecte em Perfis Meta"}.`);
    if (profile.scopes.length && !profile.scopes.includes("ads_management")) errors.push(`O perfil ${profile.name} não tem a permissão ads_management (necessária para criar campanhas).`);
  }

  const { data: page } = await db().from("fb_pages").select("name,tasks").eq("page_id", d.creative.pageId).maybeSingle();
  if (page?.tasks?.length && !page.tasks.includes("ADVERTISE") && !page.tasks.includes("MANAGE")) {
    errors.push(`Seu perfil não tem permissão de anunciar com a Página ${page.name}.`);
  }
  const autoCatalog = d.creative.mode === "catalog" && d.catalog.source === "auto";
  if (d.creative.mode === "media" || autoCatalog) {
    const media = await getMediaMany(d.creative.mediaIds);
    if (media.length !== d.creative.mediaIds.length) errors.push("Alguma mídia escolhida foi excluída da biblioteca.");
    if (media.some((m) => m.status !== "ready")) errors.push("Alguma mídia ainda não terminou de enviar.");
    if (autoCatalog) {
      const videos = media.filter((m) => m.kind === "video");
      const covers = await resolveCovers(videos, d.catalog.covers);
      const missing = videos.filter((v) => !covers[v.id]);
      if (missing.length) errors.push(`Falta a imagem de capa de: ${missing.map((v) => v.name).join(", ")}. Abra a etapa Criativos para gerar.`);
    }
    if (autoCatalog && profile) {
      const info = await accountInfo(authOf(profile), d.accountId).catch(() => null);
      if (info && !info.business?.id) errors.push(`A conta ${acc.name} não está em um Business Manager; o catálogo automático precisa de um BM.`);
    }
  }
  return errors;
}

export interface AutoProduct {
  retailerId: string;
  name: string;
  data: Record<string, unknown>;
  mediaId: string;
}

/** Um produto por criativo (ou mais, se pedido). Vídeo: a capa é a imagem do produto. */
async function autoProducts(d: DraftData, draftId: string): Promise<{ products: AutoProduct[]; videos: { video: MediaAsset; cover: MediaAsset; retailerIds: string[] }[] }> {
  const media = await getMediaMany(d.creative.mediaIds);
  const covers = await resolveCovers(media.filter((m) => m.kind === "video"), d.catalog.covers);
  const { data: acc } = await db().from("ad_accounts").select("currency").eq("id", d.accountId).maybeSingle();
  const { data: page } = await db().from("fb_pages").select("name").eq("page_id", d.creative.pageId).maybeSingle();
  const currency = acc?.currency ?? "BRL";
  const title = (d.creative.headline || d.campaign.name).slice(0, 150);
  const per = Math.min(10, Math.max(1, Math.round(d.catalog.productsPerCreative || 1)));
  const delayed = d.catalog.delayMinutes > 0;
  const products: AutoProduct[] = [];
  const videos: { video: MediaAsset; cover: MediaAsset; retailerIds: string[] }[] = [];
  for (const m of media) {
    const cover = m.kind === "video" ? covers[m.id] : m;
    if (!cover) continue;
    const ids: string[] = [];
    for (let n = 1; n <= per; n++) {
      // ID estável: publicar de novo atualiza o mesmo produto em vez de duplicar
      const retailerId = `pv_${draftId.slice(0, 8)}_${m.id.slice(0, 8)}_${n}`;
      ids.push(retailerId);
      products.push({
        retailerId,
        mediaId: m.id,
        name: per > 1 ? `${title} ${n}` : title,
        data: {
          title: per > 1 ? `${title} ${n}` : title,
          description: (d.creative.description || d.creative.message || title).slice(0, 5000),
          availability: "in stock",
          condition: "new",
          price: `${Number(d.catalog.price).toFixed(2)} ${currency}`,
          link: d.creative.url,
          brand: (d.catalog.brand || page?.name || d.campaign.name).slice(0, 100),
          image_link: cover.public_url,
          ...(m.kind === "video" && !delayed ? { video: [{ url: m.public_url }] } : {}),
        },
      });
    }
    if (m.kind === "video" && delayed) videos.push({ video: m, cover, retailerIds: ids });
  }
  return { products, videos };
}

async function publishJobs(d: DraftData, draftId: string): Promise<JobSpec[]> {
  const jobs: JobSpec[] = [];
  const autoCatalog = d.creative.mode === "catalog" && d.catalog.source === "auto";
  let delayedVideos: Awaited<ReturnType<typeof autoProducts>>["videos"] = [];
  if (autoCatalog) {
    const { products, videos } = await autoProducts(d, draftId);
    delayedVideos = videos;
    jobs.push(
      { key: "catalog", kind: "catalog_auto", label: "Catálogo do Business Manager (identifica ou cria)" },
      { key: "products", kind: "catalog_products", label: `Criação de ${products.length} produto(s) em lote`, input: { products } },
      { key: "check", kind: "catalog_check", label: "Processamento dos produtos pela Meta", input: { publish: true } },
      { key: "product_set", kind: "product_set", label: "Conjunto de produtos da campanha", input: { retailerIds: products.map((p) => p.retailerId) } },
    );
    // Um anúncio por criativo: cada anúncio mostra só os produtos do seu criativo
    if (d.catalog.adsMode === "per_creative") {
      const media = await getMediaMany(d.creative.mediaIds);
      media.forEach((m, i) => {
        const ids = products.filter((p) => p.mediaId === m.id).map((p) => p.retailerId);
        if (ids.length) jobs.push({ key: `product_set:${i + 1}`, kind: "product_set", label: `Conjunto de produtos · ${m.name}`, input: { retailerIds: ids, suffix: m.name } });
      });
    }
  }
  jobs.push(
    { key: "campaign", kind: "campaign", label: `Criação da campanha · ${d.campaign.name}` },
    { key: "adset", kind: "adset", label: `Criação do conjunto · ${d.adset.name}` },
  );
  if (autoCatalog && d.catalog.adsMode === "per_creative") {
    const media = await getMediaMany(d.creative.mediaIds);
    media.forEach((m, i) => {
      const n = i + 1;
      const adName = adNameFor(d.creative.adName, n, m.name, media.length);
      jobs.push({ key: `creative:${n}`, kind: "creative", label: `Criativo de catálogo · ${adName}`, input: { adName, productSetKey: `product_set:${n}` } });
      jobs.push({ key: `ad:${n}`, kind: "ad", label: `Criação do anúncio · ${adName}`, input: { adName, creativeKey: `creative:${n}` } });
    });
  } else if (d.creative.mode === "catalog") {
    const adName = adNameFor(d.creative.adName.replace("{midia}", "Catálogo"), 1, null, 1);
    jobs.push({ key: "creative:1", kind: "creative", label: `Criativo de catálogo`, input: { adName } });
    jobs.push({ key: "ad:1", kind: "ad", label: `Criação do anúncio · ${adName}`, input: { adName, creativeKey: "creative:1" } });
  } else {
    const media = await getMediaMany(d.creative.mediaIds);
    for (const m of media) jobs.push({ key: `media:${m.id}`, kind: "media", label: `Upload de mídia · ${m.name}`, input: { assetId: m.id } });
    media.forEach((m, i) => {
      const n = i + 1;
      const adName = adNameFor(d.creative.adName, n, m.name, media.length);
      jobs.push({ key: `creative:${n}`, kind: "creative", label: `Criativo · ${adName}`, input: { adName, mediaKey: `media:${m.id}` } });
      jobs.push({ key: `ad:${n}`, kind: "ad", label: `Criação do anúncio · ${adName}`, input: { adName, creativeKey: `creative:${n}` } });
    });
  }
  if (delayedVideos.length) {
    jobs.push({
      key: "video_schedule",
      kind: "catalog_video_schedule",
      label: `Agendamento do vídeo nos produtos (em ${d.catalog.delayMinutes} min)`,
      input: {
        delayMinutes: d.catalog.delayMinutes,
        videos: delayedVideos.map((v) => ({ videoId: v.video.id, videoName: v.video.name, coverId: v.cover.id, retailerIds: v.retailerIds })),
      },
    });
  }
  jobs.push({ key: "review", kind: "review", label: "Publicação na Meta (revisão dos anúncios)" });
  return jobs;
}

export interface AccountCheck {
  accountId: string;
  name: string;
  currency: string | null;
  business: { id: string; name: string } | null;
  /** ok = pixel já está na conta · share = mesmo BM, compartilhado ao publicar · own = usa o único pixel da conta */
  pixel: { status: "none" | "ok" | "share" | "own" | "error"; id: string; note: string };
  catalog: { status: "none" | "ok" | "error"; note: string };
  audiences: { status: "none" | "ok" | "error"; note: string };
  errors: string[];
}

/**
 * Confere uma conta extra contra o rascunho. Pixel, catálogo e públicos são
 * do BM/conta: no mesmo BM o pixel é o mesmo (compartilhado ao publicar) e o
 * catálogo do BM serve para todas as contas dele.
 */
export async function checkAccount(d: DraftData, accountId: string, main: { currency: string | null; businessId: string | null }): Promise<AccountCheck> {
  const { data: acc } = await db().from("ad_accounts").select("name,currency").eq("id", accountId).maybeSingle();
  const c: AccountCheck = {
    accountId,
    name: acc?.name ?? accountId,
    currency: acc?.currency ?? null,
    business: null,
    pixel: { status: "none", id: "", note: "Sem pixel no conjunto" },
    catalog: { status: "none", note: "" },
    audiences: { status: "none", note: "" },
    errors: [],
  };
  if (main.currency && c.currency && c.currency !== main.currency) {
    c.errors.push(`Moeda ${c.currency} diferente da conta principal (${main.currency}): o orçamento seria lido em outra moeda.`);
  }
  const auth = await authForAccount(accountId);
  const info = await accountInfo(auth, accountId);
  c.business = info.business ?? null;

  if (d.adset.pixelId) {
    const pixels = await listAccountPixels(auth, accountId).catch(() => []);
    if (pixels.some((p) => p.id === d.adset.pixelId)) {
      c.pixel = { status: "ok", id: d.adset.pixelId, note: "Mesmo pixel (já está na conta)" };
    } else {
      // Mesmo pixel sempre que o BM da conta o enxerga (dono ou compartilhado de outro BM)
      const owner = await pixelOwner(auth, d.adset.pixelId).catch(() => null);
      const sameBm = !!(owner && c.business && owner.id === c.business.id);
      const visible = sameBm || (c.business ? (await businessPixelIds(auth, c.business.id)).has(d.adset.pixelId) : false);
      if (visible && c.business) {
        c.pixel = {
          status: "share",
          id: d.adset.pixelId,
          note: sameBm ? `Mesmo pixel — ligado à conta ao publicar (BM ${c.business.name})` : `Mesmo pixel (compartilhado com o BM ${c.business.name}) — ligado à conta ao publicar`,
        };
      } else if (pixels.length === 1) {
        c.pixel = { status: "own", id: pixels[0].id, note: `O pixel escolhido não está no BM desta conta: usa o pixel da própria conta, ${pixels[0].name}` };
      } else {
        c.pixel = { status: "error", id: "", note: "Pixel não encontrado no BM" };
        c.errors.push(pixels.length
          ? `O pixel escolhido não está no BM desta conta e ela tem ${pixels.length} pixels. Compartilhe o pixel com o BM dela no Gerenciador de Negócios.`
          : "O pixel escolhido não está no BM desta conta e ela não tem pixel próprio. Compartilhe o pixel com o BM dela no Gerenciador de Negócios.");
      }
    }
  }

  if (d.creative.mode === "catalog" && d.catalog.source === "auto") {
    if (c.business) c.catalog = { status: "ok", note: `Catálogo automático do BM ${c.business.name}` };
    else {
      c.catalog = { status: "error", note: "Conta sem BM" };
      c.errors.push("A conta não está em um Business Manager; o catálogo automático precisa de um BM.");
    }
  }
  if (d.creative.mode === "catalog" && d.catalog.source === "existing" && d.campaign.catalogId) {
    const catalogs = await listAccountCatalogs(auth, accountId).catch(() => []);
    if (catalogs.some((x) => x.id === d.campaign.catalogId)) c.catalog = { status: "ok", note: "Mesmo catálogo (está no BM da conta)" };
    else {
      c.catalog = { status: "error", note: "Catálogo de outro BM" };
      c.errors.push(main.businessId && c.business?.id !== main.businessId
        ? "A conta é de outro BM e o catálogo não está nele. Use contas do mesmo BM ou compartilhe o catálogo com o BM da conta."
        : "O catálogo não está disponível para esta conta.");
    }
  }

  const wanted = [...d.adset.audiences, ...d.adset.excludedAudiences];
  if (wanted.length) {
    const own = new Set((await listCustomAudiences(auth, accountId).catch(() => [])).map((a) => a.id));
    const missing = wanted.filter((a) => !own.has(a.id));
    c.audiences = missing.length ? { status: "error", note: `Faltam: ${missing.map((a) => a.name).join(", ")}` } : { status: "ok", note: "Públicos disponíveis" };
    if (missing.length) c.errors.push(`Públicos não compartilhados com a conta: ${missing.map((a) => a.name).join(", ")}.`);
  }
  return c;
}

/** Moeda e BM da conta principal, usados na conferência das contas extras. */
export async function mainAccountRef(accountId: string) {
  const { data: acc } = await db().from("ad_accounts").select("currency").eq("id", accountId).maybeSingle();
  const info = await accountInfo(await authForAccount(accountId), accountId).catch(() => null);
  return { currency: acc?.currency ?? null, businessId: info?.business?.id ?? null, businessName: info?.business?.name ?? null };
}

/**
 * Publica o rascunho. Cada conta tem um único processo de publicação:
 * publicar de novo depois de uma falha continua o mesmo processo (o que já
 * foi criado na Meta é reaproveitado), nunca cria uma segunda campanha.
 */
export async function publishDraft(draftId: string): Promise<{ runId: string; runIds?: string[]; errors?: string[] }> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error("Rascunho não encontrado.");
  const accountIds = [draft.data.accountId, ...draft.data.extraAccountIds.filter((a) => a !== draft.data.accountId)];
  const multi = accountIds.length > 1;
  const { data: accs } = await db().from("ad_accounts").select("id,name,currency").in("id", accountIds);
  const accOf = (id: string) => (accs ?? []).find((a: any) => a.id === id);

  const variants: DraftData[] = [];
  const shares: { accountId: string; pixelId: string; businessId: string }[] = [];
  const errors: string[] = [];
  const first = await checkBeforePublish({ ...draft.data, extraAccountIds: [] });
  if (first.length) return { runId: "", errors: first };
  variants.push({ ...draft.data, extraAccountIds: [] });
  const main = multi ? await mainAccountRef(accountIds[0]) : { currency: null, businessId: null };
  for (const accountId of accountIds.slice(1)) {
    const d: DraftData = { ...draft.data, accountId, extraAccountIds: [] };
    let errs = await checkBeforePublish(d);
    if (!errs.length) {
      try {
        const c = await checkAccount(d, accountId, main);
        errs = c.errors;
        if (c.pixel.id) d.adset = { ...d.adset, pixelId: c.pixel.id };
        if (c.pixel.status === "share" && c.business) shares.push({ accountId, pixelId: c.pixel.id, businessId: c.business.id });
      } catch (e: any) {
        errs = [e?.message ?? "falha ao consultar a conta."];
      }
    }
    errors.push(...errs.map((e) => `${accOf(accountId)?.name ?? accountId}: ${e}`));
    variants.push(d);
  }
  if (errors.length) return { runId: "", errors };

  // Pixel no BM da conta (próprio ou compartilhado): liga à conta antes de criar os conjuntos
  for (const s of shares) {
    try {
      await sharePixel(await authForAccount(s.accountId), s.pixelId, s.accountId, s.businessId);
    } catch (e: any) {
      errors.push(`${accOf(s.accountId)?.name ?? s.accountId}: a Meta não ligou o pixel à conta (${e?.message ?? "sem permissão"}). O perfil precisa ser admin do BM da conta.`);
    }
  }
  if (errors.length) return { runId: "", errors };

  const runIds: string[] = [];
  for (const [i, d] of variants.entries()) {
    const title = (draft.data.campaign.name || draft.name) + (multi ? ` · ${accOf(d.accountId)?.name ?? d.accountId}` : "");
    runIds.push(await publishOne(draftId, d, i === 0 ? `publish:${draftId}` : `publish:${draftId}:${d.accountId}`, title));
  }
  await db().from("auto_drafts").update({ status: "queued", run_id: runIds[0], updated_at: new Date().toISOString() }).eq("id", draftId);
  return { runId: runIds[0], runIds };
}

async function publishOne(draftId: string, d: DraftData, idemKey: string, title: string): Promise<string> {
  const jobs = await publishJobs(d, draftId);
  const { data: prev } = await db().from("ops_runs").select("id,status,summary").eq("idem_key", idemKey).maybeSingle();

  if (prev) {
    if (prev.status === "failed" || prev.status === "canceled") {
      // Atualiza a configuração e recoloca na fila só o que não foi concluído
      const { data: existing } = await db().from("ops_jobs").select("key,status").eq("run_id", prev.id);
      const doneKeys = new Set((existing ?? []).filter((j: any) => j.status === "done").map((j: any) => j.key));
      await db().from("ops_jobs").delete().eq("run_id", prev.id).neq("status", "done");
      const rows = jobs
        .map((j, i) => ({ ...j, seq: i + 1 }))
        .filter((j) => !doneKeys.has(j.key))
        .map((j) => ({ run_id: prev.id, seq: j.seq, key: j.key, kind: j.kind, label: j.label, input: j.input ?? {} }));
      if (rows.length) await db().from("ops_jobs").insert(rows);
      await db().from("ops_runs").update({ summary: { ...prev.summary, draft: d } }).eq("id", prev.id);
      await retryRun(prev.id);
    }
    return prev.id;
  }

  const { id } = await createRun({
    kind: "publish",
    title,
    idemKey,
    refId: draftId,
    summary: { draft: d, accountId: d.accountId },
    jobs,
  });
  await kick(id);
  return id;
}

// ------------------------------------------------------------- Páginas

export async function enqueuePageSync(profileId: string, pageIds: string[], names: Record<string, string>, nonce: string) {
  const { id } = await createRun({
    kind: "page_sync",
    title: `Sincronizar ${pageIds.length} Página(s)`,
    idemKey: `pages:${nonce}`,
    refId: profileId,
    summary: { profileId, pageIds },
    jobs: [
      { key: "page_map", kind: "page_map", label: "Consulta das contas de anúncio relacionadas", input: { profileId } },
      ...pageIds.map((p) => ({ key: `page:${p}`, kind: "page", label: `Sincronização de Página · ${names[p] ?? p}`, input: { profileId, pageId: p } })),
    ],
  });
  await kick(id);
  return id;
}

// ------------------------------------------------------------- Catálogos

export interface CatalogItemReq {
  method: "CREATE" | "UPDATE";
  retailerId: string;
  productId?: string | null;
  productName?: string | null;
  data: Record<string, unknown>;
  previousMedia?: unknown;
  currentMedia?: unknown;
}

export async function enqueueCatalogUpdate(p: {
  title: string;
  profileId: string;
  catalogId: string;
  items: CatalogItemReq[];
  idemKey: string;
  scheduleId?: string | null;
}) {
  const { id, existed } = await createRun({
    kind: "catalog_update",
    title: p.title,
    idemKey: p.idemKey,
    refId: p.catalogId,
    summary: { profileId: p.profileId, catalogId: p.catalogId, scheduleId: p.scheduleId ?? null },
    jobs: [
      ...p.items.map((it) => ({
        key: `item:${it.retailerId}`,
        kind: "catalog_item",
        label: `Atualização do catálogo · ${it.productName ?? it.retailerId}`,
        input: { ...it, profileId: p.profileId, catalogId: p.catalogId, scheduleId: p.scheduleId ?? null },
      })),
      { key: "check", kind: "catalog_check", label: "Sincronização e revisão da Meta", input: { profileId: p.profileId, catalogId: p.catalogId, scheduleId: p.scheduleId ?? null } },
    ],
  });
  if (!existed) await kick(id);
  return id;
}

export interface ScheduleRow {
  id: string;
  name: string;
  profile_id: string;
  catalog_id: string;
  catalog_name: string | null;
  product_ids: string[];
  media_ids: string[];
  update_type: "rotate_image" | "set_media";
  interval_minutes: number;
  start_at: string;
  next_run_at: string;
  cursor: number;
  active: boolean;
  last_run_at: string | null;
  last_result: string | null;
}

/** Enfileira as automações de catálogo que chegaram na hora (chamado pelo agendador). */
export async function runDueSchedules(): Promise<string[]> {
  const now = new Date();
  const { data } = await db().from("catalog_schedules").select("*").eq("active", true).lte("next_run_at", now.toISOString()).limit(20);
  const out: string[] = [];
  for (const s of (data ?? []) as ScheduleRow[]) {
    try {
      const profile = await getProfile(s.profile_id);
      if (!profile) throw new Error("Perfil Meta da automação foi removido.");
      const auth = authOf(profile);
      const media = await getMediaMany(s.media_ids);
      const images = media.filter((m) => m.kind === "image");
      const videos = media.filter((m) => m.kind === "video");
      if (!media.length) throw new Error("A automação não tem mídias.");
      const items: CatalogItemReq[] = [];
      for (const pid of s.product_ids) {
        const p = await getProduct(auth, pid);
        if (s.update_type === "rotate_image") {
          if (!images.length) throw new Error("O rodízio precisa de imagens.");
          const img = images[s.cursor % images.length];
          items.push({
            method: "UPDATE", retailerId: p.retailer_id, productId: p.id, productName: p.name,
            data: { image_link: img.public_url },
            previousMedia: { image_url: p.image_url ?? null },
            currentMedia: { image_url: img.public_url, media_id: img.id, name: img.name },
          });
        } else {
          const data: Record<string, unknown> = {};
          if (images[0]) data.image_link = images[0].public_url;
          if (images.length > 1) data.additional_image_link = images.slice(1).map((m) => m.public_url);
          if (videos.length) data.video = videos.map((v) => ({ url: v.public_url }));
          items.push({
            method: "UPDATE", retailerId: p.retailer_id, productId: p.id, productName: p.name, data,
            previousMedia: { image_url: p.image_url ?? null, additional_image_urls: p.additional_image_urls ?? [] },
            currentMedia: { images: images.map((m) => m.public_url), videos: videos.map((m) => m.public_url) },
          });
        }
      }
      await enqueueCatalogUpdate({
        title: `Automação · ${s.name}`,
        profileId: s.profile_id,
        catalogId: s.catalog_id,
        items,
        idemKey: `sched:${s.id}:${s.next_run_at}`,
        scheduleId: s.id,
      });
      // Próxima execução: pula horários perdidos (sem rajada de atualizações atrasadas)
      let next = new Date(s.next_run_at).getTime();
      while (next <= now.getTime()) next += s.interval_minutes * 60000;
      await db()
        .from("catalog_schedules")
        .update({
          cursor: s.cursor + 1,
          last_run_at: now.toISOString(),
          next_run_at: new Date(next).toISOString(),
          last_result: "Na fila",
          ...(s.update_type === "set_media" ? { active: false } : {}),
        })
        .eq("id", s.id);
      out.push(`${s.name}: na fila`);
    } catch (e: any) {
      const msg = e?.message ?? "erro";
      await db()
        .from("catalog_schedules")
        .update({ last_result: `Erro: ${msg}`, next_run_at: new Date(now.getTime() + s.interval_minutes * 60000).toISOString() })
        .eq("id", s.id);
      await logEvent("automacao", "catalogo", false, `${s.name}: ${msg}`);
      out.push(`${s.name}: ${msg}`);
    }
  }
  return out;
}

/** Chamado pelo agendador: automações de catálogo + o que estiver na fila. */
export async function automationTick(budgetMs = 25_000) {
  try {
    const schedules = await runDueSchedules();
    const processed = await tick({ budgetMs });
    return { ok: true, schedules, processed };
  } catch (e: any) {
    // Sem a migração 005 o resto do agendador continua funcionando
    return { ok: false, error: e?.message as string };
  }
}
