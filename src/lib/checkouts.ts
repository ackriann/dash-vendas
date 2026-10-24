import "server-only";
import { getSetting, setSetting } from "./db";
import { env as serverEnv } from "./env";
import { currentWorkspace } from "./workspaces";

const NO_ENV = { stripeSecretKey: "", stripeWebhookSecret: "", hotmartHottok: "", digistorePassphrase: "", universalKey: "" };

/**
 * Segredos dos checkouts. Ficam no banco (settings.checkout_secrets), cadastrados pela tela
 * de Integrações. Se um campo não estiver no banco, vale a variável de ambiente (só na conta principal).
 */
export type CheckoutSecrets = {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  hotmartHottok: string;
  digistorePassphrase: string;
  /** chave de API da Digistore24 (quando a conexão foi criada pelo painel) */
  digistoreApiKey: string;
  universalKey: string;
  /** webhook_secret (whsec_...) do destino criado na Cooud */
  cooudWebhookSecret: string;
  /** chave cooud_sk_live_* opcional, para completar os pedidos pela API */
  cooudApiKey: string;
};

export type CheckoutSecretKey = keyof CheckoutSecrets;

const SETTING = "checkout_secrets";

async function stored(): Promise<Partial<CheckoutSecrets>> {
  return getSetting<Partial<CheckoutSecrets>>(SETTING, {});
}

export async function getCheckoutSecrets(): Promise<CheckoutSecrets> {
  const s = await stored();
  // As variáveis de ambiente são da conta principal; contas novas usam só o que cadastraram
  const env = (await currentWorkspace()).is_owner ? serverEnv : NO_ENV;
  return {
    stripeSecretKey: s.stripeSecretKey || env.stripeSecretKey,
    stripeWebhookSecret: s.stripeWebhookSecret || env.stripeWebhookSecret,
    hotmartHottok: s.hotmartHottok || env.hotmartHottok,
    digistorePassphrase: s.digistorePassphrase || env.digistorePassphrase,
    digistoreApiKey: s.digistoreApiKey || "",
    universalKey: s.universalKey || env.universalKey,
    cooudWebhookSecret: s.cooudWebhookSecret || "",
    cooudApiKey: s.cooudApiKey || "",
  };
}

/** Grava (ou apaga, com string vazia) campos no banco. */
export async function saveCheckoutSecrets(patch: Partial<CheckoutSecrets>): Promise<void> {
  const next: Partial<CheckoutSecrets> = { ...(await stored()), ...patch };
  for (const k of Object.keys(next) as CheckoutSecretKey[]) if (!next[k]) delete next[k];
  await setSetting(SETTING, next);
}
