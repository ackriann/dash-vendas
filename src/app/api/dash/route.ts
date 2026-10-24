import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DASH_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Troca o dash do seletor: /api/dash?id=<dash>&next=/vendas (sem id = Todos). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const next = url.searchParams.get("next") ?? "/";
  const store = await cookies();
  // Só aceita dash da própria conta (a consulta já é filtrada pela conta logada)
  const { data } = /^[0-9a-f-]{36}$/i.test(id) ? await db().from("dashboards").select("id").eq("id", id).maybeSingle() : { data: null };
  if (data) store.set(DASH_COOKIE, data.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  else store.delete(DASH_COOKIE);
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return Response.redirect(`${env.appUrl}${safe}`, 303);
}
