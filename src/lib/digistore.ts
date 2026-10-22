import "server-only";
import { env } from "./env";

// =====================================================================
// API da Digistore24 — só a parte de IPN (criar, consultar e apagar a
// conexão que manda as vendas para o painel).
// Docs: https://dev.digistore24.com (ipnSetup / ipnInfo / ipnDelete)
// =====================================================================

const BASE = "https://www.digistore24.com/api/call";

export const ipnUrl = () => `${env.appUrl}/api/webhooks/digistore`;

/** Identifica a conexão criada por este painel na conta da Digistore. */
export const domainId = () => `painel-${new URL(env.appUrl).hostname}`.replace(/[^a-z0-9.-]/gi, "-").slice(0, 60);

async function call<T = any>(fn: string, apiKey: string, params: Record<string, string> = {}, method: "GET" | "POST" | "DELETE" = "POST"): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(method === "GET" ? `${BASE}/${fn}?${body}` : `${BASE}/${fn}`, {
    method,
    cache: "no-store",
    headers: {
      "X-DS-API-KEY": apiKey,
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method !== "GET" ? body : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.result !== "success") {
    const msg = json.message || json.error || `erro ${res.status}`;
    throw new Error(/api.?key|unauthori|permission|berechtig/i.test(msg) ? `Chave de API recusada pela Digistore24 (${msg}). Use uma chave com acesso total.` : msg);
  }
  return (json.data ?? {}) as T;
}

/** Cria (ou atualiza) a conexão IPN apontando para o painel. Devolve a senha gerada. */
export async function setupIpn(apiKey: string): Promise<{ passphrase: string }> {
  const data = await call<{ sha_passphrase?: string }>("ipnSetup", apiKey, {
    ipn_url: ipnUrl(),
    name: "Painel de Vendas",
    product_ids: "all",
    domain_id: domainId(),
    categories: "orders",
    transactions: "payment,refund,chargeback,payment_missed",
    timing: "before_thankyou",
    sha_passphrase: "random",
    newsletter_send_policy: "send_always",
  });
  if (!data.sha_passphrase) throw new Error("A Digistore24 não devolveu a senha da conexão.");
  return { passphrase: data.sha_passphrase };
}

export interface IpnInfo {
  exists: boolean;
  url: string | null;
  urlOk: boolean;
  transactions: string | null;
  products: string | null;
}

/** Consulta na Digistore se a conexão do painel existe e para onde aponta. */
export async function ipnInfo(apiKey: string): Promise<IpnInfo> {
  try {
    const d = await call<Record<string, any>>("ipnInfo", apiKey, { domain_id: domainId() }, "GET");
    const url = (d.url ?? d.ipn_url ?? null) as string | null;
    return {
      exists: !!url,
      url,
      urlOk: !!url && url.replace(/\/$/, "") === ipnUrl(),
      transactions: d.transactions ?? null,
      products: d.product_ids ?? null,
    };
  } catch (e: any) {
    // Conexão inexistente vem como erro da API
    if (/not found|nicht gefunden|no ipn|keine/i.test(e?.message ?? "")) return { exists: false, url: null, urlOk: false, transactions: null, products: null };
    throw e;
  }
}

export async function deleteIpn(apiKey: string): Promise<void> {
  await call("ipnDelete", apiKey, { domain_id: domainId() }, "DELETE");
}
