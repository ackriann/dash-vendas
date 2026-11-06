import Link from "next/link";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { jobCounts, listRuns } from "@/lib/automacao/engine";
import { RUN_KIND_LABEL } from "@/lib/automacao/types";
import { RunPill } from "@/components/automacao/JobStatus";

const KINDS: [string, string][] = [["", "Todos"], ["publish", "Publicações"], ["page_sync", "Páginas"], ["catalog_update", "Catálogos"]];

export default async function Processos({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const sp = await searchParams;
  const kind = KINDS.some(([k]) => k === sp.tipo) ? sp.tipo : "";
  const runs = await listRuns(100, kind || undefined).catch(() => []);
  const counts = await jobCounts(runs.map((r) => r.id));
  const tz = env.timezone;

  return (
    <div className="space-y-4">
      <header>
        <h1>Processos</h1>
        <p className="sub">Tudo o que o módulo enviou para a Meta, com o estado de cada operação. Fica salvo mesmo se a página fechar.</p>
      </header>
      <div className="seg">
        {KINDS.map(([k, label]) => (
          <Link key={k} href={k ? `/automacao/processos?tipo=${k}` : "/automacao/processos"} aria-current={kind === k ? "true" : undefined}>{label}</Link>
        ))}
      </div>
      <div className="panel overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead><tr><th>Processo</th><th>Tipo</th><th>Operações</th><th>Status</th><th>Início</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const c = counts[r.id] ?? { total: 0, done: 0, failed: 0, waiting: 0 };
              return (
                <tr key={r.id}>
                  <td><Link className="hover:underline font-semibold" href={`/automacao/processos/${r.id}`}>{r.title}</Link></td>
                  <td className="text-muted text-sm">{RUN_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="num text-sm">{c.done}/{c.total}{c.failed ? <span className="neg"> · {c.failed} falha(s)</span> : null}{c.waiting ? <span className="text-spend"> · {c.waiting} aguardando</span> : null}</td>
                  <td><RunPill status={r.status} /></td>
                  <td className="text-muted text-sm">{fmtDateTime(r.created_at, tz)}</td>
                </tr>
              );
            })}
            {!runs.length && <tr><td colSpan={5} className="text-center text-muted py-8">Nenhum processo ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
