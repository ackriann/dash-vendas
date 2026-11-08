// =====================================================================
// Automação de Campanhas — tipos e validação compartilhados (cliente e servidor).
// Nada aqui chama a Meta: só descreve o rascunho e confere os campos.
// =====================================================================

export type Objective =
  | "OUTCOME_SALES"
  | "OUTCOME_LEADS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_AWARENESS";

export const OBJECTIVES: [Objective, string, string][] = [
  ["OUTCOME_SALES", "Vendas", "Conversões no site ou catálogo"],
  ["OUTCOME_LEADS", "Cadastros", "Leads pelo pixel do site"],
  ["OUTCOME_TRAFFIC", "Tráfego", "Cliques e visualizações da página"],
  ["OUTCOME_ENGAGEMENT", "Engajamento", "Interações com o anúncio"],
  ["OUTCOME_AWARENESS", "Reconhecimento", "Alcance e impressões"],
];

/** Metas de otimização permitidas por objetivo (a primeira é a padrão). */
export const GOALS: Record<Objective, [string, string][]> = {
  OUTCOME_SALES: [
    ["OFFSITE_CONVERSIONS", "Conversões (pixel)"],
    ["VALUE", "Valor das conversões"],
    ["LANDING_PAGE_VIEWS", "Visualizações da página"],
    ["LINK_CLICKS", "Cliques no link"],
  ],
  OUTCOME_LEADS: [
    ["OFFSITE_CONVERSIONS", "Conversões (pixel)"],
    ["LANDING_PAGE_VIEWS", "Visualizações da página"],
    ["LINK_CLICKS", "Cliques no link"],
  ],
  OUTCOME_TRAFFIC: [
    ["LANDING_PAGE_VIEWS", "Visualizações da página"],
    ["LINK_CLICKS", "Cliques no link"],
    ["REACH", "Alcance"],
    ["IMPRESSIONS", "Impressões"],
  ],
  OUTCOME_ENGAGEMENT: [
    ["POST_ENGAGEMENT", "Engajamento com a publicação"],
    ["THRUPLAY", "ThruPlay (vídeo)"],
  ],
  OUTCOME_AWARENESS: [
    ["REACH", "Alcance"],
    ["IMPRESSIONS", "Impressões"],
    ["THRUPLAY", "ThruPlay (vídeo)"],
  ],
};

export const NEEDS_PIXEL = new Set(["OFFSITE_CONVERSIONS", "VALUE"]);

export const EVENTS: [string, string][] = [
  ["PURCHASE", "Compra"],
  ["INITIATED_CHECKOUT", "Iniciar checkout"],
  ["ADD_PAYMENT_INFO", "Adicionar pagamento"],
  ["ADD_TO_CART", "Adicionar ao carrinho"],
  ["LEAD", "Lead"],
  ["COMPLETE_REGISTRATION", "Cadastro completo"],
  ["CONTENT_VIEW", "Visualização de conteúdo"],
  ["SUBSCRIBE", "Assinatura"],
];

export const BID_STRATEGIES: [string, string][] = [
  ["LOWEST_COST_WITHOUT_CAP", "Maior volume (sem limite)"],
  ["COST_CAP", "Custo por resultado (cost cap)"],
  ["LOWEST_COST_WITH_BID_CAP", "Limite de lance (bid cap)"],
  ["LOWEST_COST_WITH_MIN_ROAS", "ROAS mínimo"],
];

export const CTAS: [string, string][] = [
  ["SHOP_NOW", "Comprar agora"],
  ["LEARN_MORE", "Saiba mais"],
  ["BUY_NOW", "Comprar"],
  ["ORDER_NOW", "Pedir agora"],
  ["GET_OFFER", "Obter oferta"],
  ["SIGN_UP", "Cadastre-se"],
  ["SUBSCRIBE", "Assinar"],
  ["APPLY_NOW", "Candidate-se"],
  ["DOWNLOAD", "Baixar"],
  ["CONTACT_US", "Fale conosco"],
  ["WATCH_MORE", "Assistir mais"],
  ["NO_BUTTON", "Sem botão"],
];

export const FB_POSITIONS: [string, string][] = [
  ["feed", "Feed"],
  ["story", "Stories"],
  ["facebook_reels", "Reels"],
  ["marketplace", "Marketplace"],
  ["video_feeds", "Feed de vídeos"],
  ["search", "Resultados de pesquisa"],
  ["instream_video", "Vídeos in-stream"],
  ["right_hand_column", "Coluna da direita"],
];

