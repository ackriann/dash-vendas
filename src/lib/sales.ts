import "server-only";
import { db, getSetting, logEvent } from "./db";
import { toBase, fmtMoney, type FxRates } from "./money";
import { metaIdsFromUtms, type Utms } from "./utm";
import { pushAll } from "./push";
import { getPixels, sendPurchase, type SaleRow } from "./capi";
import { listDashboards, pixelsForProduct } from "./dashboards";

export type SaleStatus = "approved" | "pending" | "refunded" | "chargeback" | "canceled" | "refused";

export const STATUS_LABEL: Record<string, string> = {
  approved: "Aprovada",
  pending: "Pendente",
  refunded: "Reembolsada",
  chargeback: "Chargeback",
  canceled: "Cancelada",
  refused: "Recusada",
};

export const PLATFORM_LABEL: Record<string, string> = {
  stripe: "Stripe",
  hotmart: "Hotmart",
  digistore: "Digistore24",
  cooud: "Cooud",
  universal: "Universal",
  manual: "Manual",
};

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export interface NormalizedSale extends Utms {
  platform: string;
  external_id: string;
  status: SaleStatus;
  created_at?: string | null;
  approved_at?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_country?: string | null;
  payment_method?: string | null;
  installments?: number | null;
  currency: string;
  gross_amount: number;
  net_reported?: number | null;
  click_id?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  raw?: unknown;
}

/** Converte qualquer texto de status em um dos status do painel. */
export function mapStatus(s: string | null | undefined): SaleStatus {
  const v = (s ?? "").toString().trim().toLowerCase();
  if (/(charge_?back|disput|contesta)/.test(v)) return "chargeback";
  if (/(refund|reembols|devolv|estorn)/.test(v)) return "refunded";
  if (/(cancel|expir|abandon)/.test(v)) return "canceled";
  if (/(refus|recus|declin|fail|negad|denied|reject)/.test(v)) return "refused";
  if (/(approv|aprov|paid|pago|complet|success|succeeded|conclu|confirm|active|ativ)/.test(v)) return "approved";
  return "pending";
}

const RANK: Record<SaleStatus, number> = { refused: 0, canceled: 0, pending: 1, approved: 2, refunded: 3, chargeback: 4 };

/** Evita que um webhook atrasado (ex.: boleto impresso) rebaixe uma venda já aprovada. */
function resolveStatus(prev: SaleStatus | undefined, next: SaleStatus): SaleStatus {
  if (!prev) return next;
  if (prev === "approved" && (next === "pending" || next === "canceled" || next === "refused")) return prev;
  if ((prev === "refunded" || prev === "chargeback") && RANK[next] < RANK[prev]) return prev;
  return next;
}

