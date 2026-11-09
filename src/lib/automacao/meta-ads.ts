import "server-only";
import { graph, graphAll, MetaError, pageToken, type MetaAuth } from "../meta";

// =====================================================================
// Chamadas da Marketing API usadas pela Automação de Campanhas.
// Tudo passa pelo cliente que já existe (graph/graphAll em lib/meta.ts):
// mesmo token do perfil conectado, mesmo appsecret_proof, mesmo tratamento de erro.
// =====================================================================

type P = Record<string, unknown>;

// ------------------------------------------------------------- Consultas para o assistente

export async function listAccountPixels(auth: MetaAuth, act: string) {
  return graphAll<{ id: string; name: string; last_fired_time?: string }>(`${act}/adspixels`, { fields: "id,name,last_fired_time" }, auth, 3);
}

/** BM dono do pixel (para saber se dá para compartilhar com outra conta do mesmo BM). */
export async function pixelOwner(auth: MetaAuth, pixelId: string) {
  const r = await graph<{ owner_business?: { id: string; name: string } }>(pixelId, { params: { fields: "owner_business{id,name}" }, auth });
  return r.owner_business ?? null;
}

/** Pixels que o BM enxerga: os dele e os que outros BMs compartilharam com ele. */
export async function businessPixelIds(auth: MetaAuth, businessId: string): Promise<Set<string>> {
  const [owned, client] = await Promise.all([
    graphAll<{ id: string }>(`${businessId}/adspixels`, { fields: "id" }, auth, 5).catch(() => [] as { id: string }[]),
    graphAll<{ id: string }>(`${businessId}/client_pixels`, { fields: "id" }, auth, 5).catch(() => [] as { id: string }[]),
  ]);
  return new Set([...owned, ...client].map((p) => p.id));
}

/** Liga o pixel a uma conta de anúncio, pelo BM da conta (dono do pixel ou que recebeu o pixel compartilhado). */
export async function sharePixel(auth: MetaAuth, pixelId: string, act: string, businessId: string) {
  return graph<{ success?: boolean }>(`${pixelId}/shared_accounts`, {
    method: "POST",
    params: { account_id: act.replace(/^act_/, ""), business: businessId },
    auth,
  });
}

export async function accountInfo(auth: MetaAuth, act: string) {
  return graph<{ id: string; name: string; currency: string; account_status: number; timezone_name?: string; business?: { id: string; name: string } }>(act, {
    params: { fields: "id,name,currency,account_status,timezone_name,business{id,name}" },
    auth,
  });
}

export interface Catalog { id: string; name: string; product_count?: number; vertical?: string; business_id?: string }

export async function listBusinesses(auth: MetaAuth) {
  return graphAll<{ id: string; name: string }>("me/businesses", { fields: "id,name" }, auth, 3);
}

export async function listBusinessCatalogs(auth: MetaAuth, businessId: string): Promise<Catalog[]> {
  const fields = "id,name,product_count,vertical";
  const [owned, client] = await Promise.all([
    graphAll<Catalog>(`${businessId}/owned_product_catalogs`, { fields }, auth, 3).catch(() => [] as Catalog[]),
    graphAll<Catalog>(`${businessId}/client_product_catalogs`, { fields }, auth, 3).catch(() => [] as Catalog[]),
  ]);
  const seen = new Set<string>();
  return [...owned, ...client].filter((c) => !seen.has(c.id) && seen.add(c.id)).map((c) => ({ ...c, business_id: businessId }));
}

/**
 * BM em que a conta está: o dono dela ou, para conta pessoal, o BM que a tem como
 * conta de cliente/parceiro (e que o perfil conectado enxerga).
 */
