import "server-only";
import { createHmac } from "crypto";
import { env } from "./env";

// =====================================================================
// Cliente mínimo da Graph API / Marketing API da Meta.
// Cada perfil conectado tem o próprio token + app (App ID e chave secreta);
// toda chamada vai assinada com appsecret_proof do app daquele perfil.
// =====================================================================

export interface MetaAuth {
  token: string;
  appSecret?: string | null;
}

export class MetaError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

const base = () => `https://graph.facebook.com/${env.metaApiVersion}`;

type Params = Record<string, string | number | boolean | undefined | null | object>;

function encode(params: Params): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return sp;
}

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

function authParams(auth: MetaAuth): Params {
  return { access_token: auth.token, appsecret_proof: auth.appSecret ? appSecretProof(auth.token, auth.appSecret) : undefined };
}

function toError(json: any, status: number): MetaError {
  const e = json?.error ?? {};
  return new MetaError(e.error_user_msg || e.message || `Erro ${status} na API da Meta`, e.code, e.error_subcode);
}

export async function graph<T = any>(
  path: string,
  opts: { method?: "GET" | "POST" | "DELETE"; params?: Params; auth: MetaAuth },
): Promise<T> {
  const method = opts.method ?? "GET";
  const params = encode({ ...(opts.params ?? {}), ...authParams(opts.auth) });
  const url = path.startsWith("http") ? path : `${base()}/${path.replace(/^\//, "")}`;

  const res = await fetch(method === "POST" ? url : `${url}${url.includes("?") ? "&" : "?"}${params}`, {
    method,
    cache: "no-store",
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: method === "POST" ? params : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw toError(json, res.status);
  return json as T;
}

/** Busca todas as páginas de um endpoint de lista (segue paging.next). */
export async function graphAll<T = any>(path: string, params: Params, auth: MetaAuth, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let res = await graph<{ data: T[]; paging?: { next?: string } }>(path, { params: { limit: 500, ...params }, auth });
  out.push(...(res.data ?? []));
  let pages = 1;
  while (res.paging?.next && pages < maxPages) {
    const next = new URL(res.paging.next);
    for (const [k, v] of Object.entries(authParams(auth))) if (v) next.searchParams.set(k, String(v));
    const r = await fetch(next, { cache: "no-store" });
    res = await r.json();
    if ((res as any).error) break;
    out.push(...(res.data ?? []));
    pages++;
  }
  return out;
}

// ------------------------------------------------------------- Conexão por token + app

/** Permissões que o token precisa ter (ads_read é o mínimo para o painel funcionar). */
export const META_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_posts",
  "pages_manage_metadata",
  "pages_manage_engagement",
];

const appToken = (appId: string, appSecret: string) => `${appId}|${appSecret}`;

async function rawGet(path: string, params: Record<string, string>) {
  const res = await fetch(`${base()}/${path}?${new URLSearchParams(params)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw toError(json, res.status);
  return json;
}

/** Confere se App ID + chave secreta são válidos e devolve o nome do app. */
export async function checkApp(appId: string, appSecret: string): Promise<{ id: string; name: string }> {
  return rawGet(appId, { fields: "id,name", access_token: appToken(appId, appSecret) });
}

export interface TokenInfo {
  app_id: string;
  type: string; // USER | SYSTEM_USER | PAGE | APP
  is_valid: boolean;
  expires_at: number; // 0 = não expira
  data_access_expires_at?: number;
  scopes: string[];
  user_id?: string;
  error?: { message: string };
}

/** Lê os dados do token usando o próprio app (debug_token). */
export async function debugToken(token: string, appId: string, appSecret: string): Promise<TokenInfo> {
  const r = await rawGet("debug_token", { input_token: token, access_token: appToken(appId, appSecret) });
  return r.data as TokenInfo;
}

/** Troca um token de usuário pelo de longa duração (≈60 dias) usando o app do perfil. */
export async function exchangeForLongToken(
  token: string,
  appId: string,
  appSecret: string,
): Promise<{ token: string; expiresIn: number | null }> {
  const r = await rawGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
  });
  return { token: r.access_token, expiresIn: r.expires_in ?? null };
}

export const oauthRedirectUri = () => `${env.appUrl}/api/auth/facebook/callback`;

/** Link do login com Facebook usando o app informado. */
export function oauthUrl(appId: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: oauthRedirectUri(),
    state,
    scope: META_SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${env.metaApiVersion}/dialog/oauth?${p}`;
}

/** Troca o código do login pelo token de usuário (depois validateToken troca pelo de 60 dias). */
export async function exchangeCode(appId: string, appSecret: string, code: string): Promise<string> {
  const r = await rawGet("oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: oauthRedirectUri(),
    code,
  });
  return r.access_token;
}

export async function whoAmI(auth: MetaAuth): Promise<{ id: string; name: string }> {
  return graph("me", { params: { fields: "id,name" }, auth });
}

// ------------------------------------------------------------- Contas de anúncio

export interface AdAccount {
  id: string; // act_123
  account_id: string;
  name: string;
  currency: string;
  account_status: number;
  timezone_name?: string;
  amount_spent?: string;
  balance?: string;
}

export async function listAdAccounts(auth: MetaAuth): Promise<AdAccount[]> {
  return graphAll<AdAccount>(
    "me/adaccounts",
    { fields: "id,account_id,name,currency,account_status,timezone_name,amount_spent,balance" },
    auth,
  );
}

export const ACCOUNT_STATUS: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Pendente de pagamento",
  7: "Em análise de risco",
  8: "Pagamento pendente",
  9: "Em período de carência",
  100: "Fechamento pendente",
  101: "Fechada",
};

