import { after } from "next/server";
import { workspaceFromUrl } from "@/lib/workspaces";
import { currentWorkspaceId, logEvent, runAsWorkspace } from "@/lib/db";
import { SITE_EVENTS, getPixelsByIds, sendSiteEvent } from "@/lib/capi";

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
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v && Number.isFinite(Number(v)) ? Number(v) : undefined);

// Erros repetidos (ex.: token do pixel vencido) entram no log no máximo 1x a cada 10 min
const lastErr = new Map<string, number>();

/**
 * Evento do site vindo do t.js → API de Conversões dos pixels informados.
 * Só vale para pixels cadastrados no painel (é de lá que vem o token).
 */
async function handle(req: Request) {
  const body = await req.json().catch(() => null);
  const vid = clean(body?.vid, 64);
  const name = clean(body?.event_name, 40);
  const eventId = clean(body?.event_id, 100);
  const ids = (Array.isArray(body?.pixels) ? body.pixels : [])
    .map((p: unknown) => String(p).replace(/\D/g, ""))
    .filter(Boolean)
    .slice(0, 5);
  if (!vid || !/^[a-zA-Z0-9_-]{8,64}$/.test(vid) || !name || !SITE_EVENTS.includes(name) || !eventId || !ids.length) {
    return new Response("evento inválido", { status: 400, headers: CORS });
  }

  const cd = body.custom_data && typeof body.custom_data === "object" ? body.custom_data : {};
  const custom_data: Record<string, unknown> = {};
  const value = num(cd.value);
  if (value !== undefined) custom_data.value = value;
  if (clean(cd.currency, 3)) custom_data.currency = String(cd.currency).toUpperCase().slice(0, 3);
  if (clean(cd.content_name)) custom_data.content_name = clean(cd.content_name, 200);
  if (Array.isArray(cd.content_ids)) custom_data.content_ids = cd.content_ids.slice(0, 10).map((x: unknown) => String(x).slice(0, 100));

  const ev = {
    event_name: name,
    event_id: eventId,
    vid,
    url: clean(body.url, 1000),
    fbc: clean(body.fbc),
    fbp: clean(body.fbp),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
    user_agent: clean(req.headers.get("user-agent"), 400),
    custom_data,
  };

  // Responde na hora; o envio para a Meta acontece depois (na mesma conta)
  const ws = await currentWorkspaceId();
  after(() => runAsWorkspace(ws, async () => {
    const pixels = await getPixelsByIds(ids);
    await Promise.all(
      pixels.map(async (px) => {
        const r = await sendSiteEvent(px, ev);
        if (!r.ok && Date.now() - (lastErr.get(px.pixel_id) ?? 0) > 600000) {
          lastErr.set(px.pixel_id, Date.now());
          await logEvent("capi", name, false, `${px.name}: ${r.message}`, { pixel: px.pixel_id });
        }
      }),
    );
  }));
  return new Response(null, { status: 204, headers: CORS });
}

/** A conta vem do ?a= da URL (sem ele, conta principal). */
export async function POST(req: Request) {
  const ws = await workspaceFromUrl(req.url);
  if (!ws) return new Response("conta não encontrada", { status: 404, headers: CORS });
  return runAsWorkspace(ws, () => handle(req));
}
