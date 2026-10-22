import { timingSafeEqual } from "crypto";
import { getSetting, logEvent } from "@/lib/db";
import { runRules } from "@/lib/rules";
import { listProfiles, refreshProfile } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Roda as regras automáticas e renova os tokens dos perfis (1x por dia).
 * Aceita a chave gerada na tela de Regras (?key=...) ou o CRON_SECRET da Vercel (Authorization: Bearer).
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const saved = await getSetting<string>("cron_key", "");
  const secret = process.env.CRON_SECRET ?? "";
  const ok = (saved && key && same(key, saved)) || (secret && bearer && same(bearer, secret));
  if (!ok) return Response.json({ error: "chave inválida" }, { status: 401 });

  const renewed: string[] = [];
  try {
    for (const p of await listProfiles()) {
      if (p.checked_at && Date.now() - new Date(p.checked_at).getTime() < 20 * 3600000) continue;
      const r = await refreshProfile(p);
      renewed.push(`${p.name}: ${r.status === "ok" ? "ok" : r.last_error}`);
      if (r.status !== "ok") await logEvent("meta", "perfil", false, `${p.name}: ${r.last_error}`);
    }
  } catch (e: any) {
    renewed.push(e?.message ?? "erro ao renovar tokens");
  }

  try {
    const results = await runRules();
    return Response.json({ ok: true, renewed, rules: results.map((r) => ({ rule: r.rule, result: r.message })) });
  } catch (e: any) {
    await logEvent("regra", "cron", false, e?.message);
    return Response.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
