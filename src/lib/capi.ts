import "server-only";
import { createHash } from "crypto";
import { db, logEvent } from "./db";
import { env } from "./env";

// =====================================================================
// API de Conversões da Meta — envio do evento Purchase pelo servidor
// =====================================================================

export interface Pixel {
  id: string;
  name: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
  is_default: boolean;
}

export interface SaleRow {
  id: string;
  platform: string;
  external_id: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  product_id: string | null;
  product_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_country: string | null;
  currency: string;
  gross_amount: number;
  gross_base: number;
  net_reported: number | null;
  click_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  payment_method: string | null;
  installments: number | null;
  capi_sent_at: string | null;
  capi_event_id: string | null;
  capi_pixel_id: string | null;
  capi_last_error: string | null;
}

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

function normEmail(v?: string | null) {
  const s = v?.trim().toLowerCase();
  return s && s.includes("@") ? s : null;
}

function normPhone(v?: string | null, country?: string | null) {
  let d = (v ?? "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  // Telefone brasileiro sem DDI (10 ou 11 dígitos) -> adiciona 55
  if ((!country || country.toUpperCase() === "BR") && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return d.length >= 8 ? d : null;
}

function normName(v?: string | null) {
  const s = v
    ?.trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s-]/g, "");
  return s || null;
}

export async function getPixels(): Promise<Pixel[]> {
  const { data } = await db().from("pixels").select("*").order("created_at");
  return (data ?? []) as Pixel[];
}

export async function getDefaultPixel(): Promise<Pixel | null> {
  const list = await getPixels();
  return list.find((p) => p.is_default) ?? list[0] ?? null;
}

export interface CapiResult {
  ok: boolean;
  eventId: string;
  message: string;
}

/**
 * Envia um Purchase para o pixel. O event_id é estável por venda,
 * então reenvios são deduplicados pela Meta (janela de 48h) em vez de duplicar a venda.
 */
export async function sendPurchase(sale: SaleRow, pixel: Pixel, opts: { eventTime?: Date } = {}): Promise<CapiResult> {
  const eventId = `${sale.platform}_${sale.external_id}`.slice(0, 200);
  const when = opts.eventTime ?? new Date(sale.approved_at ?? sale.created_at);
  const now = Date.now();
  let eventTime = Math.floor(when.getTime() / 1000);
  const sevenDays = 7 * 24 * 3600;
  if (eventTime > now / 1000) eventTime = Math.floor(now / 1000);
  if (now / 1000 - eventTime > sevenDays) {
    const msg = "A Meta só aceita eventos de site com até 7 dias. Esta venda é mais antiga.";
    await db().from("sales").update({ capi_last_error: msg }).eq("id", sale.id);
    return { ok: false, eventId, message: msg };
  }

  // Dados do clique (fbc/fbp/ip/user agent) capturados pelo script de rastreamento
  let click: any = null;
  if (sale.click_id) {
    const { data } = await db().from("clicks").select("*").eq("id", sale.click_id).maybeSingle();
    click = data;
  }

  const [first, ...rest] = (sale.customer_name ?? "").trim().split(/\s+/);
  const email = normEmail(sale.customer_email);
  const phone = normPhone(sale.customer_phone, sale.customer_country);
  const fn = normName(first);
  const ln = normName(rest.join(" "));
  const country = sale.customer_country?.trim().toLowerCase().slice(0, 2) || null;

  const user_data: Record<string, unknown> = {};
  if (email) user_data.em = [sha(email)];
  if (phone) user_data.ph = [sha(phone)];
  if (fn) user_data.fn = [sha(fn)];
  if (ln) user_data.ln = [sha(ln)];
  if (country) user_data.country = [sha(country)];
  // Mesmo external_id que o t.js manda nos eventos do site (id da visita), mais o e-mail
  const ext = [click?.id ? sha(click.id) : null, email ? sha(email) : null].filter(Boolean);
  if (ext.length) user_data.external_id = ext;
  if (click?.fbc) user_data.fbc = click.fbc;
  if (click?.fbp) user_data.fbp = click.fbp;
  if (click?.ip) user_data.client_ip_address = click.ip;
  if (click?.user_agent) user_data.client_user_agent = click.user_agent;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        event_source_url: click?.landing_url || env.appUrl,
        user_data,
        custom_data: {
          currency: (sale.currency || "BRL").toUpperCase(),
          value: Number(sale.gross_amount),
          content_name: sale.product_name ?? undefined,
          content_ids: sale.product_id ? [sale.product_id] : undefined,
          content_type: "product",
          order_id: sale.external_id,
        },
      },
    ],
  };
  if (pixel.test_event_code) body.test_event_code = pixel.test_event_code;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${env.metaApiVersion}/${pixel.pixel_id}/events?access_token=${encodeURIComponent(pixel.access_token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const msg = json.error?.error_user_msg || json.error?.message || `Erro ${res.status}`;
      await db().from("sales").update({ capi_last_error: msg }).eq("id", sale.id);
      await logEvent("capi", "Purchase", false, msg, { sale: sale.id, pixel: pixel.pixel_id });
      return { ok: false, eventId, message: msg };
    }
    await db()
      .from("sales")
      .update({ capi_sent_at: new Date().toISOString(), capi_event_id: eventId, capi_pixel_id: pixel.pixel_id, capi_last_error: null })
      .eq("id", sale.id);
    await logEvent("capi", "Purchase", true, `Recebido pela Meta (${json.events_received ?? 1} evento)`, {
      sale: sale.id,
      pixel: pixel.pixel_id,
      fbtrace_id: json.fbtrace_id,
    });
    return { ok: true, eventId, message: "Venda enviada para o pixel." };
  } catch (e: any) {
    const msg = e?.message ?? "Falha de rede ao chamar a Meta";
    await db().from("sales").update({ capi_last_error: msg }).eq("id", sale.id);
    return { ok: false, eventId, message: msg };
  }
}

