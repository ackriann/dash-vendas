import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from "./auth";
import { env } from "./env";

/** Cookie com o dash escolhido (só filtra a visão; a conta vem do cookie de sessão). */
export const DASH_COOKIE = "painel_dash";

/** Garante que quem chama uma server action está logado. */
export async function requireAuth(): Promise<void> {
  const store = await cookies();
  const ok = await verifySessionToken(store.get(SESSION_COOKIE)?.value, env.sessionSecret);
  if (!ok) redirect("/login");
}

/** Abre a sessão da conta (login e cadastro). */
export async function startSession(workspaceId: string): Promise<void> {
  const { token, maxAge } = await createSessionToken(env.sessionSecret, workspaceId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  store.delete(DASH_COOKIE);
}