export async function accountBusiness(auth: MetaAuth, act: string): Promise<{ id: string; name: string } | null> {
  const info = await accountInfo(auth, act);
  if (info.business?.id) return info.business;
  const [agencies, mine] = await Promise.all([
    graphAll<{ id: string; name: string }>(`${act}/agencies`, { fields: "id,name" }, auth, 2).catch(() => [] as { id: string; name: string }[]),
    listBusinesses(auth).catch(() => [] as { id: string; name: string }[]),
  ]);
  // Prefere um BM que o perfil também acessa; senão, o BM que a Meta diz ter a conta
  const viaAgency = agencies.find((a) => mine.some((m) => m.id === a.id)) ?? agencies[0];
  if (viaAgency) return viaAgency;
  for (const b of mine.slice(0, 20)) {
    const accs = await graphAll<{ id: string }>(`${b.id}/client_ad_accounts`, { fields: "id" }, auth, 5).catch(() => [] as { id: string }[]);
    if (accs.some((a) => a.id === act)) return b;
  }
  return null;
}

export type CatalogBusinessCandidate = {
  id: string;
  name: string;
  relation: "partner" | "owner";
};

/** BMs efetivamente acessíveis pelo token do perfil e associados à conta.
 * A BM proprietária da conta pode ser OUTRA empresa, sem permissão para
 * criar catálogo. Por isso, preferimos BMs parceiras/cliente que o perfil gerencia.
 * Nunca usamos BMs arbitrárias retornadas em me/businesses.
 */
export async function catalogBusinessesForAccount(auth: MetaAuth, act: string): Promise<CatalogBusinessCandidate[]> {
  const [info, mine, agencies] = await Promise.all([
    accountInfo(auth, act),
    listBusinesses(auth),
    graphAll<{ id: string; name: string }>(`${act}/agencies`, { fields: "id,name" }, auth, 3).catch(() => []),
  ]);
  const ownerId = info.business?.id ?? null;
  const agencyIds = new Set(agencies.map((a) => a.id));
  const partnerIds = new Set<string>();

  // Uma BM que recebeu a conta como cliente pode estar em client_ad_accounts
  // mesmo se a API não expuser a agência via /act/agencies.
  for (let i = 0; i < mine.length; i += 6) {
    await Promise.all(mine.slice(i, i + 6).map(async (b) => {
      if (agencyIds.has(b.id)) {
        partnerIds.add(b.id);
        return;
      }
      const client = await graphAll<{ id: string }>(
        `${b.id}/client_ad_accounts`, { fields: "id", limit: 100 }, auth, 5,
      ).catch(() => [] as { id: string }[]);
      if (client.some((a) => a.id === act || a.id === act.replace(/^act_/, ""))) {
        partnerIds.add(b.id);
      }
    }));
  }
  const partners = mine.filter((b) => partnerIds.has(b.id) && b.id !== ownerId)
    .map((b) => ({ ...b, relation: "partner" as const }));
  const owner = mine.filter((b) => b.id === ownerId)
    .map((b) => ({ ...b, relation: "owner" as const }));
  return [...partners, ...owner];
}

/** Catálogo automático: escolher uma BM permitida, priorizando parceiro.
 * Quando há várias parceiras, requer escolha explícita para não criar bens
 * na empresa errada. A BM dona só é padrão se nenhuma parceira está acessível.
 */
export async function resolveCatalogBusiness(
  auth: MetaAuth, act: string, selectedId = "",
): Promise<CatalogBusinessCandidate> {
  const candidates = await catalogBusinessesForAccount(auth, act);
  if (selectedId) {
    const selected = candidates.find((b) => b.id === selectedId);
    if (!selected) throw new MetaError(
      `A BM selecionada (${selectedId}) não tem acesso de parceiro/proprietário à conta ${act} neste perfil. Escolha outra BM em Campanha → Catálogo.`
    );
    return selected;
  }
  const partners = candidates.filter((b) => b.relation === "partner");
  if (partners.length === 1) return partners[0];
  if (partners.length > 1) throw new MetaError(
    "Há mais de uma BM parceira com acesso à conta: escolha a BM correta em Campanha → Catálogo antes de publicar."
  );
  if (candidates.length === 1) return candidates[0];
  throw new MetaError(
    "Não encontrei uma BM autorizada a criar catálogo para esta conta. Confira o perfil, o compartilhamento da conta e a permissão catalog_management."
  );
}

