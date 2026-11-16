import Link from "next/link";
import { listRuns, jobCounts } from "@/lib/automacao/engine";
import { fmtDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { RunPill } from "@/components/automacao/JobStatus";
import CampaignStatusRefresh from "./CampaignStatusRefresh";

/** Processos de publicações, separados das operações técnicas e do histórico
 * individual de vídeos. A consulta acontece no workspace autenticado.
 */
export default async function CampaignStatusList({
  hrefFor,
}: { hrefFor: (runId: string) => string }) {
  const runs = await listRuns(60, "publish");
  const counts = await jobCounts(runs.map((r) => r.id));
  const live = runs.filter((r) => r.status === "queued" || r.status === "running").length;
  const failures = runs.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h2>Publicações e acompanhamento</h2>
          <p className="text-sm text-muted">
            Cada campanha possui um processo. Abra para verificar todas as etapas e erros da Meta.
          </p>
        </div>
        <div className="flex gap-2 text-sm items-center">
          <CampaignStatusRefresh />
          <span className="pill">{live} vinculando à Meta</span>
          {failures > 0 && <span className="pill pill-refunded">{failures} com falha</span>}
        </div>
      </div>
      <section className="panel overflow-x-auto">
        <table className="tbl min-w-[620px]">
          <thead><tr>
            <th>Campanha</th><th>Operações</th><th>Status</th><th>Início</th><th />
          </tr></thead>
          <tbody>
            {runs.map((run) => {
              const jobs = counts[run.id] ?? { total: 0, done: 0, failed: 0, waiting: 0 };
              const text = run.status === "running" || run.status === "queued"
                ? "Vinculando campanha ao Facebook"
                : run.status === "done" ? "Verificação concluída"
                : run.status === "failed" ? "Falha na vinculação — verificar"
                : "Publicação interrompida";
              return (
                <tr key={run.id}>
                  <td className="max-w-xs">
                    <Link href={hrefFor(run.id)} className="font-semibold hover:underline block truncate" title={run.title}>{run.title}</Link>
                    <span className="text-xs text-muted">{text}</span>
                  </td>
                  <td className="num">
                    {jobs.done}/{jobs.total}
                    {jobs.failed > 0 && <span className="neg"> · {jobs.failed} falha(s)</span>}
                    {jobs.waiting > 0 && <span className="text-spend"> · {jobs.waiting} aguardando</span>}
                  </td>
                  <td><RunPill status={run.status} /></td>
                  <td className="text-muted text-xs">{fmtDateTime(run.created_at, env.timezone)}</td>
                  <td><Link className="btn btn-sm" href={hrefFor(run.id)}>Ver etapas</Link></td>
                </tr>
              );
            })}
            {runs.length === 0 && <tr><td colSpan={5} className="text-muted text-center py-8">Nenhuma publicação iniciada.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">
        O status representa as verificações e respostas retornadas pela Meta. Uma publicação concluída não significa que todos os anúncios já foram aprovados ou estão veiculando.
      </p>
    </div>
  );
}
