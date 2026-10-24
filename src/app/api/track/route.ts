import { db, runAsWorkspace } from "@/lib/db";
import { workspaceFromUrl } from "@/lib/workspaces";
import { metaIdsFromUtms } from "@/lib/utm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const clean = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Recebe a visita registrada pelo t.js (UTMs + fbclid/fbc/fbp + IP/navegador). */
async function handle(req: Request) {
  const body = await req.json().catch(() => null);
  const vid = clean(body?.vid, 64);
  if (!vid || !/^[a-zA-Z0-9_-]{8,64}$/.test(vid)) return new Response("vid inválido", { status: 400, headers: CORS });

  const utms = {
    utm_source: clean(body.utm_source),
    utm_medium: clean(body.utm_medium),
    utm_campaign: clean(body.utm_campaign),
    utm_content: clean(body.utm_content),
    utm_term: clean(body.utm_term),
  };
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

  const row: Record<string, unknown> = {
    id: vid,
    updated_at: new Date().toISOString(),
    fbclid: clean(body.fbclid),
    fbc: clean(body.fbc),
    fbp: clean(body.fbp),
    ip,
    user_agent: clean(req.headers.get("user-agent"), 400),
    landing_url: clean(body.url, 1000),
    referrer: clean(body.referrer, 1000),
  };
  // Só sobrescreve UTMs se a visita trouxe UTMs novas (último clique pago vence)
  if (utms.utm_source || utms.utm_campaign) Object.assign(row, utms, metaIdsFromUtms(utms));
  for (const k of Object.keys(row)) if (row[k] === null && k !== "id") delete row[k];

  const { error } = await db().from("clicks").upsert(row, { onConflict: "workspace_id,id" });
  if (error) return new Response("erro", { status: 500, headers: CORS });
  return new Response(null, { status: 204, headers: CORS });
}

/** A conta vem do ?a= da URL (sem ele, conta principal). */
export async function POST(req: Request) {
  const ws = await workspaceFromUrl(req.url);
  if (!ws) return new Response("conta não encontrada", { status: 404, headers: CORS });
  return runAsWorkspace(ws, () => handle(req));
}
