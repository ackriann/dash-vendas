import "server-only";
import { db, logEvent } from "../db";
import { authOf, getProfile } from "../profiles";
import { getProduct } from "./meta-ads";
import { getMediaMany } from "./media";
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
  if (d.creative.mode === "media") {
    const media = await getMediaMany(d.creative.mediaIds);
    if (media.length !== d.creative.mediaIds.length) errors.push("Alguma mídia escolhida foi excluída da biblioteca.");
    if (media.some((m) => m.status !== "ready")) errors.push("Alguma mídia ainda não terminou de enviar.");
  }
  return errors;
}

async function publishJobs(d: DraftData): Promise<JobSpec[]> {
  const jobs: JobSpec[] = [
    { key: "campaign", kind: "campaign", label: `Criação da campanha · ${d.campaign.name}` },
    { key: "adset", kind: "adset", label: `Criação do conjunto · ${d.adset.name}` },
  ];
  if (d.creative.mode === "catalog") {
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
  jobs.push({ key: "review", kind: "review", label: "Publicação na Meta (revisão dos anúncios)" });
  return jobs;
}

/**
 * Publica o rascunho. Um rascunho tem um único processo de publicação:
 * publicar de novo depois de uma falha continua o mesmo processo (o que já
 * foi criado na Meta é reaproveitado), nunca cria uma segunda campanha.
 */
export async function publishDraft(draftId: string): Promise<{ runId: string; errors?: string[] }> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error("Rascunho não encontrado.");
  const errors = await checkBeforePublish(draft.data);
  if (errors.length) return { runId: "", errors };

  const jobs = await publishJobs(draft.data);
  const idemKey = `publish:${draftId}`;
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
      await db().from("ops_runs").update({ summary: { ...prev.summary, draft: draft.data } }).eq("id", prev.id);
      await retryRun(prev.id);
    }
    await db().from("auto_drafts").update({ status: "queued", run_id: prev.id }).eq("id", draftId);
    return { runId: prev.id };
  }

  const { id } = await createRun({
    kind: "publish",
    title: draft.data.campaign.name || draft.name,
    idemKey,
    refId: draftId,
    summary: { draft: draft.data, accountId: draft.data.accountId },
    jobs,
  });
  await db().from("auto_drafts").update({ status: "queued", run_id: id, updated_at: new Date().toISOString() }).eq("id", draftId);
  await kick(id);
  return { runId: id };
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