// ------------------------------------------------------------- Insights

export type Level = "campaign" | "adset" | "ad";

export interface InsightRow {
  id: string;
  name: string;
  campaign_id?: string;
  adset_id?: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  link_clicks: number;
  cpm: number;
  cpc: number;
  ctr: number;
  landing_page_views: number;
  initiate_checkout: number;
  add_payment_info: number;
  meta_purchases: number;
  meta_purchase_value: number;
  video_3s: number;
}

function actionValue(list: any[] | undefined, types: string[]): number {
  if (!list) return 0;
  for (const t of types) {
    const f = list.find((a) => a.action_type === t);
    if (f) return Number(f.value) || 0;
  }
  return 0;
}

const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
const IC_TYPES = ["initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];
const API_TYPES = ["add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"];
const LPV_TYPES = ["landing_page_view", "omni_landing_page_view"];

export async function getInsights(auth: MetaAuth, accountId: string, level: Level, since: string, until: string): Promise<InsightRow[]> {
  const idField = `${level}_id`;
  const nameField = `${level}_name`;
  const fields = [
    idField, nameField,
    ...(level !== "campaign" ? ["campaign_id"] : []),
    ...(level === "ad" ? ["adset_id"] : []),
    "spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "cpm", "cpc", "ctr",
    "actions", "action_values", "video_play_actions",
  ].join(",");
  const rows = await graphAll<any>(`${accountId}/insights`, { level, fields, time_range: { since, until } }, auth);
  return rows.map((r) => ({
    id: r[idField],
    name: r[nameField],
    campaign_id: r.campaign_id,
    adset_id: r.adset_id,
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    reach: Number(r.reach) || 0,
    frequency: Number(r.frequency) || 0,
    clicks: Number(r.clicks) || 0,
    link_clicks: Number(r.inline_link_clicks) || 0,
    cpm: Number(r.cpm) || 0,
    cpc: Number(r.cpc) || 0,
    ctr: Number(r.ctr) || 0,
    landing_page_views: actionValue(r.actions, LPV_TYPES),
    initiate_checkout: actionValue(r.actions, IC_TYPES),
    add_payment_info: actionValue(r.actions, API_TYPES),
    meta_purchases: actionValue(r.actions, PURCHASE_TYPES),
    meta_purchase_value: actionValue(r.action_values, PURCHASE_TYPES),
    video_3s: actionValue(r.actions, ["video_view"]),
  }));
}

export async function getDailySpend(auth: MetaAuth, accountId: string, since: string, until: string): Promise<{ date: string; spend: number }[]> {
  const rows = await graphAll<any>(
    `${accountId}/insights`,
    { level: "account", fields: "spend", time_range: { since, until }, time_increment: 1 },
    auth,
  );
  return rows.map((r) => ({ date: r.date_start, spend: Number(r.spend) || 0 }));
}

export async function getHourlySpend(auth: MetaAuth, accountId: string, day: string): Promise<{ hour: number; spend: number }[]> {
  const rows = await graphAll<any>(
    `${accountId}/insights`,
    {
      level: "account",
      fields: "spend",
      time_range: { since: day, until: day },
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
    },
    auth,
  );
  return rows.map((r) => ({
    hour: Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "0").slice(0, 2)),
    spend: Number(r.spend) || 0,
  }));
}

