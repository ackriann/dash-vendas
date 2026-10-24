import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// =====================================================================
// Cooud (https://docs.cooud.com/public-doc) — webhook de loja e consulta
// de pedidos pela API v2.
// - Webhook: Store → Integrations → Webhooks (order.paid, order.refunded...),
//   assinado com X-Cooud-Signature: t=<segundos>,v1=<hmac_sha256("{t}.{raw_body}")>
//   usando o webhook_secret (whsec_...).
// - API (opcional): chave cooud_sk_live_* só para completar o pedido
//   (e-mail, líquido, metadata/UTMs). Criar webhook pela API é só para
//   chave de plataforma, então a loja cria o destino no painel da Cooud.
// =====================================================================

const API = "https://api.cooud.com/v2";
const COMPAT_DATE = "2026-09-01";
const TOLERANCE_SEC = 300;

/** Verificação oficial da documentação (Confie no evento. Verifique a assinatura.). */
export function verifyCooudSignature(rawBody: Buffer, header: string | null, secret: string): boolean {
  if (!header || !secret.trim()) return false;
  const parts = new Map<string, string>();
  for (const segment of header.split(",")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim();
    if (key !== "t" && key !== "v1") continue;
    if (parts.has(key)) return false;
    parts.set(key, segment.slice(eq + 1).trim());
  }
  const t = parts.get("t") ?? "";
  const digest = parts.get("v1") ?? "";
  if (!/^[1-9][0-9]{0,12}$/.test(t)) return false;
  if (!/^[0-9a-f]{64}$/i.test(digest)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > TOLERANCE_SEC) return false;
  const expected = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${t}.`, "ascii"), rawBody])).digest();
  return timingSafeEqual(expected, Buffer.from(digest, "hex"));
}

export interface CooudOrder {
  id: string;
  status: string;
  currency: string;
  total_amount: number;
  net_amount?: number | null;
  refunded_amount?: number | null;
  customer_email?: string | null;
  country?: string | null;
  created?: number | null;
  billing_reason?: string | null;
  payment_method_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function call<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cooud-Compat-Date": COMPAT_DATE,
      "User-Agent": "PainelVendas/1.0",
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = json?.error?.code ?? `erro ${res.status}`;
    const msg = json?.error?.message ?? "";
    throw new Error(/api_key/.test(code) ? `Chave de API recusada pela Cooud (${code}).` : `${code}${msg ? `: ${msg}` : ""}`);
  }
  return json as T;
}

/** Confere se a chave funciona (lista 1 pedido da loja). */
export async function checkCooudKey(apiKey: string): Promise<void> {
  await call(apiKey, "/orders?limit=1");
}

/**
 * Pedido completo pela API. O webhook de loja pode mandar o ID sem o prefixo
 * cooud_ord_; nesse caso tenta também com o prefixo. Falha = null (o webhook segue sem enriquecer).
 */
export async function fetchCooudOrder(apiKey: string, id: string): Promise<CooudOrder | null> {
  const tries = id.startsWith("cooud_ord_") ? [id] : [id, `cooud_ord_${id}`];
  for (const t of tries) {
    try {
      return await call<CooudOrder>(apiKey, `/orders/${encodeURIComponent(t)}`);
    } catch {
      /* tenta o próximo formato */
    }
  }
  return null;
}
