import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.redirect(`${env.appUrl}/login`, 303);
}
