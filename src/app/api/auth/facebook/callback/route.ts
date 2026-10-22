import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/db";
import { exchangeCode } from "@/lib/meta";
import { connectProfile, getProfile } from "@/lib/profiles";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string, ok = false) =>
    Response.redirect(`${env.appUrl}/perfis?${ok ? "ok" : "erro"}=${encodeURIComponent(msg)}`, 302);

  const store = await cookies();
  let saved: { state?: string; profileId?: string | null } = {};
  try {
    saved = JSON.parse(store.get("fb_oauth_state")?.value ?? "{}");
  } catch {
    /* cookie inválido */
  }
  store.delete("fb_oauth_state");

  if (url.searchParams.get("error")) return back(url.searchParams.get("error_description") ?? "Login cancelado");
  const code = url.searchParams.get("code");
  if (!code || !saved.state || url.searchParams.get("state") !== saved.state) return back("Sessão de login inválida, tente de novo.");

  try {
    // Reconexão usa o app do próprio perfil; perfil novo usa o app do servidor
    const existing = saved.profileId ? await getProfile(saved.profileId) : null;
    if (saved.profileId && !existing) return back("Perfil não encontrado.");
    const appId = existing?.app_id ?? env.metaAppId;
    const appSecret = existing?.app_secret ?? env.metaAppSecret;
    const token = await exchangeCode(appId, appSecret, code);
    const r = await connectProfile({ name: existing?.name, appId, appSecret, token }, existing?.id);
    await logEvent("meta", "oauth", true, `Perfil ${r.profile.name} conectado pelo login`);
    let msg = `Perfil ${r.profile.name} conectado · ${r.accounts} conta(s) de anúncio. Ative as que entram no painel.`;
    if (r.missing.length) msg += ` Sem as permissões: ${r.missing.join(", ")}.`;
    return back(msg, true);
  } catch (e: any) {
    await logEvent("meta", "oauth", false, e?.message);
    return back(e?.message ?? "Falha ao conectar");
  }
}
