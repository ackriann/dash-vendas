import { createHash } from "crypto";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { db, logEvent } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ingestSale, type SaleStatus } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_STATUS: Record<string, SaleStatus> = {
  on_payment: "approved",
  on_payment_missed: "refused",
  on_refund: "refunded",
  on_chargeback: "chargeback",
};

/**
 * IPN da Digistore24 (tipo "Generic").
 * Assinatura: SHA-512 de "chave=valor" + senha, em ordem alfabética, sem campos vazios.
 * O vid do script de rastreamento chega no parâmetro "custom".
 * A Digistore espera a resposta "OK" em texto puro.
 */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let params: Record<string, string> = {};
  if (ct.includes("application/json")) {
    params = await req.json().catch(() => ({}));
  } else {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => (params[k] = String(v)));
  }

  const { digistorePassphrase } = await getCheckoutSecrets();
  if (!digistorePassphrase) {
    await logEvent("digistore", params.event ?? "?", false, "senha do IPN não está salva no painel");
    return text("ERROR: senha do IPN não configurada no painel", 500);
  }
  if (!validSignature(params, digistorePassphrase)) {
    await logEvent("digistore", params.event ?? "?", false, params.sha_sign ? "senha (SHA) diferente da salva no painel" : "aviso sem assinatura: falta a senha SHA na conexão da Digistore");
    return text("ERROR: invalid sha signature", 401);
  }

  const event = params.event ?? "";
  if (event === "connection_test") {
    await logEvent("digistore", event, true, "teste de conexão recebido");
    return text("OK");
  }

  const status = EVENT_STATUS[event];
  if (!status) {
    await logEvent("digistore", event, true, "evento ignorado");
    return text("OK");
  }

  try {
    const orderId = params.order_id ?? params.transaction_id ?? "";
    const seq = params.pay_sequence_no ?? "0";
    let externalId = `${orderId}-${params.product_id ?? "0"}-${seq}`;

    // Reembolso/chargeback: atualiza o pagamento original daquele pedido
    if (status === "refunded" || status === "chargeback") {
      const { data } = await db()
        .from("sales")
        .select("external_id")
        .eq("platform", "digistore")
        .like("external_id", `${orderId}-%`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data?.[0]) externalId = data[0].external_id;
    }

    const name = [params.address_first_name, params.address_last_name].filter(Boolean).join(" ") || null;
    const amount = Number(params.amount ?? params.transaction_amount ?? params.amount_brutto ?? 0);

    await ingestSale({
      platform: "digistore",
      external_id: externalId,
      status,
      created_at: params.order_date_time ? new Date(params.order_date_time.replace(" ", "T") + "Z").toISOString() : null,
      product_id: params.product_id ?? null,
      product_name: params.product_name ?? null,
      customer_name: name,
      customer_email: params.email ?? params.address_email ?? null,
      customer_phone: params.address_phone_no ?? null,
      customer_country: params.address_country ?? params.country ?? null,
      payment_method: params.pay_method ?? null,
      currency: params.currency ?? "EUR",
      gross_amount: Math.abs(amount),
      net_reported: params.vendor_netto_amount ? Number(params.vendor_netto_amount) : null,
      click_id: params.custom || null,
      utm_source: params.utm_source ?? null,
      utm_medium: params.utm_medium ?? null,
      utm_campaign: params.utm_campaign ?? params.campaignkey ?? null,
      utm_content: params.utm_content ?? null,
      utm_term: params.utm_term ?? params.trackingkey ?? null,
      raw: params,
    });
    await logEvent("digistore", event, true, externalId);
    return text("OK");
  } catch (e: any) {
    await logEvent("digistore", event, false, e?.message ?? "erro", params);
    return text("ERROR: falha ao processar", 500);
  }
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function decodeEntities(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function validSignature(params: Record<string, string>, passphrase: string): boolean {
  const received = (params.sha_sign ?? params.SHASIGN ?? "").toUpperCase();
  if (!received) return false;
  const keys = Object.keys(params)
    .filter((k) => k !== "sha_sign" && k !== "SHASIGN" && params[k] !== "" && params[k] !== undefined && params[k] !== null)
    .sort();
  // Igual ao exemplo oficial (PHP): html_entity_decode no valor antes de montar a string
  const str = keys.map((k) => `${k}=${decodeEntities(String(params[k]))}${passphrase}`).join("");
  const calc = createHash("sha512").update(str, "utf8").digest("hex").toUpperCase();
  return safeEqual(calc, received);
}