/** Catálogos que a conta de anúncio pode usar (os do BM em que ela está). */
export async function listAccountCatalogs(auth: MetaAuth, act: string): Promise<Catalog[]> {
  const bm = await accountBusiness(auth, act);
  return bm ? listBusinessCatalogs(auth, bm.id) : [];
}

export async function createCatalog(auth: MetaAuth, businessId: string, name: string) {
  return graph<{ id: string }>(`${businessId}/owned_product_catalogs`, { method: "POST", params: { name }, auth });
}

export async function listProductSets(auth: MetaAuth, catalogId: string) {
  return graphAll<{ id: string; name: string; product_count?: number }>(`${catalogId}/product_sets`, { fields: "id,name,product_count" }, auth, 3);
}

export interface ProductItem {
  id: string;
  retailer_id: string;
  name: string;
  description?: string;
  price?: string;
  currency?: string;
  image_url?: string;
  additional_image_urls?: string[];
  url?: string;
  availability?: string;
  condition?: string;
  brand?: string;
  review_status?: string;
  review_rejection_reasons?: string[];
  visibility?: string;
}

const PRODUCT_FIELDS =
  "id,retailer_id,name,description,price,currency,image_url,additional_image_urls,url,availability,condition,brand,review_status,review_rejection_reasons,visibility";

export async function listProducts(auth: MetaAuth, catalogId: string, maxPages = 2): Promise<ProductItem[]> {
  return graphAll<ProductItem>(`${catalogId}/products`, { fields: PRODUCT_FIELDS, limit: 100 }, auth, maxPages);
}

/** Produtos do catálogo com esses retailer_id (filtro da própria API, sem varrer o catálogo inteiro). */
export async function listProductsByRetailer(auth: MetaAuth, catalogId: string, retailerIds: string[]): Promise<ProductItem[]> {
  const out: ProductItem[] = [];
  for (let i = 0; i < retailerIds.length; i += 100) {
    const chunk = retailerIds.slice(i, i + 100);
    out.push(...(await graphAll<ProductItem>(`${catalogId}/products`, {
      fields: PRODUCT_FIELDS,
      limit: 100,
      filter: JSON.stringify({ retailer_id: { is_any: chunk } }),
    }, auth, 2)));
  }
  return out;
}

/** Conjunto de produtos com exatamente esses retailer_id. */
export async function createProductSet(auth: MetaAuth, catalogId: string, name: string, retailerIds: string[]) {
  return graph<{ id: string }>(`${catalogId}/product_sets`, {
    method: "POST",
    params: { name, filter: JSON.stringify({ retailer_id: { is_any: retailerIds } }) },
    auth,
  });
}

/** Liga o pixel ao catálogo (eventos do site casam com os produtos). */
export async function linkPixelToCatalog(auth: MetaAuth, catalogId: string, pixelId: string) {
  return graph<{ success?: boolean }>(`${catalogId}/external_event_sources`, {
    method: "POST",
    params: { external_event_sources: JSON.stringify([pixelId]) },
    auth,
  });
}

export async function getProduct(auth: MetaAuth, productId: string): Promise<ProductItem> {
  return graph<ProductItem>(productId, { params: { fields: PRODUCT_FIELDS }, auth });
}

/** Envia criação/alteração de itens pelo items_batch (aceita imagens e vídeos). Devolve os handles. */
export async function itemsBatch(auth: MetaAuth, catalogId: string, requests: { method: "CREATE" | "UPDATE"; data: P }[]) {
  const r = await graph<{ handles?: string[]; validation_status?: unknown[] }>(`${catalogId}/items_batch`, {
    method: "POST",
    params: { item_type: "PRODUCT_ITEM", allow_upsert: true, requests },
    auth,
  });
  return r;
}

export interface BatchStatus {
  status?: string; // started | finished | canceled | error
  errors_total_count?: number;
  errors?: { id?: string; message?: string }[];
  warnings?: { id?: string; message?: string }[];
}

export async function batchStatus(auth: MetaAuth, catalogId: string, handle: string): Promise<BatchStatus> {
  const r = await graph<{ data?: BatchStatus[] }>(`${catalogId}/check_batch_request_status`, {
    params: { handle, load_ids_of_invalid_requests: true },
    auth,
  });
  return r.data?.[0] ?? {};
}

