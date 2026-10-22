import Stripe from "stripe";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { db, logEvent } from "@/lib/db";
import { ingestSale, type SaleStatus } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da Stripe.
 * Eventos: checkout.session.completed, checkout.session.async_payment_succeeded,
 * checkout.session.async_payment_failed, checkout.session.expired, charge.refunded, charge.dispute.created
 *
 * O vid do script de rastreamento chega em client_reference_id (Payment Links aceitam
 * ?client_reference_id=... na URL) ou em metadata.vid.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const secrets = await getCheckoutSecrets();
  if (!secrets.stripeWebhookSecret) return new Response("Stripe não configurada no painel", { status: 500 });

  const stripe = new Stripe(secrets.stripeSecretKey || "sk_placeholder");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secrets.stripeWebhookSecret);
  } catch (e: any) {
    await logEvent("stripe", "signature", false, e?.message ?? "assinatura inválida");
    return new Response("assinatura inválida", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const s = event.data.object as Stripe.Checkout.Session;
        let status: SaleStatus = "pending";
        if (event.type === "checkout.session.async_payment_failed") status = "refused";
        else if (event.type === "checkout.session.expired") status = "canceled";
        else if (s.payment_status === "paid" || s.payment_status === "no_payment_required") status = "approved";

        // Sessão expirada sem venda anterior: não interessa registrar
        if (status === "canceled") {
          const { data } = await db().from("sales").select("id").eq("platform", "stripe").eq("external_id", externalId(s)).maybeSingle();
          if (!data) break;
        }

        let productName = (s.metadata?.product_name as string) || null;
        let productId: string | null = null;
        if (!productName && secrets.stripeSecretKey) {
          try {
            const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 5 });
            productName = items.data.map((i) => i.description).filter(Boolean).join(" + ") || null;
            const price = items.data[0]?.price;
            productId = (typeof price?.product === "string" ? price.product : price?.product?.id) ?? null;
          } catch {
            /* sem permissão para ler itens: segue sem nome do produto */
          }
        }

        const md = s.metadata ?? {};
        await ingestSale({
          platform: "stripe",
          external_id: externalId(s),
          status,
          created_at: new Date(s.created * 1000).toISOString(),
          product_id: productId,
          product_name: productName,
          customer_name: s.customer_details?.name ?? null,
          customer_email: s.customer_details?.email ?? s.customer_email ?? null,
          customer_phone: s.customer_details?.phone ?? null,
          customer_country: s.customer_details?.address?.country ?? null,
          payment_method: s.payment_method_types?.[0] ?? null,
          currency: (s.currency ?? "usd").toUpperCase(),
          gross_amount: (s.amount_total ?? 0) / 100,
          click_id: s.client_reference_id || md.vid || null,
          utm_source: md.utm_source,
          utm_medium: md.utm_medium,
          utm_campaign: md.utm_campaign,
          utm_content: md.utm_content,
          utm_term: md.utm_term,
          raw: { type: event.type, id: s.id, payment_intent: s.payment_intent, metadata: md },
        });
        break;
      }
      case "charge.refunded": {
        const c = event.data.object as Stripe.Charge;
        if (c.refunded) await updateByPaymentIntent(stringId(c.payment_intent), "refunded");
        break;
      }
      case "charge.dispute.created": {
        const d = event.data.object as Stripe.Dispute;
        await updateByPaymentIntent(stringId(d.payment_intent), "chargeback");
        break;
      }
    }
    await logEvent("stripe", event.type, true, null, { id: event.id });
    return Response.json({ received: true });
  } catch (e: any) {
    await logEvent("stripe", event.type, false, e?.message ?? "erro", { id: event.id });
    return new Response("erro ao processar", { status: 500 });
  }
}

function stringId(v: unknown): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : ((v as { id?: string }).id ?? null);
}

function externalId(s: Stripe.Checkout.Session): string {
  return stringId(s.payment_intent) ?? s.id;
}

async function updateByPaymentIntent(pi: string | null, status: SaleStatus) {
  if (!pi) return;
  const { data } = await db().from("sales").select("*").eq("platform", "stripe").eq("external_id", pi).maybeSingle();
  if (!data) return;
  await ingestSale({ ...data, status, gross_amount: Number(data.gross_amount), raw: data.raw });
}
