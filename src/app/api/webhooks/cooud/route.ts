import { getCheckoutSecrets } from "@/lib/checkouts";
import { fetchCooudOrder, verifyCooudSignature, type CooudOrder } from "@/lib/cooud";
import { logEvent, runAsWorkspace } from "@/lib/db";
import { ingestSale, mapStatus, type SaleStatus } from "@/lib/sales";
import { utmsFromQuery } from "@/lib/utm";
import { workspaceFromUrl } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Evento da Cooud → status do painel (loja: order.*; plataforma: cooud.*). */
const EVENT_STATUS: Record<string, SaleStatus | "by_status"> = {
  "order.paid": "approved",
  "cooud.order.paid": "approved",
  "order.refunded": "by_status",
  "cooud.order.refunded": "by_status",
  "order.created": "by_status",
  "order.updated": "by_status",
  "cooud.payment.processing": "pending",
  "cooud.payment.expired": "canceled",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v / 100 : null);

/**
 * Webhook da Cooud. Autenticação: X-Cooud-Signature (HMAC-SHA256 do corpo original
 * com o webhook_secret salvo em Integrações). O vid do t.js volta em metadata
 * (vid, sck ou click_id), junto com as UTMs, quando o checkout repassa.
 */
async function handle(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  const { cooudWebhookSecret, cooudApiKey } = await getCheckoutSecrets();
  if (!cooudWebhookSecret) {
    await logEvent("cooud", "?", false, "segredo do webhook não cadastrado no painel");
    return new Response("Cooud não configurada no painel", { status: 500 });
  }
  if (!verifyCooudSignature(raw, req.headers.get("x-cooud-signature"), cooudWebhookSecret)) {
    const why = req.headers.get("x-cooud-signature") ? "assinatura inválida (confira o webhook_secret)" : "aviso sem assinatura (recrie o destino na Cooud)";
    await logEvent("cooud", "signature", false, why);
    return new Response("assinatura inválida", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    await logEvent("cooud", "json", false, "corpo inválido");
    return new Response("JSON inválido", { status: 400 });
  }
  const type: string = event?.type ?? event?.kind ?? "";
  if (type === "cooud.ping") {
    await logEvent("cooud", type, true, "teste de recebimento");
    return Response.json({ ok: true });
  }
  if (event?.livemode === false) {
    await logEvent("cooud", type, true, "evento de sandbox ignorado");
    return Response.json({ ignored: "sandbox" });
  }
  const rule = EVENT_STATUS[type];
  const d = event?.data ?? {};
  const orderId = str(d.order_id) ?? str(d.id);
  if (!rule || !orderId) {
    await logEvent("cooud", type || "?", true, "evento ignorado");
    return Response.json({ ignored: type });
  }

  try {
    // Pedido completo pela API (opcional): e-mail, líquido, metadata e estado atual
    const order: CooudOrder | null = cooudApiKey ? await fetchCooudOrder(cooudApiKey, orderId) : null;

    const statusText = str(order?.status) ?? str(d.status) ?? "";
    let status: SaleStatus;
    if (rule !== "by_status") status = rule;
    else if (/partially_refunded/.test(statusText)) status = "approved"; // reembolso parcial: venda continua valendo
    else if (type.endsWith("refunded")) status = "refunded";
    else status = mapStatus(statusText);

    const md: Record<string, unknown> = { ...(d.metadata ?? {}), ...(order?.metadata ?? {}) };
    const m = (k: string) => str(md[k]);
    const fromQuery = utmsFromQuery(m("query") ?? m("src") ?? m("sck"));
    const rawVid = m("vid") ?? m("click_id") ?? m("sck") ?? m("src");
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    const productName = items.map((i) => str(i?.product_name) ?? str(i?.name)).filter(Boolean).join(" + ") || m("product_name");
    const created = order?.created ?? (typeof d.created === "number" ? d.created : null);

    await ingestSale({
      platform: "cooud",
      external_id: orderId.replace(/^cooud_ord_/, ""),
      status,
      created_at: created ? new Date(created * 1000).toISOString() : str(event.created_at),
      product_id: str(items[0]?.price_id) ?? str(items[0]?.product_id),
      product_name: productName,
      customer_name: str(d.user?.name) ?? str(d.customer_name),
      customer_email: str(order?.customer_email) ?? str(d.user?.email) ?? str(d.customer_email),
      customer_country: str(order?.country) ?? str(d.country),
      payment_method: str(order?.payment_method_type) ?? str(d.payment_method_type) ?? str(d.payment_method),
      currency: (str(order?.currency) ?? str(d.currency) ?? "brl").toUpperCase(),
      gross_amount: Math.abs(cents(order?.total_amount) ?? cents(d.total_amount) ?? cents(d.amount) ?? 0),
      net_reported: cents(order?.net_amount) ?? cents(d.net_amount),
      click_id: rawVid && !rawVid.includes("=") ? rawVid : null,
      utm_source: m("utm_source") ?? fromQuery.utm_source,
      utm_medium: m("utm_medium") ?? fromQuery.utm_medium,
      utm_campaign: m("utm_campaign") ?? fromQuery.utm_campaign,
      utm_content: m("utm_content") ?? fromQuery.utm_content,
      utm_term: m("utm_term") ?? fromQuery.utm_term,
      raw: { type, event_id: event.id ?? null, data: d, order },
    });
    await logEvent("cooud", type, true, orderId);
    return Response.json({ ok: true });
  } catch (e: any) {
    await logEvent("cooud", type, false, e?.message ?? "erro", { event_id: event?.id ?? null });
    return new Response("erro ao processar", { status: 500 });
  }
}

/** A conta vem do ?a= da URL (sem ele, conta principal). */
export async function POST(req: Request) {
  const ws = await workspaceFromUrl(req.url);
  if (!ws) return new Response("conta não encontrada", { status: 404 });
  return runAsWorkspace(ws, () => handle(req));
}
