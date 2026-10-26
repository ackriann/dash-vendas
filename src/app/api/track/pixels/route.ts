import { rawDb } from "@/lib/db";
import { resolvePixelCode } from "@/lib/pixel-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * t.js → quais pixels carregar para o código px_... (só os IDs públicos dos pixels,
 * que já aparecem no navegador de qualquer forma; tokens nunca saem daqui).
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const target = await resolvePixelCode(code);
  if (!target) return Response.json({ error: "código inválido" }, { status: 404, headers: CORS });
  let q = rawDb().from("pixels").select("pixel_id").eq("workspace_id", target.workspaceId);
  if (target.pixelIds) q = q.in("id", target.pixelIds);
  const { data } = await q.order("created_at");
  const pixels = [...new Set((data ?? []).map((p: any) => String(p.pixel_id)))];
  return Response.json(
    { account: target.workspaceId, pixels },
    { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
  );
}
