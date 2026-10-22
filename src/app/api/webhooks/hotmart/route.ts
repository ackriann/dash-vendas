import { getCheckoutSecrets } from "@/lib/checkouts";
import { logEvent } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ingestSale, type SaleStatus } from "@/lib/sales";
import { utmsFromQuery } from "@/lib/utm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_STATUS: Record<string, SaleStatus> = {
  PURCHASE_APPROVED: "approved",
  PURCHASE_COMPLETE: "approved",
  PURCHASE_BILLET_PRINTED: "pending",
  PURCHASE_DELAYED: "pending",
  PURCHASE_PROTEST: "chargeback",
  PURCHASE_CHARGEBACK: "chargeback",
  PURCHASE_REFUNDED: "refunded",
  PURCHASE_CANCELED: "canceled",
  PURCHASE_EXPIRED: "canceled",
};

/**
 * Webhook da Hotmart (versão 2.0.0).
 * Autenticação: header X-HOTMART-HOTTOK (ou campo hottok no corpo, versão antiga).
 * O vid do script de rastreamento chega em purchase.origin.sck.
 */
export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload) return new Response("JSON inválido", { status: 400 });

  const hottok = req.headers.get("x-hotmart-hottok") ?? payload.hottok ?? "";
  const { hotmartHottok } = await getCheckoutSecrets();
  if (!hotmartHottok || !safeEqual(String(hottok), hotmartHottok)) {
    await logEvent("hotmart", payload.event ?? "?", false, "hottok inválido");
    return new Response("hottok inválido", { status: 401 });
  }

  const event: string = payload.event ?? "";
  const status = EVENT_STATUS[event];
  if (!status) {
    await logEvent("hotmart", event, true, "evento ignorado");
    return Response.json({ ignored: event });
  }

  try {
    const d = payload.data ?? {};
    const p = d.purchase ?? {};
    const origin = p.origin ?? {};
    const sck: string = origin.sck ?? "";
    const src: string = origin.src ?? "";

    // sck pode trazer só o vid (padrão do t.js) ou uma query de UTMs
    const fromSck = sck.includes("utm_") ? utmsFromQuery(sck) : {};
    const fromSrc = src.includes("utm_") ? utmsFromQuery(src) : {};
    const vid = sck && !sck.includes("=") ? sck : null;

    const producer = (d.commissions ?? []).find((c: any) => c.source === "PRODUCER");
    const price = p.price ?? p.full_price ?? {};

    await ingestSale({
      platform: "hotmart",
      external_id: p.transaction ?? payload.id,
      status,
      created_at: p.order_date ? new Date(p.order_date).toISOString() : null,
      approved_at: p.approved_date ? new Date(p.approved_date).toISOString() : null,
      product_id: d.product?.id ? String(d.product.id) : null,
      product_name: d.product?.name ?? null,
      customer_name: d.buyer?.name ?? null,
      customer_email: d.buyer?.email ?? null,
      customer_phone: d.buyer?.checkout_phone ?? d.buyer?.phone ?? null,
      customer_country: d.buyer?.address?.country_iso ?? null,
      payment_method: p.payment?.type ?? null,
      installments: p.payment?.installments_number ?? null,
      currency: price.currency_value ?? "BRL",
      gross_amount: Math.abs(Number(price.value) || 0),
      net_reported: producer ? Number(producer.value) : null,
      click_id: vid,
      utm_source: fromSck.utm_source ?? fromSrc.utm_source ?? (src && !src.includes("=") ? src : null),
      utm_medium: fromSck.utm_medium ?? fromSrc.utm_medium,
      utm_campaign: fromSck.utm_campaign ?? fromSrc.utm_campaign,
      utm_content: fromSck.utm_content ?? fromSrc.utm_content,
      utm_term: fromSck.utm_term ?? fromSrc.utm_term,
      raw: payload,
    });
    await logEvent("hotmart", event, true, p.transaction ?? null);
    return Response.json({ ok: true });
  } catch (e: any) {
    await logEvent("hotmart", event, false, e?.message ?? "erro", payload);
    return new Response("erro ao processar", { status: 500 });
  }
}