export const IG_POSITIONS: [string, string][] = [
  ["stream", "Feed"],
  ["story", "Stories"],
  ["reels", "Reels"],
  ["explore", "Explorar"],
  ["explore_home", "Explorar (início)"],
  ["profile_feed", "Feed do perfil"],
];

export const PLATFORMS: [string, string][] = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["audience_network", "Audience Network"],
  ["messenger", "Messenger"],
];

/** Como o catálogo aparece no anúncio (template_data.format_option da Meta). */
export const CATALOG_FORMATS: [string, string][] = [
  ["carousel_images_multi_items", "Carrossel com vários produtos"],
  ["carousel_images_single_item", "Carrossel com as imagens de um produto"],
  ["carousel_slideshows_single_item", "Apresentação (slideshow) de um produto"],
  ["single_image", "Imagem única"],
];

export interface Named { id: string; name: string }
export interface Region { key: string; name: string; country?: string }

/**
 * Catálogo automático: o painel acha ou cria o catálogo do BM da conta, cria um
 * produto por criativo (com a capa como imagem) e o conjunto de produtos.
 */
export interface CatalogAuto {
  /** auto = o painel monta tudo · existing = catálogo e conjunto de produtos escolhidos à mão */
  source: "auto" | "existing";
  productsPerCreative: number;
  /** minutos até o vídeo entrar no produto (0 = o vídeo já vai na criação) */
  delayMinutes: number;
  price: number | null;
  brand: string;
  /** imagem do produto (biblioteca), salva como padrão: vai em todos os produtos; os vídeos entram no campo de vídeo */
  productImageId: string;
  /** single = um anúncio com todos os produtos · per_creative = um anúncio por criativo, no mesmo conjunto */
  adsMode: "single" | "per_creative";
  /** mídia dinâmica da Meta: mostra o vídeo do produto quando houver */
  preferVideo: boolean;
}

/** Preferências do catálogo automático reaproveitadas nas próximas campanhas. */
export type CatalogPrefs = Partial<Pick<CatalogAuto, "productsPerCreative" | "delayMinutes" | "price" | "brand" | "adsMode" | "preferVideo" | "productImageId">> & { catalogFormat?: string };

export interface DraftData {
  accountId: string;
  /** Outras contas que recebem a mesma campanha (cada uma vira um processo de publicação) */
  extraAccountIds: string[];
  campaign: {
    name: string;
    objective: Objective;
    status: "PAUSED" | "ACTIVE";
    /** campaign = orçamento da campanha (CBO); adset = orçamento em cada conjunto */
    budgetLevel: "campaign" | "adset";
    budgetType: "daily" | "lifetime";
    budget: number | null;
    bidStrategy: string;
    specialCategories: string[];
    /** anúncios de catálogo (Advantage+ catálogo) */
    catalogId: string;
  };
  adset: {
    name: string;
    optimizationGoal: string;
    pixelId: string;
    event: string;
    budget: number | null;
    bidAmount: number | null;
    roasFloor: number | null;
    startTime: string; // datetime-local (fuso da conta de anúncio)
    endTime: string;
    ageMin: number;
    ageMax: number;
    /** Público Advantage+: idade mínima obrigatória (a Meta só aceita 18 a 25); ageMin/ageMax viram sugestão */
    ageMinControl: number;
    genders: "all" | "male" | "female";
    countries: string[];
    regions: Region[];
    interests: Named[];
    audiences: Named[];
    excludedAudiences: Named[];
    advantageAudience: boolean;
    placements: "auto" | "manual";
    platforms: string[];
    fbPositions: string[];
    igPositions: string[];
    productSetId: string;
  };
  creative: {
    mode: "media" | "catalog";
    pageId: string;
    instagramId: string;
    mediaIds: string[];
    message: string;
    headline: string;
    description: string;
    cta: string;
    url: string;
    urlTags: string;
    catalogFormat: string;
    adName: string; // aceita {n} e {midia}
  };
  catalog: CatalogAuto;
}

export const RECOMMENDED_URL_TAGS =
  "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

