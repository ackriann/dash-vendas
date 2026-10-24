"use server";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { requireAuth } from "@/lib/session";
import { db, setSetting } from "@/lib/db";
import { env } from "@/lib/env";
import { getCheckoutSecrets, saveCheckoutSecrets } from "@/lib/checkouts";
import { publicUrl } from "@/lib/workspaces";
import { checkCooudKey } from "@/lib/cooud";
import { deleteIpn, setupIpn } from "@/lib/digistore";

function go(key: "ok" | "erro", msg: string): never {
  redirect(`/integracoes?${key}=${encodeURIComponent(msg)}`);
}

export async function addPixel(formData: FormData) {
  await requireAuth();
  const name = String(formData.get("name") ?? "").trim() || "Pixel";
  const pixel_id = String(formData.get("pixel_id") ?? "").replace(/\D/g, "");
  const access_token = String(formData.get("access_token") ?? "").trim();
  const test_event_code = String(formData.get("test_event_code") ?? "").trim() || null;
  if (!pixel_id || !access_token) go("erro", "Informe o ID do pixel e o token da API de Conversões.");
  const { count } = await db().from("pixels").select("id", { count: "exact", head: true });
  const { error } = await db().from("pixels").insert({ name, pixel_id, access_token, test_event_code, is_default: !count });
  if (error) go("erro", error.message);
  go("ok", "Pixel cadastrado.");
}

export async function setDefaultPixel(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  await db().from("pixels").update({ is_default: false }).neq("id", id);
  await db().from("pixels").update({ is_default: true }).eq("id", id);
  go("ok", "Pixel padrão atualizado.");
}

export async function updatePixelTestCode(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const code = String(formData.get("test_event_code") ?? "").trim() || null;
  await db().from("pixels").update({ test_event_code: code }).eq("id", id);
  go("ok", code ? "Código de teste salvo: os eventos aparecem em Eventos de teste." : "Código de teste removido: eventos vão para produção.");
}

export async function deletePixel(formData: FormData) {
  await requireAuth();
  await db().from("pixels").delete().eq("id", String(formData.get("id")));
  go("ok", "Pixel removido.");
}

export async function setAutoCapi(formData: FormData) {
  await requireAuth();
  await setSetting("auto_capi", formData.get("auto") === "true");
  go("ok", formData.get("auto") === "true" ? "Envio automático ligado." : "Envio automático desligado.");
}

// ------------------------------------------------------------------ Checkouts

const STRIPE_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
];

/** Conexão em 1 clique: com a chave secreta, o painel cria o webhook na Stripe e guarda o whsec_. */
export async function connectStripe(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("secret_key") ?? "").trim();
  if (!/^(sk|rk)_(live|test)_/.test(key)) go("erro", "Cole a chave secreta da Stripe (começa com sk_live_ ou sk_test_).");
  const url = await publicUrl("/api/webhooks/stripe");
  if (!url.startsWith("https://") || /localhost|127\.0\.0\.1/.test(url)) {
    go("erro", "A conexão automática só funciona com o painel publicado (APP_URL com https). Use a configuração manual ou conecte depois do deploy.");
  }

  let error: string | null = null;
  let secret = "";
  try {
    const stripe = new Stripe(key);
    // Remove webhooks antigos que apontam para este painel, para não receber em dobro
    const existing = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const ep of existing.data) if (ep.url === url) await stripe.webhookEndpoints.del(ep.id);
    const ep = await stripe.webhookEndpoints.create({ url, enabled_events: STRIPE_EVENTS, description: "Painel de Vendas" });
    secret = ep.secret ?? "";
  } catch (e: any) {
    error = e?.message ?? "erro";
  }
  if (error || !secret) go("erro", `A Stripe recusou: ${error ?? "não devolveu o segredo do webhook"}`);
  await saveCheckoutSecrets({ stripeSecretKey: key, stripeWebhookSecret: secret });
  go("ok", "Stripe conectada: webhook criado e segredo salvo.");
}

/** Configuração manual da Stripe (chave + whsec_ colados). */
export async function saveStripeManual(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("secret_key") ?? "").trim();
  const whsec = String(formData.get("webhook_secret") ?? "").trim();
  if (!whsec.startsWith("whsec_")) go("erro", "O segredo do webhook começa com whsec_.");
  await saveCheckoutSecrets({ stripeWebhookSecret: whsec, ...(key ? { stripeSecretKey: key } : {}) });
  go("ok", "Stripe salva.");
}

