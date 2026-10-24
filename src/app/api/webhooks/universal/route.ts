import { getCheckoutSecrets } from "@/lib/checkouts";
import { workspaceFromUrl } from "@/lib/workspaces";
import { logEvent, runAsWorkspace } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ingestSale, mapStatus } from "@/lib/sales";
import { utmsFromQuery } from "@/lib/utm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook universal — serve para qualquer checkout/gateway (Kiwify, Perfect Pay, Eduzz,
 * Yampi, Cartpanda, n8n, Zapier, Make, seu próprio sistema...).
 *
 * URL: https://SEU-PAINEL/api/webhooks/universal?key=SUA_CHAVE&platform=kiwify
 *
 * Aceita JSON ou formulário. Campos reconhecidos (com vários apelidos comuns):
 *   id | order_id | transaction_id | transaction | sale_id      -> id da venda (obrigatório)
 *   status | order_status | payment_status | event             -> paid/approved/aprovado/refunded/...
 *   amount | value | price | total | order_value | amount_cents -> valor (amount_cents em centavos)
 *   currency                                                    -> BRL, USD...
 *   product | product_name | product.name                       -> produto
 *   customer.name/email/phone | name | email | phone            -> comprador
 *   vid | click_id | sck | src | custom                         -> id do clique do t.js
 *   utm_source, utm_medium, utm_campaign, utm_content, utm_term (ou objeto "utms"/"tracking")
 *   created_at | date                                           -> data da venda
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("x-webhook-key") ?? "";
  const { universalKey } = await getCheckoutSecrets();
  if (!universalKey || !safeEqual(key, universalKey)) {
    await logEvent(url.searchParams.get("platform") || "universal", "universal", false, "chave da URL inválida (gere/copie a URL de novo)");
    return new Response("chave inválida", { status: 401 });
  }

  const ct = req.headers.get("content-type") ?? "";
  let body: any = {};
  if (ct.includes("application/json")) body = await req.json().catch(() => ({}));
  else {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => (body[k] = String(v)));
  }

  const platform = (url.searchParams.get("platform") || body.platform || "universal").toString().toLowerCase().slice(0, 30);

  try {
    // Muitos gateways mandam tudo dentro de "data" ou "order"
    const b = flat(body.data && typeof body.data === "object" ? { ...body, ...body.data } : body);
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = b[k.toLowerCase()];
        if (v !== undefined && v !== null && v !== "") return String(v);
      }
      return null;
    };

    const id = pick("id", "order_id", "orderid", "transaction_id", "transaction", "sale_id", "order.id", "order_ref", "reference");
    if (!id) return Response.json({ error: "campo id/order_id ausente" }, { status: 400 });

    let amount = Number(pick("amount", "value", "price", "total", "order_value", "total_price", "sale_amount", "order.total") ?? 0);
    const cents = pick("amount_cents", "value_cents", "total_cents", "price_cents", "commissions.charge_amount");
    if (cents) amount = Number(cents) / 100;

    const tracking = ["tracking.", "utms.", "trackingparameters.", "metadata."].find((p) => pick(`${p}utm_source`, `${p}utm_campaign`)) ?? "";
    const fromUrl = utmsFromQuery(pick("url", "checkout_url", "query_string", "src", "sck"));
    const rawVid = pick("vid", "click_id", "sck", "trackingparameters.sck", "tracking.sck", "custom", "client_reference_id", "tracking.vid", "src", "trackingparameters.src");

    await ingestSale({
      platform,
      external_id: id,
      status: mapStatus(pick("status", "order_status", "payment_status", "sale_status_enum_key", "event", "webhook_event_type", "situacao")),
      created_at: toIso(pick("created_at", "date", "order_date", "createdat", "created")),
      product_id: pick("product_id", "product.id", "offer_id"),
      product_name: pick("product_name", "product", "product.name", "product.product_name", "item_name", "offer_name"),
      customer_name: pick("customer.name", "customer.full_name", "buyer.name", "name", "customer_name", "client.name"),
      customer_email: pick("customer.email", "buyer.email", "email", "customer_email", "client.email"),
      customer_phone: pick("customer.phone", "customer.mobile", "buyer.phone", "phone", "customer_phone", "client.phone", "customer.cellphone"),
      customer_country: pick("customer.country", "country", "customer.address.country"),
      payment_method: pick("payment_method", "payment.method", "payment_type", "method"),
      installments: Number(pick("installments", "payment.installments")) || null,
      currency: (pick("currency", "currency_code", "payment.currency") ?? "BRL").toUpperCase(),
      gross_amount: Math.abs(amount || 0),
      net_reported: Number(pick("net_amount", "net", "commission", "producer_amount", "my_commission")) || null,
      click_id: rawVid && !rawVid.includes("=") ? rawVid : null,
      utm_source: pick(`${tracking}utm_source`, "utm_source") ?? fromUrl.utm_source,
      utm_medium: pick(`${tracking}utm_medium`, "utm_medium") ?? fromUrl.utm_medium,
      utm_campaign: pick(`${tracking}utm_campaign`, "utm_campaign") ?? fromUrl.utm_campaign,
      utm_content: pick(`${tracking}utm_content`, "utm_content") ?? fromUrl.utm_content,
      utm_term: pick(`${tracking}utm_term`, "utm_term") ?? fromUrl.utm_term,
      raw: body,
    });
    await logEvent(platform, "universal", true, id);
    return Response.json({ ok: true });
  } catch (e: any) {
    await logEvent(platform, "universal", false, e?.message ?? "erro", body);
    return new Response("erro ao processar", { status: 500 });
  }
}

/** Permite testar a URL no navegador. */
export async function GET() {
  return Response.json({ ok: true, info: "Envie um POST com os dados da venda. Veja Integrações no painel." });
}

/** Achata objetos aninhados: {customer:{email}} -> {"customer.email"} (chaves em minúsculo). */
function flat(obj: any, prefix = "", out: Record<string, any> = {}): Record<string, any> {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = (prefix ? `${prefix}.${k}` : k).toLowerCase();
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
    else if (Array.isArray(v)) {
      if (v[0] && typeof v[0] === "object") flat(v[0], key, out);
    } else out[key] = v;
  }
  return out;
}

function toIso(v: string | null): string | null {
  if (!v) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 ? new Date(n > 1e12 ? n : n * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A conta vem do ?a= da URL (sem ele, conta principal). */
export async function POST(req: Request) {
  const ws = await workspaceFromUrl(req.url);
  if (!ws) return new Response("conta não encontrada", { status: 404 });
  return runAsWorkspace(ws, () => handle(req));
}
