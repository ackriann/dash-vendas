import Link from "next/link";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { jobCounts, listRuns } from "@/lib/automacao/engine";
import { groupVideoUpdates, videoScheduleIdsByPublication } from "@/lib/automacao/process-groups";
import { RUN_KIND_LABEL, type RunView } from "@/lib/automacao/types";
import { RunPill } from "@/components/automacao/JobStatus";

const KINDS: [string, string][] = [
  ["", "Todos"],
  ["publish", "Publicações"],
  ["page_sync", "Páginas"],
  ["catalog_update", "Catálogos"],
];

type RunRow = Omit<RunView, "jobs">;

export default async function Processos({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const sp = await searchParams;
  const kind = KINDS.some(([k]) => k === sp.tipo) ? sp.tipo : "";
  // Consultar os grupos separadamente evita que dezenas de vídeos ocultem
  // as campanhas no limite de 100 processos da lista.
  const [publications, pages, catalogUpdates] = await Promise.all([
    listRuns(150, "publish"),
    kind === "" || kind === "page_sync" ? listRuns(80, "page_sync") : Promise.resolve([] as RunRow[]),
    kind === "" || kind === "catalog_update" || kind === "publish" ? listRuns(400, "catalog_update") : Promise.resolve([] as RunRow[]),
  ]);
  const scheduleMap = await videoScheduleIdsByPublication(publications.map((r) => r.id));
  const { byPublication, independent } = groupVideoUpdates(publications, catalogUpdates, scheduleMap);

  const selectedPublications = kind === "catalog_update"
    ? publications.filter((r) => (scheduleMap.get(r.id)?.length ?? 0) > 0 || byPublication.has(r.id))
    : kind === "page_sync" ? [] : publications;
  const selectedPages = kind === "page_sync" || kind === "" ? pages : [];
  const selectedIndependent = kind === "catalog_update" || kind === "" ? independent : [];
  const runs = [...selectedPublications, ...selectedPages, ...selectedIndependent]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 150);
  const counts = await jobCounts(runs.map((r) => r.id));
  const tz = env.timezone;

  return (
    <div className="space-y-4">
      <header>
        <h1>Processos</h1>
        <p className="sub">
          Uma linha por campanha. As atualizações automáticas dos vídeos ficam no
          histórico da respectiva publicação, sem criar dezenas de linhas separadas.
          Atualizações manuais sem campanha associada continuam independentes.
        </p>
      </header>
      <div className="seg">
        {KINDS.map(([k, label]) => (
          <Link key={k} href={k ? `/automacao/processos?tipo=${k}` : "/automacao/processos"} aria-current={kind === k ? "true" : undefined}>{label}</Link>
        ))}
      </div>
      <div className="panel overflow-x-auto">
        <table className="tbl min-w-[780px]">
          <thead><tr><th>Campanha / Processo</th><th>Tipo</th><th>Operações</th><th>Vídeos do catálogo</th><th>Status</th><th>Início</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const c = counts[r.id] ?? { total: 0, done: 0, failed: 0, waiting: 0 };
              const videos = r.kind === "publish" ? (byPublication.get(r.id) ?? []) : [];
              const scheduled = r.kind === "publish" ? (scheduleMap.get(r.id)?.length ?? 0) : 0;
              const failedVideos = videos.filter((v) => v.status === "failed").length;
              const runningVideos = videos.filter((v) => v.status === "queued" || v.status === "running").length;
              const doneVideos = videos.filter((v) => v.status === "done").length;
              const waitingVideoCount = Math.max(0, scheduled - videos.length);
              return (
                <tr key={r.id}>
                  <td>
                    <Link className="hover:underline font-semibold" href={`/automacao/processos/${r.id}`}>{r.title}</Link>
                    {r.kind === "publish" && scheduled > 0 && <p className="text-xs text-muted">Atualizações vinculadas a esta campanha</p>}
                  </td>
                  <td className="text-muted text-sm">{RUN_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="num text-sm">
                    {c.done}/{c.total}
                    {c.failed > 0 && <span className="neg"> · {c.failed} falha(s)</span>}
                    {c.waiting > 0 && <span className="text-spend"> · {c.waiting} aguardando</span>}
                  </td>
                  <td className="text-sm">
                    {r.kind === "publish" && scheduled > 0 ? (
                      <span>
                        {doneVideos > 0 && <span className="text-success">{doneVideos} concluído(s) </span>}
                        {runningVideos > 0 && <span className="text-spend">{runningVideos} processando </span>}
                        {failedVideos > 0 && <span className="neg">{failedVideos} com falha </span>}
                        {waitingVideoCount > 0 && <span className="text-muted">{waitingVideoCount} programado(s)</span>}
                      </span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td><RunPill status={r.status} /></td>
                  <td className="text-muted text-sm">{fmtDateTime(r.created_at, tz)}</td>
                </tr>
              );
            })}
            {!runs.length && <tr><td colSpan={6} className="text-center text-muted py-8">Nenhum processo encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