export async function listInstagramAccounts(auth: MetaAuth, act: string) {
  return graphAll<{ id: string; username?: string }>(`${act}/instagram_accounts`, { fields: "id,username" }, auth, 2).catch(() => []);
}

export async function listCustomAudiences(auth: MetaAuth, act: string) {
  return graphAll<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number }>(
    `${act}/customaudiences`,
    { fields: "id,name,subtype,approximate_count_lower_bound" },
    auth,
    3,
  );
}

export async function searchRegions(auth: MetaAuth, q: string, country?: string) {
  const r = await graph<{ data: { key: string; name: string; country_code?: string; type: string }[] }>("search", {
    params: { type: "adgeolocation", location_types: ["region"], q, country_code: country || undefined, limit: 15 },
    auth,
  });
  return (r.data ?? []).filter((x) => x.type === "region").map((x) => ({ key: x.key, name: x.name, country: x.country_code }));
}

export async function searchInterests(auth: MetaAuth, q: string) {
  const r = await graph<{ data: { id: string; name: string; audience_size_lower_bound?: number }[] }>("search", {
    params: { type: "adinterest", q, limit: 15 },
    auth,
  });
  return r.data ?? [];
}

// ------------------------------------------------------------- Mídias

export async function uploadImageBytes(auth: MetaAuth, act: string, bytesBase64: string, name: string) {
  const r = await graph<{ images: Record<string, { hash: string; url?: string }> }>(`${act}/adimages`, {
    method: "POST",
    params: { bytes: bytesBase64, name },
    auth,
  });
  const img = Object.values(r.images ?? {})[0];
  if (!img?.hash) throw new MetaError("A Meta não devolveu o hash da imagem.");
  return img;
}

export async function uploadVideoFromUrl(auth: MetaAuth, act: string, fileUrl: string, name: string) {
  return graph<{ id: string }>(`${act}/advideos`, { method: "POST", params: { file_url: fileUrl, name }, auth });
}

export async function videoStatus(auth: MetaAuth, videoId: string) {
  return graph<{ id: string; status?: { video_status?: string; processing_progress?: number }; picture?: string }>(videoId, {
    params: { fields: "id,status,picture" },
    auth,
  });
}

// ------------------------------------------------------------- Criação

export async function createIn<T = { id: string }>(auth: MetaAuth, path: string, params: P): Promise<T> {
  return graph<T>(path, { method: "POST", params: params as any, auth });
}

/**
 * Procura um objeto criado agora há pouco com o mesmo nome — usado quando uma tentativa
 * anterior pode ter criado na Meta mas a resposta se perdeu (evita duplicar).
 */
export async function findRecentByName(auth: MetaAuth, parent: string, edge: "campaigns" | "adsets" | "ads", name: string, sinceIso: string) {
  const since = new Date(sinceIso).getTime() - 120_000;
  const rows = await graphAll<{ id: string; name: string; created_time?: string }>(
    `${parent}/${edge}`,
    { fields: "id,name,created_time", filtering: [{ field: "name", operator: "EQUAL", value: name }], limit: 25 },
    auth,
    1,
  ).catch(() => []);
  return rows.find((r) => r.name === name && (!r.created_time || new Date(r.created_time).getTime() >= since)) ?? null;
}

export async function getEffectiveStatus(auth: MetaAuth, adId: string) {
  return graph<{ id: string; effective_status: string; ad_review_feedback?: Record<string, unknown>; issues_info?: { error_message?: string; error_summary?: string }[] }>(adId, {
    params: { fields: "id,effective_status,ad_review_feedback,issues_info" },
    auth,
  });
}

/** Prévia oficial da Meta (devolve o HTML de um iframe). */
export async function generatePreview(auth: MetaAuth, act: string, creative: P, adFormat: string) {
  const r = await graph<{ data: { body: string }[] }>(`${act}/generatepreviews`, {
    params: { creative, ad_format: adFormat },
    auth,
  });
  return r.data?.[0]?.body ?? "";
}

// ------------------------------------------------------------- Páginas x contas de anúncio

