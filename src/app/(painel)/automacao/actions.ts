"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import { db, getSetting, setSetting } from "@/lib/db";
import { authForAccount, profileAuth } from "@/lib/profiles";
import { accountBusiness, createCatalog, getProduct } from "@/lib/automacao/meta-ads";
import { deleteMedia, getMediaMany } from "@/lib/automacao/media";
import { cancelRun, enqueueCatalogUpdate, enqueuePageSync, fixAndContinue, getDraft, publishDraft, recoverCatalogPublication, retryRun, runDueSchedules } from "@/lib/automacao/engine";
import { emptyDraft, normalizeDraft, type DraftData } from "@/lib/automacao/types";

function go(path: string, key: "ok" | "erro", msg: string): never {
  const u = new URL(path.startsWith("/") ? path : "/automacao", "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("erro");
  u.searchParams.set(key, msg);
  redirect(`${u.pathname}?${u.searchParams}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const backOf = (f: FormData, fallback: string) => {
  const b = str(f, "back");
  return b.startsWith("/automacao") ? b : fallback;
};

// ------------------------------------------------------------- Rascunhos

export async function newDraftAction(formData: FormData) {
  await requireAuth();
  const account = str(formData, "account");
  const { data, error } = await db()
    .from("auto_drafts")
    .insert({ name: "Nova campanha", account_id: account || null, data: emptyDraft(account) })
    .select("id")
    .single();
  if (error) go("/automacao", "erro", /auto_drafts/.test(error.message) ? "Rode a migração 005_automacao.sql no Supabase." : error.message);
  redirect(`/automacao/criar?rascunho=${data.id}`);
}

/** Salva o rascunho (chamado pelo assistente a cada alteração e no botão Salvar). */
export async function saveDraftAction(id: string, data: DraftData, step: number): Promise<{ ok: boolean; at?: string; error?: string }> {
  await requireAuth();
  const d = normalizeDraft(data);
  const at = new Date().toISOString();
  const { data: cur } = await db().from("auto_drafts").select("status").eq("id", id).maybeSingle();
  if (!cur) return { ok: false, error: "Rascunho não encontrado." };
  if (cur.status === "published") return { ok: false, error: "Este rascunho já foi publicado. Duplique para criar outra campanha." };
  const { error } = await db()
    .from("auto_drafts")
    .update({ data: d, account_id: d.accountId || null, name: d.campaign.name || "Nova campanha", step: Math.min(4, Math.max(1, step)), updated_at: at })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, at };
}

/** Valida tudo, salva e põe a publicação na fila. */
export async function publishDraftAction(id: string, data: DraftData): Promise<{ runId?: string; runIds?: string[]; errors?: string[] }> {
  await requireAuth();
  const saved = await saveDraftAction(id, data, 4);
  if (!saved.ok) {
    // Já publicado: devolve o processo existente em vez de publicar de novo
    const d = await getDraft(id);
    if (d?.run_id) return { runId: d.run_id };
    return { errors: [saved.error ?? "Falha ao salvar."] };
  }
  try {
    const r = await publishDraft(id);
    if (r.errors?.length) return { errors: r.errors };
    if (data.creative.mode === "catalog" && data.catalog.source === "auto") {
      const { productsPerCreative, price, brand, adsMode, preferVideo, productImageId } = data.catalog;
      await setSetting("catalog_prefs", { productsPerCreative, price, brand, adsMode, preferVideo, productImageId, catalogFormat: data.creative.catalogFormat }).catch(() => {});
    }
    revalidatePath("/automacao");
    return { runId: r.runId, runIds: r.runIds };
  } catch (e: any) {
    return { errors: [e?.message ?? "Falha ao publicar."] };
  }
}

export async function duplicateDraftAction(formData: FormData) {
  await requireAuth();
  const src = await getDraft(str(formData, "id"));
  if (!src) go("/automacao", "erro", "Rascunho não encontrado.");
  const data = { ...src.data, campaign: { ...src.data.campaign, name: `${src.data.campaign.name} (cópia)` } };
  const { data: row, error } = await db()
    .from("auto_drafts")
    .insert({ name: data.campaign.name, account_id: src.account_id, data, step: 1 })
    .select("id")
    .single();
  if (error) go("/automacao", "erro", error.message);
  redirect(`/automacao/criar?rascunho=${row.id}`);
}

export async function deleteDraftAction(formData: FormData) {
  await requireAuth();
  await db().from("auto_drafts").delete().eq("id", str(formData, "id"));
  go("/automacao", "ok", "Rascunho excluído.");
}

// ------------------------------------------------------------- Processos

export async function retryRunAction(formData: FormData) {
  await requireAuth();
  const id = str(formData, "id");
  try {
    await retryRun(id);
  } catch (e: any) {
    go(`/automacao/processos/${id}`, "erro", e?.message ?? "Falha");
  }
  go(`/automacao/processos/${id}`, "ok", "Processo na fila de novo. O que já foi feito na Meta é mantido.");
}

/** Recupera a campanha e o catálogo antigos, criando apenas um conjunto compatível. */
export async function recoverCatalogPublicationAction(formData: FormData) {
  await requireAuth();
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) go("/automacao/processos", "erro", "Processo inválido.");
  try {
    const message = await recoverCatalogPublication(id);
    go(`/automacao/processos/${id}`, "ok", message);
  } catch (e: any) {
    // redirect() lança um erro especial e só é usado fora do try acima.
    if (e?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(`/automacao/processos/${id}`, "erro", e?.message ?? "Não foi possível recuperar a publicação.");
  }
}

/** "Corrigir e continuar" na tela do processo: ajusta Página, Instagram, link e textos e segue de onde parou. */
export async function fixAndContinueAction(formData: FormData) {
  await requireAuth();
  const id = str(formData, "id");
  const url = str(formData, "url");
  if (url && !/^https?:\/\/\S+\.\S+/.test(url)) go(`/automacao/processos/${id}`, "erro", "URL de destino inválida (use https://).");
  try {
    await fixAndContinue(id, {
      creative: {
        pageId: str(formData, "page"),
        instagramId: str(formData, "instagram"),
        url,
        message: String(formData.get("message") ?? ""),
        headline: str(formData, "headline"),
      },
      adset: str(formData, "instagram_off") === "1" ? { placements: "manual", platforms: ["facebook"] } : {},
    });
  } catch (e: any) {
    go(`/automacao/processos/${id}`, "erro", e?.message ?? "Falha");
  }
  go(`/automacao/processos/${id}`, "ok", "Corrigido. Continuando de onde parou — nada é criado em dobro.");
}

export async function cancelRunAction(formData: FormData) {
  await requireAuth();
  const id = str(formData, "id");
  await cancelRun(id);
  go(`/automacao/processos/${id}`, "ok", "Processo cancelado. O que já foi criado na Meta continua lá.");
}

// ------------------------------------------------------------- FanPages

export async function togglePageCreatorAction(formData: FormData) {
  await requireAuth();
  const enabled = str(formData, "enabled") === "1";
  await db().from("fb_pages").update({ enabled_in_creator: enabled }).eq("page_id", str(formData, "page"));
  revalidatePath("/automacao/fanpages");
  go(backOf(formData, "/automacao/fanpages"), "ok", enabled ? "Página disponível no criador." : "Página escondida do criador.");
}

export async function removePageAction(formData: FormData) {
  await requireAuth();
  await db().from("fb_pages").delete().eq("page_id", str(formData, "page"));
  go("/automacao/fanpages", "ok", "Página removida do módulo (nada muda na Meta).");
}

export async function startPageSyncAction(formData: FormData) {
  await requireAuth();
  const profile = str(formData, "profile");
  const pages = formData.getAll("page").map(String).filter((p) => /^\d+$/.test(p));
  const nonce = str(formData, "nonce") || crypto.randomUUID();
  if (!pages.length) go(`/automacao/fanpages/sincronizar?perfil=${profile}&etapa=3`, "erro", "Selecione pelo menos uma Página.");
  const names: Record<string, string> = {};
  for (const p of pages) names[p] = String(formData.get(`name_${p}`) ?? p);
  let runId = "";
  try {
    runId = await enqueuePageSync(profile, pages, names, nonce);
  } catch (e: any) {
    go(`/automacao/fanpages/sincronizar?perfil=${profile}&etapa=3`, "erro", e?.message ?? "Falha ao iniciar");
  }
  redirect(`/automacao/processos/${runId}?de=fanpages`);
}

// ------------------------------------------------------------- Catálogos

export async function createCatalogAction(formData: FormData) {
  await requireAuth();
  const profile = str(formData, "profile");
  const business = str(formData, "business");
  const name = str(formData, "name");
  const back = `/automacao/catalogos?perfil=${profile}`;
  if (!name || !/^\d+$/.test(business)) go(back, "erro", "Escolha o Business Manager e dê um nome ao catálogo.");
  let id = "";
  try {
    id = (await createCatalog(await profileAuth(profile), business, name)).id;
  } catch (e: any) {
    go(back, "erro", `A Meta não criou o catálogo: ${e?.message ?? "sem permissão"}. Confira se o perfil tem catalog_management e é admin do BM.`);
  }
  go(`/automacao/catalogos/${id}?perfil=${profile}`, "ok", "Catálogo criado.");
}

/** Salva a imagem padrão do produto assim que é escolhida (usada em todos os próximos catálogos). */
export async function saveProductImageAction(mediaId: string) {
  await requireAuth();
  const cur = await getSetting<Record<string, unknown>>("catalog_prefs", {});
  await setSetting("catalog_prefs", { ...cur, productImageId: mediaId });
}

/** Cria o catálogo no Business Manager dono da conta de anúncio (botão do assistente de criação). */
export async function createCatalogForAccountAction(accountId: string, name: string): Promise<{ id?: string; name?: string; profileId?: string; error?: string }> {
  await requireAuth();
  name = name.trim();
  if (!name) return { error: "Dê um nome ao catálogo." };
  if (!/^act_\d+$/.test(accountId)) return { error: "Escolha a conta de anúncio." };
  try {
    const auth = await authForAccount(accountId);
    const bm = await accountBusiness(auth, accountId);
    if (!bm) return { error: "Esta conta de anúncio não está em nenhum Business Manager que o perfil enxergue; catálogos só existem dentro de um BM." };
    const { id } = await createCatalog(auth, bm.id, name);
    const { data: acc } = await db().from("ad_accounts").select("profile_id").eq("id", accountId).maybeSingle();
    return { id, name, profileId: acc?.profile_id ?? undefined };
  } catch (e: any) {
    return { error: `A Meta não criou o catálogo: ${e?.message ?? "sem permissão"}. Confira se o perfil tem catalog_management e é admin do BM.` };
  }
}

function mediaData(images: { public_url: string }[], videos: { public_url: string }[]) {
  const data: Record<string, unknown> = {};
  if (images[0]) data.image_link = images[0].public_url;
  if (images.length > 1) data.additional_image_link = images.slice(1).map((m) => m.public_url);
  if (videos.length) data.video = videos.map((v) => ({ url: v.public_url }));
  return data;
}

export async function addProductAction(formData: FormData) {
  await requireAuth();
  const profile = str(formData, "profile");
  const catalog = str(formData, "catalog");
  const back = `/automacao/catalogos/${catalog}?perfil=${profile}`;
  const retailerId = str(formData, "retailer_id");
  const name = str(formData, "name");
  const price = Number(str(formData, "price").replace(",", "."));
  const currency = str(formData, "currency").toUpperCase() || "BRL";
  const link = str(formData, "url");
  const media = await getMediaMany(formData.getAll("media").map(String));
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  if (!retailerId || !name || !(price > 0) || !/^https?:\/\//.test(link)) go(back, "erro", "Preencha ID, nome, preço e link do produto.");
  if (!images.length) go(back, "erro", "O produto precisa de pelo menos uma imagem.");

  const runId = await enqueueCatalogUpdate({
    title: `Novo produto · ${name}`,
    profileId: profile,
    catalogId: catalog,
    idemKey: `catalog:${str(formData, "nonce") || crypto.randomUUID()}`,
    items: [
      {
        method: "CREATE",
        retailerId,
        productName: name,
        data: {
          title: name,
          description: str(formData, "description") || name,
          availability: str(formData, "availability") || "in stock",
          condition: "new",
          price: `${price.toFixed(2)} ${currency}`,
          link,
          brand: str(formData, "brand") || undefined,
          ...mediaData(images, videos),
        },
        currentMedia: { images: images.map((m) => m.public_url), videos: videos.map((m) => m.public_url) },
      },
    ],
  });
  redirect(`/automacao/processos/${runId}?de=catalogo&catalogo=${catalog}&perfil=${profile}`);
}

export async function updateProductMediaAction(formData: FormData) {
  await requireAuth();
  const profile = str(formData, "profile");
  const catalog = str(formData, "catalog");
  const productId = str(formData, "product");
  const back = `/automacao/catalogos/${catalog}?perfil=${profile}&produto=${productId}`;
  const media = await getMediaMany(formData.getAll("media").map(String));
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  if (!images.length && !videos.length) go(back, "erro", "Escolha as mídias do produto.");
  let runId = "";
  try {
    const p = await getProduct(await profileAuth(profile), productId);
    runId = await enqueueCatalogUpdate({
      title: `Mídias · ${p.name}`,
      profileId: profile,
      catalogId: catalog,
      idemKey: `catalog:${str(formData, "nonce") || crypto.randomUUID()}`,
      items: [
        {
          method: "UPDATE",
          retailerId: p.retailer_id,
          productId: p.id,
          productName: p.name,
          data: mediaData(images, videos),
          previousMedia: { image_url: p.image_url ?? null, additional_image_urls: p.additional_image_urls ?? [] },
          currentMedia: { images: images.map((m) => m.public_url), videos: videos.map((m) => m.public_url) },
        },
      ],
    });
  } catch (e: any) {
    go(back, "erro", e?.message ?? "Falha ao ler o produto na Meta");
  }
  redirect(`/automacao/processos/${runId}?de=catalogo&catalogo=${catalog}&perfil=${profile}`);
}

export async function saveScheduleAction(formData: FormData) {
  await requireAuth();
  const profile = str(formData, "profile");
  const catalog = str(formData, "catalog");
  const back = `/automacao/catalogos/${catalog}?perfil=${profile}&aba=automacoes`;
  const type = str(formData, "update_type") === "set_media" ? "set_media" : "rotate_image";
  const interval = Math.round(Number(str(formData, "interval")) || 0);
  const products = formData.getAll("product").map(String).filter((p) => /^\d+$/.test(p));
  const mediaIds = formData.getAll("media").map(String);
  const media = await getMediaMany(mediaIds);
  const startLocal = str(formData, "start_at");
  const tzOffset = Number(str(formData, "tz_offset") || "0"); // minutos (getTimezoneOffset do navegador)
  const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startLocal) ? new Date(Date.parse(`${startLocal}:00Z`) + tzOffset * 60000) : new Date();

  if (!str(formData, "name")) go(back, "erro", "Dê um nome para a automação.");
  if (!products.length) go(back, "erro", "Selecione os produtos.");
  if (type === "rotate_image" && media.filter((m) => m.kind === "image").length < 2) go(back, "erro", "O rodízio precisa de pelo menos 2 imagens.");
  if (type === "set_media" && !media.length) go(back, "erro", "Escolha as mídias.");
  if (type === "rotate_image" && interval < 15) go(back, "erro", "O intervalo mínimo é de 15 minutos.");

  const { error } = await db().from("catalog_schedules").insert({
    name: str(formData, "name"),
    profile_id: profile,
    catalog_id: catalog,
    catalog_name: str(formData, "catalog_name") || null,
    product_ids: products,
    media_ids: media.map((m) => m.id),
    update_type: type,
    interval_minutes: Math.max(15, interval || 60),
    start_at: start.toISOString(),
    next_run_at: start.toISOString(),
    active: str(formData, "active") !== "0",
  });
  if (error) go(back, "erro", error.message);
  go(back, "ok", "Automação salva. O agendador executa no horário (cadastre a URL do Agendador em Regras).");
}

export async function toggleScheduleAction(formData: FormData) {
  await requireAuth();
  const active = str(formData, "active") === "1";
  const patch: Record<string, unknown> = { active };
  // Ao reativar, não executa os horários perdidos de uma vez
  if (active) patch.next_run_at = new Date(Math.max(Date.now(), Date.parse(str(formData, "next") || "0"))).toISOString();
  await db().from("catalog_schedules").update(patch).eq("id", str(formData, "id"));
  go(backOf(formData, "/automacao/catalogos"), "ok", active ? "Automação ativada." : "Automação pausada.");
}

export async function runScheduleNowAction(formData: FormData) {
  await requireAuth();
  const back = backOf(formData, "/automacao/catalogos");
  const scheduleId = str(formData, "id");
  const { data: schedule } = await db().from("catalog_schedules").select("id,active").eq("id", scheduleId).maybeSingle();
  if (!schedule) go(back, "erro", "Agendamento não encontrado nesta conta.");
  if (!schedule.active) go(back, "erro", "Esta atualização já foi executada ou está pausada.");
  const r = await runDueSchedules({ scheduleIds: [scheduleId], executeNow: true });
  go(back, r.length && !r[0].includes(": Erro") ? "ok" : "erro", r.join(" · ") || "Não foi possível enfileirar a atualização.");
}

/** Ação manual para a tela do processo: não exige cron nem aguarda o delay. */
export async function updateScheduledVideosNowAction(formData: FormData) {
  await requireAuth();
  const runId = str(formData, "run_id");
  const back = `/automacao/processos/${runId}`;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) go("/automacao/processos", "erro", "Processo inválido.");

  const { data: run } = await db().from("ops_runs").select("id,kind").eq("id", runId).maybeSingle();
  if (!run || run.kind !== "publish") go(back, "erro", "Processo de publicação não encontrado.");

  const { data: job } = await db().from("ops_jobs").select("status,result").eq("run_id", runId).eq("key", "video_schedule").maybeSingle();
  if (!job || job.status !== "done") go(back, "erro", "Os vídeos ainda não foram programados.");

  const scheduleIds = Array.isArray(job.result?.scheduleIds)
    ? job.result.scheduleIds.filter((v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
    : [];
  if (!scheduleIds.length) go(back, "erro", "Nenhum agendamento de vídeo foi encontrado.");

  const { data: active } = await db().from("catalog_schedules")
    .select("id").in("id", scheduleIds).eq("update_type", "set_media").eq("active", true);
  const ids = (active ?? []).map((s) => s.id);
  if (!ids.length) go(back, "erro", "Os vídeos já foram enviados, ou o agendamento foi pausado.");
  const results = await runDueSchedules({ scheduleIds: ids, executeNow: true });
  const failed = results.some((s) => s.includes(": Erro"));
  go(back, results.length && !failed ? "ok" : "erro",
    results.join(" · ") || "Não foi possível enfileirar a atualização.");
}

export async function deleteScheduleAction(formData: FormData) {
  await requireAuth();
  await db().from("catalog_schedules").delete().eq("id", str(formData, "id"));
  go(backOf(formData, "/automacao/catalogos"), "ok", "Automação excluída. O histórico continua salvo.");
}

// ------------------------------------------------------------- Mídias

export async function deleteMediaAction(formData: FormData) {
  await requireAuth();
  await deleteMedia(str(formData, "id"));
  go("/automacao/midias", "ok", "Mídia excluída da biblioteca (o que já foi enviado à Meta continua lá).");
}
