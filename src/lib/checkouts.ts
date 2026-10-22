import "server-only";
import { getSetting, setSetting } from "./db";
import { env } from "./env";

/**
 * Segredos dos checkouts. Ficam no banco (settings.checkout_secrets), cadastrados pela tela
 * de Integrações. Se um campo não estiver no banco, vale a variável de ambiente.
 */
export type CheckoutSecrets = {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  hotmartHottok: string;
  digistorePassphrase: string;
  /** chave de API da Digistore24 (quando a conexão foi criada pelo painel) */
  digistoreApiKey: string;
  universalKey: string;
};

export type CheckoutSecretKey = keyof CheckoutSecrets;

const SETTING = "checkout_secrets";

async function stored(): Promise<Partial<CheckoutSecrets>> {
  return getSetting<Partial<CheckoutSecrets>>(SETTING, {});
}

export async function getCheckoutSecrets(): Promise<CheckoutSecrets> {
  const s = await stored();
  return {
    stripeSecretKey: s.stripeSecretKey || env.stripeSecretKey,
    stripeWebhookSecret: s.stripeWebhookSecret || env.stripeWebhookSecret,
    hotmartHottok: s.hotmartHottok || env.hotmartHottok,
    digistorePassphrase: s.digistorePassphrase || env.digistorePassphrase,
    digistoreApiKey: s.digistoreApiKey || "",
    universalKey: s.universalKey || env.universalKey,
  };
}

/** Grava (ou apaga, com string vazia) campos no banco. */
export async function saveCheckoutSecrets(patch: Partial<CheckoutSecrets>): Promise<void> {
  const next: Partial<CheckoutSecrets> = { ...(await stored()), ...patch };
  for (const k of Object.keys(next) as CheckoutSecretKey[]) if (!next[k]) delete next[k];
  await setSetting(SETTING, next);
}
