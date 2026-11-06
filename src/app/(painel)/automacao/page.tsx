import Link from "next/link";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { listAccounts, listProfiles } from "@/lib/profiles";
import { OPTIONAL_SCOPES } from "@/lib/meta";
import { jobCounts, listDrafts, listRuns } from "@/lib/automacao/engine";
import { RUN_KIND_LABEL, validateDraft } from "@/lib/automacao/types";
import { RunPill } from "@/components/automacao/JobStatus";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { deleteDraftAction, duplicateDraftAction, newDraftAction } from "./actions";

const DRAFT_STATUS: Record<string, [string, string]> = {
  draft: ["Rascunho", ""],
  queued: ["Publicando", "pill-info"],
  published: ["Publicado", "pill-approved"],
  failed: ["Falhou", "pill-refunded"],
};

export default async function Automacao({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const tz = env.timezone;
  let setupError: string | null = null;
  const [profiles, accounts] = await Promise.all([listProfiles().catch(() => []), listAccounts().catch(() => [])]);
  const [drafts, runs, pages, schedules] = await Promise.all([
    listDrafts().catch((e) => { setupError = e?.message; return []; }),
    listRuns(8).catch(() => []),
    db().from("fb_pages").select("page_id", { count: "exact", head: true }).then((r) => r.count ?? 0, () => 0),
    db().from("catalog_schedules").select("id", { count: "exact", head: true }).eq("active", true).then((r) => r.count ?? 0, () => 0),
  ]);
  const { error: migErr } = await db().from("ops_runs").select("id").limit(1);
  if (migErr) setupError = migErr.message;
  const counts = await jobCounts(runs.map((r) => r.id));
  const missingOptional = profiles.flatMap((p) => Object.keys(OPTIONAL_SCOPES).filter((s) => !p.scopes.includes(s)).map((s) => ({ p, s })));

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Automação de Campanhas</h1>
          <p className="sub">Crie campanhas completas, gerencie catálogos, mídias e FanPages usando as conexões Meta que você já tem.</p>
        </div>
        <form action={newDraftAction}>
          <SubmitButton className="btn btn-primary" pendingText="Abrindo…">+ Nova campanha</SubmitButton>
        </form>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      {setupError && (
        <p className="notice notice-err">
          O banco ainda não tem as tabelas do módulo. Rode <code>supabase/migrations/005_automacao.sql</code> no Supabase (SQL Editor). Detalhe: {setupError}
        </p>
      )}
      {!profiles.length && (
        <p className="notice notice-warn">Conecte um perfil em <Link className="underline" href="/perfis">Perfis Meta</Link> — o módulo usa essa mesma conexão.</p>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Perfis Meta conectados" value={profiles.length} href="/perfis" />
        <Stat label="Contas de anúncio" value={accounts.length} href="/perfis" />
        <Stat label="FanPages sincronizadas" value={pages} href="/automacao/fanpages" />
        <Stat label="Automações de catálogo ativas" value={schedules} href="/automacao/catalogos" />
      </section>

      {missingOptional.length > 0 && (
        <section className="panel panel-pad space-y-2">
          <h2>Permissões opcionais</h2>
          <p className="sub">Só precisam ser liberadas se você for usar o recurso. O resto do painel continua funcionando sem elas.</p>
          <ul className="text-sm space-y-1.5">
            {missingOptional.map(({ p, s }) => (
              <li key={p.id + s} className="flex flex-wrap items-center gap-2">
                <span><b>{p.name}</b> sem <code>{s}</code> — {OPTIONAL_SCOPES[s]}</span>
                <a className="btn btn-sm" href={`/api/auth/facebook?perfil=${p.id}&extra=${s}&voltar=/automacao`}>Autorizar só isso</a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Perfis conectados por token colado: gere um token novo no mesmo app marcando essa permissão e reconecte em Perfis Meta.</p>
        </section>
      )}

      <section className="space-y-2">
        <h2>Rascunhos e campanhas criadas</h2>
        <div className="panel overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead><tr><th>Campanha</th><th>Conta</th><th>Status</th><th>Atualizado</th><th /></tr></thead>
            <tbody>
              {drafts.map((d) => {
                const v = validateDraft(d.data);
                const pend = v[1].length + v[2].length + v[3].length;
                const [label, cls] = DRAFT_STATUS[d.status] ?? DRAFT_STATUS.draft;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link className="hover:underline font-semibold" href={d.status === "draft" || d.status === "failed" ? `/automacao/criar?rascunho=${d.id}` : `/automacao/processos/${d.run_id}`}>{d.name}</Link>
                      {d.status === "draft" && <span className="block text-xs text-muted">{pend ? `${pend} campo(s) para completar · etapa ${d.step}` : "Pronto para publicar"}</span>}
                    </td>
                    <td className="text-muted text-sm">{accounts.find((a) => a.id === d.account_id)?.name ?? "—"}</td>
                    <td><span className={`pill ${cls}`}>{label}</span></td>
                    <td className="text-muted text-sm">{fmtDateTime(d.updated_at, tz)}</td>
                    <td className="r">
                      <div className="flex justify-end gap-1.5">
                        {d.run_id && <Link className="btn btn-sm" href={`/automacao/processos/${d.run_id}`}>Processo</Link>}
                        <form action={duplicateDraftAction}><input type="hidden" name="id" value={d.id} /><SubmitButton className="btn btn-sm" pendingText="…">Duplicar</SubmitButton></form>
                        {d.status !== "queued" && (
                          <form action={deleteDraftAction}><input type="hidden" name="id" value={d.id} /><SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={`Excluir o rascunho "${d.name}"? O que já foi publicado na Meta não é apagado.`}>Excluir</SubmitButton></form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!drafts.length && <tr><td colSpan={5} className="text-center text-muted py-8">Nenhuma campanha criada pelo módulo ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2>Últimos processos</h2><Link className="text-sm text-info hover:underline" href="/automacao/processos">Ver todos</Link></div>
        <div className="grid gap-2">
          {runs.map((r) => {
            const c = counts[r.id] ?? { total: 0, done: 0, failed: 0, waiting: 0 };
            return (
              <Link key={r.id} href={`/automacao/processos/${r.id}`} className="panel px-4 py-3 flex items-center gap-3 hover:border-[#3b6170]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{r.title}</p>
                  <p className="text-xs text-muted">{RUN_KIND_LABEL[r.kind] ?? r.kind} · {fmtDateTime(r.created_at, tz)} · {c.done}/{c.total} operações</p>
                </div>
                <RunPill status={r.status} />
              </Link>
            );
          })}
          {!runs.length && <p className="sub">Nada processado ainda.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="panel px-4 py-3 hover:border-[#3b6170]">
      <p className="sub">{label}</p>
      <p className="num text-xl font-semibold">{value}</p>
    </Link>
  );
}