export function emptyDraft(accountId = ""): DraftData {
  return {
    accountId,
    extraAccountIds: [],
    campaign: {
      name: "",
      objective: "OUTCOME_SALES",
      status: "PAUSED",
      budgetLevel: "adset",
      budgetType: "daily",
      budget: null,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      specialCategories: [],
      catalogId: "",
    },
    adset: {
      name: "",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      pixelId: "",
      event: "PURCHASE",
      budget: 50,
      bidAmount: null,
      roasFloor: null,
      startTime: "",
      endTime: "",
      ageMin: 18,
      ageMax: 65,
      ageMinControl: 18,
      genders: "all",
      countries: ["BR"],
      regions: [],
      interests: [],
      audiences: [],
      excludedAudiences: [],
      advantageAudience: true,
      placements: "auto",
      platforms: ["facebook", "instagram"],
      fbPositions: ["feed", "story", "facebook_reels"],
      igPositions: ["stream", "story", "reels"],
      productSetId: "",
    },
    creative: {
      mode: "media",
      pageId: "",
      instagramId: "",
      mediaIds: [],
      message: "",
      headline: "",
      description: "",
      cta: "SHOP_NOW",
      url: "",
      urlTags: RECOMMENDED_URL_TAGS,
      catalogFormat: "carousel_images_multi_items",
      adName: "{midia}",
    },
    catalog: { source: "auto", productsPerCreative: 1, delayMinutes: 0, price: null, brand: "", productImageId: "", adsMode: "single", preferVideo: true },
  };
}

/** Mistura um rascunho salvo com os padrões (campos novos não quebram rascunhos antigos). */
export function normalizeDraft(raw: unknown, accountId = ""): DraftData {
  const d = emptyDraft(accountId);
  const r = (raw ?? {}) as Partial<DraftData>;
  return {
    accountId: r.accountId ?? d.accountId,
    extraAccountIds: (r.extraAccountIds ?? []).filter((a) => a && a !== (r.accountId ?? d.accountId)),
    campaign: { ...d.campaign, ...(r.campaign ?? {}) },
    adset: { ...d.adset, ...(r.adset ?? {}) },
    creative: { ...d.creative, ...(r.creative ?? {}) },
    // Rascunho antigo de catálogo já tinha catálogo escolhido: continua no modo manual
    catalog: { ...d.catalog, ...(r.catalog ?? (r.campaign?.catalogId ? { source: "existing" } : {})) },
  };
}

export const needsBidAmount = (s: string) => s === "COST_CAP" || s === "LOWEST_COST_WITH_BID_CAP";

