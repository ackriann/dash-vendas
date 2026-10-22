import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Rotas abertas: login, webhooks das plataformas, rastreamento e arquivos do PWA.
const PUBLIC = [
  /^\/login/,
  /^\/api\/webhooks\//,
  /^\/api\/track/,
  /^\/api\/cron\//,
  /^\/t\.js$/,
  /^\/sw\.js$/,
  /^\/manifest\.webmanifest$/,
  /^\/icons\//,
  /^\/favicon/,
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