export async function ingestSale(input: NormalizedSale): Promise<{ id: string; status: SaleStatus; changed: boolean }> {
  const supa = db();

  // Junta com os dados do clique (UTMs, fbc/fbp) se o checkout devolveu o vid
  let click: any = null;
  if (input.click_id) {
    const { data } = await supa.from("clicks").select("*").eq("id", input.click_id).maybeSingle();
    click = data;
  }
  const utms: Utms = {
    utm_source: input.utm_source || click?.utm_source || null,
    utm_medium: input.utm_medium || click?.utm_medium || null,
    utm_campaign: input.utm_campaign || click?.utm_campaign || null,
    utm_content: input.utm_content || click?.utm_content || null,
    utm_term: input.utm_term || click?.utm_term || null,
  };
  const ids = metaIdsFromUtms(utms);

  const base = await getSetting<string>("base_currency", "BRL");
  const rates = await getSetting<FxRates>("fx_rates", { BRL: 1 });

  const { data: existing } = await supa
    .from("sales")
    .select("id,status,created_at,approved_at,click_id")
    .eq("platform", input.platform)
    .eq("external_id", input.external_id)
    .maybeSingle();

  const prev = existing?.status as SaleStatus | undefined;
  const status = resolveStatus(prev, input.status);
  const nowIso = new Date().toISOString();

  const row: Record<string, unknown> = {
    platform: input.platform,
    external_id: input.external_id,
    status,
    updated_at: nowIso,
    product_id: input.product_id ?? null,
    product_name: input.product_name ?? null,
    customer_name: input.customer_name ?? null,
    customer_email: input.customer_email ?? null,
    customer_phone: input.customer_phone ?? null,
    customer_country: input.customer_country ?? null,
    payment_method: input.payment_method ?? null,
    installments: input.installments ?? null,
    currency: (input.currency || base).toUpperCase(),
    gross_amount: input.gross_amount,
    gross_base: toBase(input.gross_amount, input.currency || base, base, rates),
    net_reported: input.net_reported ?? null,
    click_id: click ? click.id : existing?.click_id ?? null,
    ...utms,
    campaign_id: input.campaign_id || ids.campaign_id || click?.campaign_id || null,
    adset_id: input.adset_id || ids.adset_id || click?.adset_id || null,
    ad_id: input.ad_id || ids.ad_id || click?.ad_id || null,
    raw: input.raw ?? null,
  };
  if (!existing) row.created_at = input.created_at || nowIso;
  if (status === "approved" && !existing?.approved_at) row.approved_at = input.approved_at || nowIso;

  // Em atualizações, não apaga dados que já existiam com campos vazios
  if (existing) {
    for (const k of Object.keys(row)) if (row[k] === null) delete row[k];
    // Reembolsos às vezes chegam com valor zerado/negativo: mantém o valor original
    if (!(input.gross_amount > 0)) {
      delete row.gross_amount;
      delete row.gross_base;
      delete row.currency;
    }
  }

  const { data: saved, error } = await supa
    .from("sales")
    .upsert(row, { onConflict: "workspace_id,platform,external_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const changed = prev !== status;
  if (changed) await afterStatusChange(saved as SaleRow, prev, status);
  return { id: saved.id, status, changed };
}

async function afterStatusChange(sale: SaleRow, prev: SaleStatus | undefined, status: SaleStatus) {
  const notify = await getSetting<{ approved: boolean; pending: boolean; refund: boolean }>("notify", {
    approved: true,
    pending: false,
    refund: true,
  });
  const value = fmtMoney(Number(sale.gross_amount), sale.currency);
  const product = sale.product_name ? ` · ${sale.product_name}` : "";
  const url = `/vendas?id=${sale.id}`;

  try {
    if (status === "approved" && notify.approved) {
      await pushAll({ title: "Venda aprovada! 💸", body: `Valor: ${value}${product}`, url, tag: `sale-${sale.id}`, sound: "sale" });
    } else if (status === "pending" && !prev && notify.pending) {
      await pushAll({ title: "Venda pendente ⏳", body: `${value}${product} aguardando pagamento`, url, tag: `sale-${sale.id}` });
    } else if ((status === "refunded" || status === "chargeback") && notify.refund) {
      await pushAll({
        title: status === "refunded" ? "Reembolso ⚠️" : "Chargeback ⚠️",
        body: `${value}${product}`,
        url,
        tag: `sale-${sale.id}`,
        sound: "alert",
      });
    }
  } catch (e: any) {
    await logEvent("push", status, false, e?.message ?? "erro no push");
  }

  // Envio automático (se ligado): pixels dos dashes do produto vendido, ou o pixel padrão
  if (status === "approved" && !sale.capi_sent_at) {
    const auto = await getSetting<boolean>("auto_capi", false);
    if (auto) {
      const [pixels, dashes] = await Promise.all([getPixels(), listDashboards()]);
      for (const pixel of pixelsForProduct(pixels, dashes, sale.product_name)) await sendPurchase(sale, pixel);
    }
  }
}

export type PaymentKind = "pix" | "card" | "boleto" | "other";

export const PAYMENT_LABEL: Record<PaymentKind, string> = { pix: "Pix", card: "Cartão", boleto: "Boleto", other: "Outros" };

/** Agrupa os nomes de pagamento de cada plataforma em Pix, cartão, boleto ou outros. */
export function paymentKind(m: string | null | undefined): PaymentKind {
  const v = (m ?? "").toLowerCase();
  if (/pix/.test(v)) return "pix";
  if (/(card|cart|credit|debit|visa|master|amex|elo|apple_pay|google_pay)/.test(v)) return "card";
  if (/(boleto|billet|bank_slip|ticket)/.test(v)) return "boleto";
  return "other";
}