// ------------------------------------------------------------- Campanhas / conjuntos / anúncios

export interface AdObject {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
}

const EDGE: Record<Level, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };

export async function listObjects(auth: MetaAuth, accountId: string, level: Level): Promise<AdObject[]> {
  const fields =
    level === "campaign"
      ? "id,name,status,effective_status,daily_budget,lifetime_budget"
      : level === "adset"
        ? "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id"
        : "id,name,status,effective_status,campaign_id,adset_id";
  return graphAll<AdObject>(
    `${accountId}/${EDGE[level]}`,
    { fields, filtering: [{ field: "effective_status", operator: "NOT_IN", value: ["DELETED", "ARCHIVED"] }] },
    auth,
  );
}

export async function setObjectStatus(auth: MetaAuth, id: string, status: "ACTIVE" | "PAUSED") {
  return graph(id, { method: "POST", params: { status }, auth });
}

/** Orçamento diário em unidades da moeda (ex.: 50.00). A API recebe em centavos. */
export async function setDailyBudget(auth: MetaAuth, id: string, amount: number) {
  return graph(id, { method: "POST", params: { daily_budget: Math.round(amount * 100) }, auth });
}

export async function getDailyBudget(auth: MetaAuth, id: string): Promise<number | null> {
  const r = await graph<{ daily_budget?: string }>(id, { params: { fields: "daily_budget" }, auth });
  return r.daily_budget ? Number(r.daily_budget) / 100 : null;
}

/** Duplica campanha/conjunto/anúncio (a cópia nasce pausada). */
export async function duplicateObject(auth: MetaAuth, id: string, level: Level) {
  const params: Params = { status_option: "PAUSED" };
  if (level !== "ad") params.deep_copy = true;
  return graph<{ copied_campaign_id?: string; copied_adset_id?: string; copied_ad_id?: string }>(`${id}/copies`, {
    method: "POST",
    params,
    auth,
  });
}

// ------------------------------------------------------------- Páginas do Facebook

export interface FbPage {
  id: string;
  name: string;
  category?: string;
  link?: string;
  about?: string;
  description?: string;
  website?: string;
  phone?: string;
  emails?: string[];
  fan_count?: number;
  followers_count?: number;
  is_published?: boolean;
  verification_status?: string;
  picture?: { data?: { url?: string } };
  cover?: { source?: string };
  tasks?: string[];
  access_token?: string;
}

export async function listPages(auth: MetaAuth): Promise<FbPage[]> {
  return graphAll<FbPage>(
    "me/accounts",
    { fields: "id,name,category,link,fan_count,followers_count,is_published,picture.type(large){url},tasks" },
    auth,
  );
}

/** Token da página a partir do token do perfil (mesmo app, então o proof usa a mesma chave). */
export async function pageToken(profile: MetaAuth, pageId: string): Promise<MetaAuth> {
  const r = await graph<{ access_token?: string }>(pageId, { params: { fields: "access_token" }, auth: profile });
  if (!r.access_token) throw new MetaError("Sem permissão para gerenciar esta página (token de página indisponível).");
  return { token: r.access_token, appSecret: profile.appSecret };
}

// As funções abaixo recebem o auth da PÁGINA (veja pageAuth em profiles.ts).

