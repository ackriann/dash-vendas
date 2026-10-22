import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { oauthUrl } from "@/lib/meta";
import { getProfile } from "@/lib/profiles";

export const runtime = "nodejs";

/**
 * Inicia o login com Facebook.
 * Sem ?perfil: cria um perfil novo com o app do servidor (META_APP_ID).
 * Com ?perfil=ID: reconecta aquele perfil usando o app dele.
 */
export async function GET(req: Request) {
  const profileId = new URL(req.url).searchParams.get("perfil");
  let appId = env.metaAppId;
  if (profileId) {
    const p = await getProfile(profileId);
    if (!p) return Response.redirect(`${env.appUrl}/perfis?erro=${encodeURIComponent("Perfil não encontrado.")}`, 302);
    appId = p.app_id;
  } else if (!env.metaAppId || !env.metaAppSecret) {
    return Response.redirect(
      `${env.appUrl}/perfis?erro=${encodeURIComponent("Para o login com Facebook, preencha META_APP_ID e META_APP_SECRET no servidor. Ou conecte por token + app.")}`,
      302,
    );
  }
  const state = crypto.randomUUID();
  (await cookies()).set("fb_oauth_state", JSON.stringify({ state, profileId }), {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/",
  });
  return Response.redirect(oauthUrl(appId, state), 302);
}