export async function disconnectStripe() {
  await requireAuth();
  const { stripeSecretKey } = await getCheckoutSecrets();
  if (stripeSecretKey) {
    try {
      const stripe = new Stripe(stripeSecretKey);
      const url = await publicUrl("/api/webhooks/stripe");
      const existing = await stripe.webhookEndpoints.list({ limit: 100 });
      for (const ep of existing.data) if (ep.url === url) await stripe.webhookEndpoints.del(ep.id);
    } catch {
      /* se a chave já não vale, só limpa no painel */
    }
  }
  await saveCheckoutSecrets({ stripeSecretKey: "", stripeWebhookSecret: "" });
  go("ok", "Stripe desconectada.");
}

export async function saveHotmart(formData: FormData) {
  await requireAuth();
  const hottok = String(formData.get("hottok") ?? "").trim();
  if (!hottok) go("erro", "Cole o Hottok da Hotmart.");
  await saveCheckoutSecrets({ hotmartHottok: hottok });
  go("ok", "Hotmart conectada.");
}

/** Conexão em 1 clique: com a chave de API, o painel cria o IPN na Digistore24 e guarda a senha. */
export async function connectDigistore(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("api_key") ?? "").trim();
  if (!key) go("erro", "Cole a chave de API da Digistore24.");
  if (!env.appUrl.startsWith("https://") || /localhost|127\.0\.0\.1/.test(env.appUrl)) {
    go("erro", "A conexão automática só funciona com o painel publicado (APP_URL com https).");
  }
  let passphrase = "";
  try {
    passphrase = (await setupIpn(key)).passphrase;
  } catch (e: any) {
    go("erro", `A Digistore24 recusou: ${e?.message ?? "erro"}`);
  }
  await saveCheckoutSecrets({ digistoreApiKey: key, digistorePassphrase: passphrase });
  go("ok", "Digistore24 conectada: conexão IPN criada na sua conta e senha salva. Os avisos chegam a partir da próxima venda.");
}

export async function disconnectDigistore() {
  await requireAuth();
  const { digistoreApiKey } = await getCheckoutSecrets();
  if (digistoreApiKey) await deleteIpn(digistoreApiKey).catch(() => undefined);
  await saveCheckoutSecrets({ digistoreApiKey: "", digistorePassphrase: "" });
  go("ok", "Digistore24 desconectada (conexão IPN apagada na Digistore).");
}

export async function saveDigistore(formData: FormData) {
  await requireAuth();
  // Campo vazio = gera uma senha aleatória para colar na Digistore
  const pass = String(formData.get("passphrase") ?? "").trim() || randomBytes(18).toString("base64url");
  await saveCheckoutSecrets({ digistorePassphrase: pass });
  go("ok", "Senha do IPN salva. Copie e cole a mesma na Digistore24.");
}

export async function newUniversalKey() {
  await requireAuth();
  await saveCheckoutSecrets({ universalKey: randomBytes(24).toString("hex") });
  go("ok", "Nova chave gerada. Atualize a URL nos checkouts que já usavam a antiga.");
}

/** Cooud: segredo do webhook (obrigatório) + chave de API (opcional, testada na hora). */
export async function saveCooud(formData: FormData) {
  await requireAuth();
  const secret = String(formData.get("webhook_secret") ?? "").trim();
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const current = await getCheckoutSecrets();
  if (!secret && !current.cooudWebhookSecret) go("erro", "Cole o segredo do webhook da Cooud (começa com whsec_).");
  if (secret && !/^whsec_[A-Za-z0-9_-]{16,}$/.test(secret)) go("erro", "O segredo do webhook da Cooud começa com whsec_. Copie de novo na tela de criação do webhook.");
  if (apiKey) {
    if (!/^cooud_sk_(live|sandbox)_/.test(apiKey)) go("erro", "A chave de API da Cooud começa com cooud_sk_live_ (Store → Integrations → Chaves da API v2).");
    let error: string | null = null;
    try {
      await checkCooudKey(apiKey);
    } catch (e: any) {
      error = e?.message ?? "erro";
    }
    if (error) go("erro", error);
  }
  await saveCheckoutSecrets({ ...(secret ? { cooudWebhookSecret: secret } : {}), ...(apiKey ? { cooudApiKey: apiKey } : {}) });
  go("ok", apiKey ? "Cooud conectada: webhook e chave de API salvos." : "Cooud conectada: segredo do webhook salvo.");
}

export async function clearCheckout(formData: FormData) {
  await requireAuth();
  const which = String(formData.get("which"));
  if (which === "hotmart") await saveCheckoutSecrets({ hotmartHottok: "" });
  else if (which === "digistore") await saveCheckoutSecrets({ digistorePassphrase: "", digistoreApiKey: "" });
  else if (which === "cooud") await saveCheckoutSecrets({ cooudWebhookSecret: "", cooudApiKey: "" });
  else if (which === "cooud_key") await saveCheckoutSecrets({ cooudApiKey: "" });
  go("ok", "Configuração removida do painel.");
}