export async function getPage(auth: MetaAuth, pageId: string): Promise<FbPage> {
  return graph<FbPage>(pageId, {
    auth,
    params: {
      fields:
        "id,name,category,link,about,description,website,phone,emails,fan_count,followers_count,is_published,verification_status,picture.type(large){url},cover{source}",
    },
  });
}

export async function updatePage(auth: MetaAuth, pageId: string, fields: Record<string, string>) {
  return graph(pageId, { method: "POST", auth, params: fields });
}

export async function setPagePicture(auth: MetaAuth, pageId: string, pictureUrl: string) {
  return graph(`${pageId}/picture`, { method: "POST", auth, params: { picture: pictureUrl } });
}

export async function setPageCover(auth: MetaAuth, pageId: string, imageUrl: string) {
  const photo = await graph<{ id: string }>(`${pageId}/photos`, {
    method: "POST",
    auth,
    params: { url: imageUrl, published: false },
  });
  return graph(pageId, { method: "POST", auth, params: { cover: photo.id } });
}

export async function publishPost(
  auth: MetaAuth,
  pageId: string,
  p: { message?: string; link?: string; imageUrl?: string; scheduleAt?: number | null },
) {
  const schedule = p.scheduleAt ? { published: false, scheduled_publish_time: p.scheduleAt } : {};
  if (p.imageUrl) {
    return graph(`${pageId}/photos`, { method: "POST", auth, params: { url: p.imageUrl, caption: p.message, ...schedule } });
  }
  return graph(`${pageId}/feed`, { method: "POST", auth, params: { message: p.message, link: p.link, ...schedule } });
}

export interface PagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  is_published?: boolean;
  scheduled_publish_time?: number;
  comments?: { summary?: { total_count?: number } };
}

const POST_FIELDS = "id,message,created_time,permalink_url,full_picture,is_published,comments.summary(true).limit(0)";

export async function listPosts(auth: MetaAuth, pageId: string): Promise<PagePost[]> {
  const r = await graph<{ data: PagePost[] }>(`${pageId}/feed`, { auth, params: { fields: POST_FIELDS, limit: 25 } });
  return r.data ?? [];
}

export async function listScheduledPosts(auth: MetaAuth, pageId: string): Promise<PagePost[]> {
  const r = await graph<{ data: PagePost[] }>(`${pageId}/scheduled_posts`, {
    auth,
    params: { fields: "id,message,created_time,scheduled_publish_time,full_picture", limit: 25 },
  });
  return r.data ?? [];
}

/** Posts usados em anúncios (dark posts) — onde ficam os comentários dos anúncios. */
export async function listAdsPosts(auth: MetaAuth, pageId: string): Promise<PagePost[]> {
  const r = await graph<{ data: PagePost[] }>(`${pageId}/ads_posts`, { auth, params: { fields: POST_FIELDS, limit: 25 } });
  return r.data ?? [];
}

export interface PageComment {
  id: string;
  message: string;
  created_time: string;
  from?: { id: string; name: string };
  is_hidden?: boolean;
  can_hide?: boolean;
}

export async function listComments(auth: MetaAuth, postId: string): Promise<PageComment[]> {
  const r = await graph<{ data: PageComment[] }>(`${postId}/comments`, {
    auth,
    params: { fields: "id,message,created_time,from,is_hidden,can_hide", filter: "stream", order: "reverse_chronological", limit: 50 },
  });
  return r.data ?? [];
}

export async function hideComment(auth: MetaAuth, commentId: string, hidden: boolean) {
  return graph(commentId, { method: "POST", auth, params: { is_hidden: hidden } });
}

export async function replyComment(auth: MetaAuth, commentId: string, message: string) {
  return graph(`${commentId}/comments`, { method: "POST", auth, params: { message } });
}

export async function deleteObject(auth: MetaAuth, objectId: string) {
  return graph(objectId, { method: "DELETE", auth });
}

/**
 * Criação de página pela API (com o token do PERFIL). A Meta só permite para apps
 * aprovados (ou usuários de teste). Se recusar, o painel mostra o link de criação manual.
 */
export async function createPage(auth: MetaAuth, p: { name: string; category_enum: string; about?: string }) {
  return graph<{ id: string }>("me/accounts", { method: "POST", params: p, auth });
}
