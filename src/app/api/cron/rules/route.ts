import { timingSafeEqual } from "crypto";
import { getSetting, logEvent, runAsWorkspace } from "@/lib/db";
import { runRules } from "@/lib/rules";
import { listProfiles, refreshProfile } from "@/lib/profiles";
import { listWorkspaces, workspaceFromUrl } from "@/lib/workspaces";

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
 * - Chave gerada na tela de Regras (?key=...&a=conta): roda só aquela conta.
 * - CRON_SECRET da Vercel (Authorization: Bearer): roda todas as contas.
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET ?? "";

  if (secret && bearer && same(bearer, secret)) {
    const contas = [];
    for (const ws of await listWorkspaces()) {
      contas.push({ conta: ws.email ?? ws.name, ...(await runAsWorkspace(ws.id, runForWorkspace)) });
    }
    return Response.json({ ok: contas.every((c) => c.ok), contas });
  }

  const ws = await workspaceFromUrl(req.url);
  if (!ws) return Response.json({ error: "conta não encontrada" }, { status: 404 });
  return runAsWorkspace(ws, async () => {
    const saved = await getSetting<string>("cron_key", "");
    if (!(saved && key && same(key, saved))) return Response.json({ error: "chave inválida" }, { status: 401 });
    const r = await runForWorkspace();
    return Response.json(r, { status: r.ok ? 200 : 500 });
  });
}

async function runForWorkspace() {
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
    return { ok: true, renewed, rules: results.map((r) => ({ rule: r.rule, result: r.message })) };
  } catch (e: any) {
    await logEvent("regra", "cron", false, e?.message);
    return { ok: false, renewed, error: e?.message as string };
  }
}

export const GET = handle;
export const POST = handle;
