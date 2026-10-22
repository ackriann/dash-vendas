import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import { env } from "./env";

/** Garante que quem chama uma server action está logado. */
export async function requireAuth(): Promise<void> {
  const store = await cookies();
  const ok = await verifySessionToken(store.get(SESSION_COOKIE)?.value, env.sessionSecret);
  if (!ok) redirect("/login");
}