/** Erros por etapa (1 campanha, 2 conjunto, 3 criativos). Vazio = pode publicar. */
export function validateDraft(d: DraftData): Record<1 | 2 | 3, string[]> {
  const e: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] };
  const c = d.campaign;
  const a = d.adset;
  const cr = d.creative;
  const catalog = cr.mode === "catalog";

  if (!d.accountId) e[1].push("Escolha a conta de anúncio.");
  if (!c.name.trim()) e[1].push("Dê um nome para a campanha.");
  if (c.budgetLevel === "campaign" && !(Number(c.budget) > 0)) e[1].push("Informe o orçamento da campanha.");
  if (catalog && c.objective !== "OUTCOME_SALES") e[1].push("Anúncios de catálogo usam o objetivo Vendas.");
  const autoCatalog = catalog && d.catalog.source === "auto";
  if (catalog && !autoCatalog && !c.catalogId) e[1].push("Escolha o catálogo da campanha.");

  if (!a.name.trim()) e[2].push("Dê um nome para o conjunto.");
  if (!GOALS[c.objective].some(([g]) => g === a.optimizationGoal)) e[2].push("Escolha uma meta de otimização compatível com o objetivo.");
  if (NEEDS_PIXEL.has(a.optimizationGoal) && !a.pixelId) e[2].push("Escolha o pixel para otimizar por conversão.");
  if (c.budgetLevel === "adset" && !(Number(a.budget) > 0)) e[2].push("Informe o orçamento do conjunto.");
  if (needsBidAmount(c.bidStrategy) && !(Number(a.bidAmount) > 0)) e[2].push("Informe o valor do lance/custo-alvo.");
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && !(Number(a.roasFloor) > 0)) e[2].push("Informe o ROAS mínimo.");
  if (c.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && a.optimizationGoal !== "VALUE") e[2].push("ROAS mínimo exige otimizar por valor das conversões.");
  if (c.budgetType === "lifetime" && !a.endTime) e[2].push("Orçamento total exige data de término.");
  if (a.startTime && a.endTime && a.endTime <= a.startTime) e[2].push("O término precisa ser depois do início.");
  if (!a.countries.length && !a.regions.length) e[2].push("Escolha pelo menos um país ou região.");
  if (a.ageMin < 13 || a.ageMax > 65 || a.ageMin > a.ageMax) e[2].push("Faixa de idade inválida (13 a 65).");
  if (a.advantageAudience && (a.ageMinControl < 18 || a.ageMinControl > 25)) e[2].push("Com Público Advantage+, a idade mínima obrigatória vai de 18 a 25 (regra da Meta). Idades maiores entram como sugestão.");
  if (a.advantageAudience && a.ageMin < 18) e[2].push("Com Público Advantage+, a sugestão de idade começa em 18.");
  if (a.placements === "manual" && !a.platforms.length) e[2].push("Escolha pelo menos uma plataforma.");
  if (catalog && !autoCatalog && !a.productSetId) e[2].push("Escolha o conjunto de produtos do catálogo.");

  if (!cr.pageId) e[3].push("Escolha a Página do Facebook.");
  if ((!catalog || autoCatalog) && !cr.mediaIds.length) e[3].push(autoCatalog ? "Escolha os criativos dos produtos." : "Escolha pelo menos uma imagem ou vídeo.");
  if (autoCatalog) {
    if (!d.catalog.productImageId) e[3].push("Escolha a imagem do produto (fica salva como padrão para os próximos catálogos).");
    if (!(Number(d.catalog.price) > 0)) e[3].push("Informe o preço dos produtos (em Configurações avançadas do catálogo).");
    if (!(d.catalog.productsPerCreative >= 1 && d.catalog.productsPerCreative <= 10)) e[3].push("Produtos por criativo: de 1 a 10.");
    if (d.catalog.delayMinutes < 0) e[3].push("Tempo de atualização do vídeo inválido.");
  }
  if (!/^https?:\/\/\S+\.\S+/.test(cr.url)) e[3].push("Informe a URL de destino (com https://).");
  if (cr.message.length > 2200) e[3].push("Texto principal muito longo.");
  if (cr.urlTags && /[?#\s]/.test(cr.urlTags.replace(/\{\{[^}]+\}\}/g, ""))) e[3].push("Os parâmetros de URL não podem ter ?, # ou espaços.");
  return e;
}

export const STEP_LABELS = ["Campanha", "Conjunto", "Criativos", "Revisão"] as const;

// ------------------------------------------------------------- Processos (fila)

export type JobStatus = "pending" | "running" | "waiting_sync" | "done" | "failed" | "skipped";
export type RunStatus = "queued" | "running" | "done" | "failed" | "canceled";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pendente",
  running: "Em processamento",
  waiting_sync: "Aguardando sincronização",
  done: "Concluída",
  failed: "Falhou",
  skipped: "Ignorada",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Na fila",
  running: "Em processamento",
  done: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

export const RUN_KIND_LABEL: Record<string, string> = {
  publish: "Publicação de campanha",
  page_sync: "Sincronização de Páginas",
  catalog_update: "Atualização de catálogo",
};

export interface RunView {
  id: string;
  kind: string;
  title: string;
  status: RunStatus;
  ref_id: string | null;
  summary: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
  jobs: {
    id: string;
    seq: number;
    key: string;
    kind: string;
    label: string;
    status: JobStatus;
    meta_id: string | null;
    message: string | null;
    error: string | null;
    attempts: number;
    updated_at: string;
  }[];
}

// ------------------------------------------------------------- Itens leves para as telas

export interface MediaLite { id: string; kind: "image" | "video"; name: string; public_url: string }

export interface PageLite {
  id: string;
  name: string;
  picture_url: string | null;
  instagram_id: string | null;
  instagram_username: string | null;
  ads_running: number | null;
  ads_limit: number | null;
}

export interface AccountLite { id: string; name: string; currency: string; profile_name: string; enabled: boolean; account_status: number | null }

/** Permissões (tasks) do perfil na Página. */
export const TASK_LABEL: Record<string, string> = {
  ADVERTISE: "Anunciar",
  ANALYZE: "Ver dados",
  CREATE_CONTENT: "Publicar",
  MESSAGING: "Mensagens",
  MODERATE: "Moderar",
  MANAGE: "Gerenciar",
};