export async function promotePages(auth: MetaAuth, act: string) {
  return graphAll<{ id: string; name: string }>(`${act}/promote_pages`, { fields: "id,name" }, auth, 3).catch(() => []);
}

export interface AdsVolume {
  actor_id?: string;
  ads_running_or_in_review_count?: number;
  limit_on_ads_running_or_in_review?: number;
  current_account_ads_running_or_in_review_count?: number;
  future_limit_on_ads_running_or_in_review?: number;
  future_limit_activation_date?: string;
}

/** Limite de anúncios por Página na conta (endpoint ads_volume da Meta). */
export async function adsVolume(auth: MetaAuth, act: string, pageId: string): Promise<AdsVolume | null> {
  const r = await graph<{ data?: AdsVolume[] }>(`${act}/ads_volume`, { params: { page_id: pageId }, auth });
  return r.data?.find((x) => !x.actor_id || x.actor_id === pageId) ?? r.data?.[0] ?? null;
}

/**
 * Identidade do anúncio no Instagram quando não há perfil escolhido: o Instagram
 * ligado à Página ou, se não houver, a conta "apoiada pela Página" (PBIA), que a
 * Meta cria a partir da própria Página (doc "Set Up Instagram Accounts With Pages").
 */
export async function instagramIdentity(auth: MetaAuth, pageId: string): Promise<string | null> {
  const page = await pageDetails(auth, pageId).catch(() => null);
  if (page?.instagram_business_account?.id) return page.instagram_business_account.id;
  const pAuth = await pageToken(auth, pageId);
  const found = await graph<{ data?: { id: string }[] }>(`${pageId}/page_backed_instagram_accounts`, { params: { fields: "id" }, auth: pAuth });
  if (found.data?.[0]?.id) return found.data[0].id;
  const made = await graph<{ id: string }>(`${pageId}/page_backed_instagram_accounts`, { method: "POST", auth: pAuth });
  return made.id ?? null;
}

export async function pageDetails(auth: MetaAuth, pageId: string) {
  // As permissões (tasks) vêm da lista me/accounts, não do nó da Página
  const base = "id,name,category,picture.type(large){url}";
  try {
    return await graph<{ id: string; name: string; category?: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string } }>(pageId, {
      params: { fields: `${base},instagram_business_account{id,username}` },
      auth,
    });
  } catch {
    // Sem instagram_basic a Meta recusa o campo do Instagram: busca o resto
    return graph<{ id: string; name: string; category?: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string } }>(pageId, {
      params: { fields: base },
      auth,
    });
  }
}

// ------------------------------------------------------------- Gerenciamento

export interface ManagedObject {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
  objective?: string;
  created_time?: string;
  issues_info?: { error_message?: string; error_summary?: string; level?: string }[];
  ad_review_feedback?: { global?: Record<string, string>; placement_specific?: unknown };
}

const MANAGE_FIELDS: Record<"campaign" | "adset" | "ad", string> = {
  campaign: "id,name,status,effective_status,daily_budget,lifetime_budget,objective,created_time,issues_info",
  adset: "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id,created_time,issues_info",
  ad: "id,name,status,effective_status,campaign_id,adset_id,created_time,issues_info,ad_review_feedback",
};

export async function listManaged(auth: MetaAuth, act: string, level: "campaign" | "adset" | "ad"): Promise<ManagedObject[]> {
  const edge = { campaign: "campaigns", adset: "adsets", ad: "ads" }[level];
  return graphAll<ManagedObject>(
    `${act}/${edge}`,
    { fields: MANAGE_FIELDS[level], filtering: [{ field: "effective_status", operator: "NOT_IN", value: ["DELETED", "ARCHIVED"] }], limit: 200 },
    auth,
    5,
  );
}

/** Erros temporários da Meta (limite de chamadas, instabilidade): vale tentar de novo. */
export function isTransient(e: unknown): boolean {
  const code = (e as MetaError)?.code;
  return code === 1 || code === 2 || code === 4 || code === 17 || code === 32 || code === 341 || code === 613 || code === 80004 || code === 80000;
}
