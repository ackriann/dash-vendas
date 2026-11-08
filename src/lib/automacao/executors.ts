import "server-only";
import { db } from "../db";
import { startOfDayUtc } from "../dates";
import { MetaError, listPages, type MetaAuth } from "../meta";
import { authForAccount, listAccounts, profileAuth } from "../profiles";
import { NEEDS_PIXEL, needsBidAmount, type DraftData } from "./types";
import {
  adsVolume, batchStatus, createIn, findRecentByName, getEffectiveStatus, itemsBatch, listProducts, pageDetails, promotePages,
} from "./meta-ads";
import { ensureOnAccount, getMedia, type MediaAsset } from "./media";
import { onRunFinished, registerExecutor, type ExecCtx, type Outcome } from "./queue";

// =====================================================================
// O que cada operação da fila faz na Meta.
// =====================================================================

const cents = (v: number | null | undefined) => Math.round(Number(v || 0) * 100);

function draftOf(ctx: ExecCtx): DraftData {
  const d = ctx.run.summary?.draft as DraftData | undefined;
  if (!d) throw new Error("Processo sem a configuração da campanha.");
  return d;
}

async function accountTz(act: string): Promise<string> {
  const { data } = await db().from("ad_accounts").select("timezone_name").eq("id", act).maybeSingle();
  return data?.timezone_name || "America/Sao_Paulo";
}

/** "2026-11-07T10:30" no fuso da conta → unix (segundos). */
function localToUnix(v: string, tz: string): number | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  if (!m) return undefined;
  return Math.floor((startOfDayUtc(m[1], tz).getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60000) / 1000);
}

/** Antes de criar de novo, confere se a tentativa anterior já criou (resposta perdida). */
async function createOnce(
  ctx: ExecCtx,
  auth: MetaAuth,
  parent: string,
  edge: "campaigns" | "adsets" | "ads",
  params: Record<string, unknown>,
): Promise<{ id: string; reused: boolean }> {
  if (ctx.job.attempts > 1 && ctx.job.started_at) {
    const found = await findRecentByName(auth, parent, edge, String(params.name), ctx.job.started_at);
    if (found) return { id: found.id, reused: true };
  }
  const r = await createIn<{ id: string }>(auth, `${parent}/${edge}`, params);
  return { id: r.id, reused: false };
}

// ------------------------------------------------------------- Publicação de campanha