// ---------------------------------------------------------------------
// Eventos do site (PageView, ViewContent, InitiateCheckout...) enviados
// pelo t.js. O navegador manda o mesmo event_id, então a Meta deduplica.
// ---------------------------------------------------------------------

export const SITE_EVENTS = ["PageView", "ViewContent", "InitiateCheckout", "AddToCart", "AddPaymentInfo", "Lead", "CompleteRegistration"];

export interface SiteEvent {
  event_name: string;
  event_id: string;
  url: string | null;
  vid: string;
  fbc: string | null;
  fbp: string | null;
  ip: string | null;
  user_agent: string | null;
  custom_data?: Record<string, unknown>;
}

export async function getPixelsByIds(ids: string[]): Promise<Pixel[]> {
  if (!ids.length) return [];
  const { data } = await db().from("pixels").select("*").in("pixel_id", ids);
  return (data ?? []) as Pixel[];
}

export async function sendSiteEvent(pixel: Pixel, ev: SiteEvent): Promise<{ ok: boolean; message: string }> {
  const user_data: Record<string, unknown> = { external_id: [sha(ev.vid)] };
  if (ev.fbc) user_data.fbc = ev.fbc;
  if (ev.fbp) user_data.fbp = ev.fbp;
  if (ev.ip) user_data.client_ip_address = ev.ip;
  if (ev.user_agent) user_data.client_user_agent = ev.user_agent;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: ev.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: ev.event_id,
        action_source: "website",
        event_source_url: ev.url ?? undefined,
        user_data,
        custom_data: ev.custom_data && Object.keys(ev.custom_data).length ? ev.custom_data : undefined,
      },
    ],
  };
  if (pixel.test_event_code) body.test_event_code = pixel.test_event_code;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${env.metaApiVersion}/${pixel.pixel_id}/events?access_token=${encodeURIComponent(pixel.access_token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return { ok: false, message: json.error?.error_user_msg || json.error?.message || `Erro ${res.status}` };
    return { ok: true, message: "ok" };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "falha de rede" };
  }
}
