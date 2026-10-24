import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";
import { DASH_COOKIE } from "@/lib/session";

export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(DASH_COOKIE);
  return Response.redirect(`${env.appUrl}/login`, 303);
}
