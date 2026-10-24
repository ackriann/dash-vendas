import { createHash } from "crypto";
import { currentWorkspace, workspaceFromUrl } from "@/lib/workspaces";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { db, logEvent, runAsWorkspace } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ingestSale, type SaleStatus } from "@/lib/sales";
import { digistoreKey } from "@/lib/digistore";

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
 * Autenticação: chave na URL (?key=, sem precisar de senha na Digistore) ou
 * assinatura SHA-512 de "chave=valor" + senha, em ordem alfabética, sem campos vazios.
 * O vid do script de rastreamento chega no parâmetro "custom".
 * A Digistore espera a resposta "OK" em texto puro.
 */
/** A Digistore abre a URL (GET/HEAD) para validar antes de salvar a conexão: só responde OK. */
export async function GET() {
  return text("OK");
}

async function handle(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  const raw = await req.text().catch(() => "");
  const params = parseBody(raw);
  // Campos que vierem na própria URL (menos a chave) também valem
  for (const [k, v] of new URL(req.url).searchParams) if (k !== "key" && k !== "a" && !(k in params)) params[k] = v;

  // Vale a chave na URL (sem senha na Digistore) OU a assinatura SHA com a senha salva no painel
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const { digistorePassphrase } = await getCheckoutSecrets();
  const keyOk = !!key && safeEqual(key, digistoreKey(await currentWorkspace()));
  const shaOk = !!digistorePassphrase && !!params.sha_sign && validSignature(params, digistorePassphrase);
  if (!keyOk && !shaOk) {
    const why = key
      ? "a chave da URL não confere: copie a URL do painel de novo"
      : params.sha_sign
        ? "a senha SHA da conexão é diferente da salva no painel (ou use a URL do painel, que já tem a chave)"
        : "a URL cadastrada na Digistore está sem a chave: troque pela URL do painel";
    await logEvent("digistore", params.event ?? "?", false, `Aviso recusado: ${why}`);
    return text("ERROR: unauthorized", 401);
  }

  const event = (params.event ?? params.Event ?? params.ipn_event ?? params.event_type ?? "").trim();
  if (event === "connection_test") {
    await logEvent("digistore", event, true, "teste de conexão recebido");
    return text("OK");
  }

  const status = EVENT_STATUS[event];
  if (!status) {
    // Guarda o formato do aviso para dar para ver o que a Digistore mandou
    const sample = Object.fromEntries(Object.entries(params).slice(0, 40).map(([k, v]) => [k, String(v).slice(0, 120)]));
    await logEvent(
      "digistore",
      event || "?",
      !!event,
      event
        ? `evento “${event}” recebido (não muda venda)`
        : `aviso em formato desconhecido (sem o campo event) — ${Object.keys(params).length} campo(s), content-type ${ct || "vazio"}. Confira se a conexão é do tipo Generic.`,
      { content_type: ct, method: req.method, fields: Object.keys(params), sample, raw: Object.keys(params).length ? undefined : raw.slice(0, 2000) },
    );
    return text("OK");
  }

  // Pedido de teste (api_mode=test): confere o rastreio, mas não entra no faturamento
  if (params.api_mode === "test") {
    let tracking = "sem o ID da visita (o link do checkout não passou pelo código do pixel)";
    if (params.custom) {
      const { data: click } = await db().from("clicks").select("utm_campaign,campaign_id").eq("id", params.custom).maybeSingle();
      tracking = click
        ? click.campaign_id
          ? `rastreado: campanha ${click.utm_campaign ?? click.campaign_id}`
          : "com o ID da visita, mas a visita veio sem UTMs de anúncio"
        : "com custom, mas a visita não foi registrada pelo código do pixel";
    }
    await logEvent(
      "digistore",
      event,
      true,
      `Venda de TESTE recebida (não entra no faturamento): ${params.product_name ?? "produto"} · ${params.currency ?? ""} ${params.transaction_amount ?? params.amount_brutto ?? ""} · ${tracking}`,
    );
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
      net_reported: params.amount_vendor ? Number(params.amount_vendor) : null,
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

/** Aceita o corpo como formulário (padrão da Digistore) ou JSON. */
function parseBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const t = raw.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      const flat = j && typeof j === "object" && j.data && typeof j.data === "object" && !j.event ? { ...j.data, event: j.data.event ?? j.type } : j;
      for (const [k, v] of Object.entries(flat ?? {})) out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      return out;
    } catch {
      /* não era JSON: tenta como formulário */
    }
  }
  for (const [k, v] of new URLSearchParams(t)) out[k] = v;
  return out;
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

/** A conta vem do ?a= da URL (sem ele, conta principal). */
export async function POST(req: Request) {
  const ws = await workspaceFromUrl(req.url);
  if (!ws) return text("ERROR: conta não encontrada", 404);
  return runAsWorkspace(ws, () => handle(req));
}
