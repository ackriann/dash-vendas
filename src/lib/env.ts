// Acesso centralizado às variáveis de ambiente (somente servidor).
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}. Veja o .env.example.`);
  return v;
}

export const env = {
  get supabaseUrl() { return req("SUPABASE_URL"); },
  get supabaseServiceKey() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get adminPassword() { return req("ADMIN_PASSWORD"); },
  get sessionSecret() { return req("SESSION_SECRET"); },
  get appUrl() { return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""); },
  get timezone() { return process.env.APP_TIMEZONE || "America/Sao_Paulo"; },
  get metaAppId() { return process.env.META_APP_ID || ""; },
  get metaAppSecret() { return process.env.META_APP_SECRET || ""; },
  get metaApiVersion() { return process.env.META_API_VERSION || "v26.0"; },
  get stripeSecretKey() { return process.env.STRIPE_SECRET_KEY || ""; },
  get stripeWebhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ""; },
  get hotmartHottok() { return process.env.HOTMART_HOTTOK || ""; },
  get digistorePassphrase() { return process.env.DIGISTORE_IPN_PASSPHRASE || ""; },
  get universalKey() { return process.env.UNIVERSAL_WEBHOOK_KEY || ""; },
  get vapidPublic() { return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""; },
  get vapidPrivate() { return process.env.VAPID_PRIVATE_KEY || ""; },
  get vapidSubject() { return process.env.VAPID_SUBJECT || "mailto:admin@example.com"; },
};