registerExecutor("campaign", async (ctx) => {
  const d = draftOf(ctx);
  const c = d.campaign;
  const auth = await authForAccount(d.accountId);
  const params: Record<string, unknown> = {
    name: c.name.trim(),
    objective: c.objective,
    status: c.status,
    buying_type: "AUCTION",
    special_ad_categories: c.specialCategories ?? [],
  };
  if (c.budgetLevel === "campaign") {
    params[c.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"] = cents(c.budget);
    params.bid_strategy = c.bidStrategy;
  } else {
    params.is_adset_budget_sharing_enabled = false;
  }
  if (d.creative.mode === "catalog" && c.catalogId) params.promoted_object = { product_catalog_id: c.catalogId };
  const r = await createOnce(ctx, auth, d.accountId, "campaigns", params);
  return { status: "done", metaId: r.id, result: { id: r.id }, message: r.reused ? "Já criada na tentativa anterior (reaproveitada)" : `Campanha ${r.id}` };
});

registerExecutor("adset", async (ctx) => {
  const d = draftOf(ctx);
  const campaignId = ctx.done.campaign?.id;
  if (!campaignId) throw new Error("A campanha ainda não foi criada.");
  const a = d.adset;
  const c = d.campaign;
  const auth = await authForAccount(d.accountId);
  const tz = await accountTz(d.accountId);

  const targeting: Record<string, unknown> = {
    geo_locations: {
      ...(a.countries.length ? { countries: a.countries } : {}),
      ...(a.regions.length ? { regions: a.regions.map((r) => ({ key: r.key })) } : {}),
      location_types: ["home", "recent"],
    },
    age_min: a.ageMin,
    age_max: a.ageMax,
    targeting_automation: { advantage_audience: a.advantageAudience ? 1 : 0 },
  };
  if (a.genders !== "all") targeting.genders = [a.genders === "male" ? 1 : 2];
  if (a.interests.length) targeting.flexible_spec = [{ interests: a.interests.map((i) => ({ id: i.id, name: i.name })) }];
  if (a.audiences.length) targeting.custom_audiences = a.audiences.map((x) => ({ id: x.id }));
  if (a.excludedAudiences.length) targeting.excluded_custom_audiences = a.excludedAudiences.map((x) => ({ id: x.id }));
  if (a.placements === "manual") {
    targeting.publisher_platforms = a.platforms;
    targeting.device_platforms = ["mobile", "desktop"];
    if (a.platforms.includes("facebook")) targeting.facebook_positions = a.fbPositions;
    if (a.platforms.includes("instagram")) targeting.instagram_positions = a.igPositions;
  }

  const params: Record<string, unknown> = {
    name: a.name.trim(),
    campaign_id: campaignId,
    status: c.status,
    billing_event: "IMPRESSIONS",
    optimization_goal: a.optimizationGoal,
    targeting,
  };
  if (["OFFSITE_CONVERSIONS", "VALUE", "LINK_CLICKS", "LANDING_PAGE_VIEWS"].includes(a.optimizationGoal)) params.destination_type = "WEBSITE";
  const catalog = d.creative.mode === "catalog";
  if (catalog) params.promoted_object = { product_set_id: a.productSetId, ...(a.pixelId ? { pixel_id: a.pixelId, custom_event_type: a.event } : {}) };
  else if (NEEDS_PIXEL.has(a.optimizationGoal)) params.promoted_object = { pixel_id: a.pixelId, custom_event_type: a.event };

  if (c.budgetLevel === "adset") {
    params[c.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"] = cents(a.budget);
    params.bid_strategy = c.bidStrategy;
  }
  if (needsBidAmount(c.bidStrategy)) params.bid_amount = cents(a.bidAmount);
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS") params.bid_constraints = { roas_average_floor: Math.round(Number(a.roasFloor) * 10000) };
  const start = localToUnix(a.startTime, tz);
  const end = localToUnix(a.endTime, tz);
  if (start && start > Date.now() / 1000) params.start_time = start;
  if (end) params.end_time = end;

  const r = await createOnce(ctx, auth, d.accountId, "adsets", params);
  return { status: "done", metaId: r.id, result: { id: r.id }, message: r.reused ? "Já criado na tentativa anterior (reaproveitado)" : `Conjunto ${r.id}` };
});

registerExecutor("media", async (ctx) => {
  const d = draftOf(ctx);
  const asset = await getMedia(String(ctx.job.input.assetId));
  if (!asset) throw new Error("Mídia não encontrada na biblioteca (foi excluída?).");
  const auth = await authForAccount(d.accountId);
  const r = await ensureOnAccount(auth, d.accountId, asset);
  if (r.state === "processing") {
    return {
      status: "waiting_sync",
      delayMs: 10_000,
      metaId: r.video_id,
      result: { video_id: r.video_id },
      message: `Vídeo enviado; a Meta está processando${r.progress ? ` (${r.progress}%)` : ""}`,
      maxPolls: 90,
    };
  }
  return {
    status: "done",
    metaId: r.hash ?? r.video_id ?? null,
    result: { kind: asset.kind, hash: r.hash, video_id: r.video_id, thumbnail_url: r.thumbnail_url, name: asset.name },
    message: asset.kind === "image" ? `Imagem na conta (hash ${r.hash?.slice(0, 10)}…)` : `Vídeo pronto (${r.video_id})`,
  };
});

function ctaOf(d: DraftData, withLink: boolean) {
  if (d.creative.cta === "NO_BUTTON") return undefined;
  return withLink ? { type: d.creative.cta, value: { link: d.creative.url } } : { type: d.creative.cta };
}

/** Monta o criativo (usado na publicação e na prévia oficial). */
export function buildCreativeSpec(d: DraftData, media: { kind: string; hash?: string; video_id?: string; thumbnail_url?: string } | null) {
  const cr = d.creative;
  const ig = cr.instagramId ? { instagram_user_id: cr.instagramId } : {};
  if (cr.mode === "catalog") {
    return {
      product_set_id: d.adset.productSetId,
      object_story_spec: {
        page_id: cr.pageId,
        ...ig,
        template_data: {
          link: cr.url,
          message: cr.message,
          name: cr.headline || "{{product.name}}",
          description: cr.description || "{{product.current_price}}",
          call_to_action: ctaOf(d, false),
          format_option: cr.catalogFormat,
          multi_share_end_card: false,
        },
      },
      ...(cr.urlTags ? { url_tags: cr.urlTags } : {}),
    };
  }
  if (!media) throw new Error("Criativo sem mídia.");
  const story =
    media.kind === "video"
      ? {
          video_data: {
            video_id: media.video_id,
            image_url: media.thumbnail_url,
            message: cr.message,
            title: cr.headline || undefined,
            link_description: cr.description || undefined,
            call_to_action: ctaOf(d, true) ?? { type: "LEARN_MORE", value: { link: cr.url } },
          },
        }
      : {
          link_data: {
            link: cr.url,
            image_hash: media.hash,
            message: cr.message,
            name: cr.headline || undefined,
            description: cr.description || undefined,
            call_to_action: ctaOf(d, true),
          },
        };
  return {
    object_story_spec: { page_id: cr.pageId, ...ig, ...story },
    ...(cr.urlTags ? { url_tags: cr.urlTags } : {}),
  };
}

registerExecutor("creative", async (ctx) => {
  const d = draftOf(ctx);
  const auth = await authForAccount(d.accountId);
  const mediaKey = ctx.job.input.mediaKey as string | undefined;
  const media = mediaKey ? (ctx.done[mediaKey] as any) : null;
  if (mediaKey && !media) throw new Error("A mídia deste anúncio ainda não está pronta.");
  const spec = buildCreativeSpec(d, media);
  const r = await createIn<{ id: string }>(auth, `${d.accountId}/adcreatives`, { name: `${ctx.job.input.adName} · criativo`, ...spec });
  return { status: "done", metaId: r.id, result: { id: r.id }, message: `Criativo ${r.id}` };
});

registerExecutor("ad", async (ctx) => {
  const d = draftOf(ctx);
  const adsetId = ctx.done.adset?.id;
  const creativeId = ctx.done[String(ctx.job.input.creativeKey)]?.id;
  if (!adsetId || !creativeId) throw new Error("Conjunto ou criativo ainda não criados.");
  const auth = await authForAccount(d.accountId);
  const r = await createOnce(ctx, auth, d.accountId, "ads", {
    name: String(ctx.job.input.adName),
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: d.campaign.status,
  });
  return { status: "done", metaId: r.id, result: { id: r.id }, message: r.reused ? "Já criado na tentativa anterior (reaproveitado)" : `Anúncio ${r.id}` };
});

const IN_REVIEW = new Set(["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED", "PENDING_BILLING_INFO"]);

/** Publicação na Meta: acompanha a revisão dos anúncios criados. */
registerExecutor("review", async (ctx) => {
  const d = draftOf(ctx);
  const auth = await authForAccount(d.accountId);
  const ids = Object.entries(ctx.done).filter(([k]) => k.startsWith("ad:")).map(([, v]) => v.id as string);
  if (!ids.length) return { status: "skipped", message: "Nenhum anúncio para acompanhar" };
  const st = await Promise.all(ids.map((id) => getEffectiveStatus(auth, id)));
  const rejected = st.filter((s) => s.effective_status === "DISAPPROVED" || s.effective_status === "WITH_ISSUES");
  if (rejected.length) {
    const why = rejected
      .map((s) => Object.values(s.ad_review_feedback?.global ?? {}).join(" ") || s.issues_info?.[0]?.error_message || s.effective_status)
      .join(" · ");
    throw new MetaError(`${rejected.length} anúncio(s) reprovado(s) ou com problema: ${why}`);
  }
  const pending = st.filter((s) => IN_REVIEW.has(s.effective_status));
  const result = { statuses: Object.fromEntries(st.map((s) => [s.id, s.effective_status])) };
  if (pending.length) {
    // Acompanha por ~10 min; depois disso a revisão segue na tela Campanhas publicadas
    if (ctx.job.polls >= 20) return { status: "done", result, message: `${pending.length} anúncio(s) ainda em revisão pela Meta — acompanhe em Campanhas publicadas` };
    return { status: "waiting_sync", delayMs: 30_000, result, message: `${pending.length} de ${st.length} anúncio(s) em revisão pela Meta`, maxPolls: 25 };
  }
  return { status: "done", result, message: `Publicado: ${st.map((s) => s.effective_status.toLowerCase().replace(/_/g, " ")).join(", ")}` };
});

onRunFinished("publish", async (run, jobs) => {
  if (!run.ref_id) return;
  const ids = {
    campaign_id: jobs.find((j) => j.key === "campaign")?.meta_id ?? null,
    adset_id: jobs.find((j) => j.key === "adset")?.meta_id ?? null,
    ad_ids: jobs.filter((j) => j.key.startsWith("ad:")).map((j) => j.meta_id).filter(Boolean),
  };
  await db().from("ops_runs").update({ summary: { ...run.summary, ids } }).eq("id", run.id);
  // Rascunho em várias contas: um processo por conta, o status do rascunho olha todos
  const { data: siblings } = await db().from("ops_runs").select("id,status").eq("kind", "publish").eq("ref_id", run.ref_id);
  const all = (siblings ?? []).map((r: any) => (r.id === run.id ? run.status : r.status));
  const status = all.some((s) => s === "failed" || s === "canceled") ? "failed" : all.every((s) => s === "done") ? "published" : null;
  if (status) await db().from("auto_drafts").update({ status, updated_at: new Date().toISOString() }).eq("id", run.ref_id);
});

// ------------------------------------------------------------- Sincronização de Páginas

/** Primeiro passo: quais contas de anúncio do perfil podem anunciar com cada Página. */
registerExecutor("page_map", async (ctx) => {
  const profileId = String(ctx.job.input.profileId);
  const auth = await profileAuth(profileId);
  const accounts = (await listAccounts()).filter((a) => a.profile_id === profileId);
  // Contas ativas no painel primeiro; limite para não estourar as chamadas
  const chosen = [...accounts.filter((a) => a.enabled), ...accounts.filter((a) => !a.enabled)].slice(0, 25);
  const map: Record<string, { id: string; name: string }[]> = {};
  for (const acc of chosen) {
    for (const p of await promotePages(auth, acc.id)) (map[p.id] ??= []).push({ id: acc.id, name: acc.name });
  }
  const tasks: Record<string, string[]> = {};
  for (const p of await listPages(auth)) tasks[p.id] = p.tasks ?? [];
  return { status: "done", result: { map, tasks, accountsChecked: chosen.length }, message: `${chosen.length} conta(s) de anúncio consultada(s)` };
});

registerExecutor("page", async (ctx) => {
  const profileId = String(ctx.job.input.profileId);
  const pageId = String(ctx.job.input.pageId);
  const auth = await profileAuth(profileId);
  const prep = ctx.done.page_map ?? {};
  const info = await pageDetails(auth, pageId);
  const related: { id: string; name: string }[] = prep.map?.[pageId] ?? [];

  const accounts: { id: string; name: string; running: number | null; limit: number | null; error?: string }[] = [];
  for (const acc of related.slice(0, 10)) {
    try {
      const v = await adsVolume(auth, acc.id, pageId);
      accounts.push({ id: acc.id, name: acc.name, running: v?.ads_running_or_in_review_count ?? null, limit: v?.limit_on_ads_running_or_in_review ?? null });
    } catch (e: any) {
      accounts.push({ id: acc.id, name: acc.name, running: null, limit: null, error: e?.message });
    }
  }
  const nums = (k: "running" | "limit") => accounts.map((a) => a[k]).filter((x): x is number => typeof x === "number");
  const running = nums("running").length ? Math.max(...nums("running")) : null;
  const limit = nums("limit").length ? Math.max(...nums("limit")) : null;

  const { data: existing } = await db().from("fb_pages").select("enabled_in_creator").eq("page_id", pageId).maybeSingle();
  const row = {
    page_id: pageId,
    profile_id: profileId,
    name: info.name,
    picture_url: info.picture?.data?.url ?? null,
    category: info.category ?? null,
    tasks: prep.tasks?.[pageId] ?? [],
    instagram_id: info.instagram_business_account?.id ?? null,
    instagram_username: info.instagram_business_account?.username ?? null,
    ad_accounts: accounts,
    ads_running: running,
    ads_limit: limit,
    enabled_in_creator: existing?.enabled_in_creator ?? true,
    synced_at: new Date().toISOString(),
    sync_error: null,
  };
  const { error } = await db().from("fb_pages").upsert(row, { onConflict: "workspace_id,page_id" });
  if (error) throw new Error(error.message);
  const lim = limit !== null ? ` · ${running ?? "?"} de ${limit} anúncios` : "";
  return { status: "done", metaId: pageId, result: { name: info.name, accounts: accounts.length, running, limit }, message: `${info.name} · ${accounts.length} conta(s)${lim}` };
});

// ------------------------------------------------------------- Atualização de catálogo

interface CatalogItemInput {
  profileId: string;
  catalogId: string;
  method: "CREATE" | "UPDATE";
  retailerId: string;
  productId?: string | null;
  productName?: string | null;
  data: Record<string, unknown>;
  previousMedia?: unknown;
  currentMedia?: unknown;
  scheduleId?: string | null;
}

registerExecutor("catalog_item", async (ctx) => {
  const i = ctx.job.input as CatalogItemInput;
  const auth = await profileAuth(i.profileId);
  // O registro do histórico nasce antes do envio: se der erro, fica registrado
  let logId = ctx.job.result?.logId as number | undefined;
  if (!logId) {
    const { data } = await db()
      .from("catalog_update_logs")
      .insert({
        run_id: ctx.run.id,
        schedule_id: i.scheduleId ?? null,
        catalog_id: i.catalogId,
        product_id: i.productId ?? null,
        retailer_id: i.retailerId,
        product_name: i.productName ?? null,
        previous_media: i.previousMedia ?? null,
        current_media: i.currentMedia ?? null,
        sync_status: "waiting",
      })
      .select("id")
      .single();
    logId = data?.id;
  }
  try {
    const r = await itemsBatch(auth, i.catalogId, [{ method: i.method, data: { id: i.retailerId, ...i.data } }]);
    await db().from("catalog_update_logs").update({ meta_response: r, updated_at: new Date().toISOString() }).eq("id", logId);
    return { status: "done", result: { handle: r.handles?.[0] ?? null, logId, retailerId: i.retailerId }, message: `${i.method === "CREATE" ? "Produto enviado" : "Alteração enviada"}: ${i.productName ?? i.retailerId}` };
  } catch (e: any) {
    await db().from("catalog_update_logs").update({ sync_status: "error", error: e?.message ?? "erro", updated_at: new Date().toISOString() }).eq("id", logId);
    throw e;
  }
});

/** Espera a Meta processar os lotes e lê o status de revisão de cada produto. */
registerExecutor("catalog_check", async (ctx): Promise<Outcome> => {
  const { profileId, catalogId, scheduleId } = ctx.job.input as { profileId: string; catalogId: string; scheduleId?: string | null };
  const auth = await profileAuth(profileId);
  const items = Object.entries(ctx.done).filter(([k]) => k.startsWith("item:")).map(([, v]) => v as { handle: string | null; logId: number; retailerId: string });

  const errorsByRetailer: Record<string, string> = {};
  for (const it of items) {
    if (!it.handle) continue;
    const st = await batchStatus(auth, catalogId, it.handle);
    if (st.status && st.status !== "finished" && st.status !== "error" && st.status !== "canceled") {
      return { status: "waiting_sync", delayMs: 15_000, message: "A Meta está processando o lote do catálogo", maxPolls: 40 };
    }
    for (const er of st.errors ?? []) errorsByRetailer[er.id ?? it.retailerId] = er.message ?? "erro";
  }

  const products = await listProducts(auth, catalogId, 3).catch(() => []);
  let synced = 0;
  let rejected = 0;
  for (const it of items) {
    const p = products.find((x) => x.retailer_id === it.retailerId);
    const err = errorsByRetailer[it.retailerId];
    const review = p?.review_status;
    const status = err ? "error" : review === "rejected" ? "rejected" : review === "pending" || review === "outdated" ? "waiting" : "synced";
    if (status === "synced") synced++;
    if (status === "rejected") rejected++;
    await db()
      .from("catalog_update_logs")
      .update({
        product_id: p?.id ?? null,
        sync_status: status,
        error: err ?? (status === "rejected" ? (p?.review_rejection_reasons ?? []).join(", ") || "Reprovado na revisão da Meta" : null),
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.logId);
  }
  // Produto reprovado: a automação para — nada de insistir contra a revisão da Meta
  if (scheduleId && rejected) {
    await db().from("catalog_schedules").update({ active: false, last_result: `Pausada: ${rejected} produto(s) reprovado(s) na revisão da Meta` }).eq("id", scheduleId);
  }
  const pendingReview = items.length - synced - rejected - Object.keys(errorsByRetailer).length;
  return {
    status: "done",
    result: { synced, rejected, errors: Object.keys(errorsByRetailer).length },
    message: `${synced} sincronizado(s)${pendingReview > 0 ? ` · ${pendingReview} em revisão` : ""}${rejected ? ` · ${rejected} reprovado(s)` : ""}${Object.keys(errorsByRetailer).length ? ` · ${Object.keys(errorsByRetailer).length} com erro` : ""}`,
  };
});

onRunFinished("catalog_update", async (run) => {
  const scheduleId = run.summary?.scheduleId as string | undefined;
  if (!scheduleId) return;
  await db()
    .from("catalog_schedules")
    .update({ last_result: run.status === "done" ? "Concluída" : "Falhou — veja o processo" })
    .eq("id", scheduleId)
    .eq("active", true);
});

export type { MediaAsset };
