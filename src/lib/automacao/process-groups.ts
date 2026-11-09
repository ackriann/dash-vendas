import "server-only";
import { db } from "../db";
import type { RunStatus, RunView } from "./types";

type RunBase = Omit<RunView, "jobs">;

export interface VideoUpdateRow {
  id: string;
  title: string;
  status: RunStatus;
  created_at: string;
  scheduleId: string;
  done: number;
  total: number;
  failed: number;
  waiting: number;
  error: string | null;
}

/** O agendamento da publicação é a origem confiável da relação com cada vídeo.
 * Funciona com campanhas antigas, sem migração nem alteração do histórico.
 */
export async function videoScheduleIdsByPublication(runIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!runIds.length) return map;
  const { data, error } = await db()
    .from("ops_jobs")
    .select("run_id,result,status")
    .eq("key", "video_schedule")
    .eq("status", "done")
    .in("run_id", runIds);
  if (error) throw new Error(error.message);
  for (const job of data ?? []) {
    const ids = Array.isArray(job.result?.scheduleIds) ? job.result.scheduleIds : [];
    map.set(job.run_id, ids.filter((id: unknown): id is string =>
      typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)));
  }
  return map;
}

/** Agrupa atualizações catalog_update por publicação. Somente vínculos por
 * scheduleId são agrupados; atualizações manuais avulsas continuam independentes.
 */
export function groupVideoUpdates(
  publications: RunBase[],
  updates: RunBase[],
  scheduleMap: Map<string, string[]>,
): { byPublication: Map<string, RunBase[]>; independent: RunBase[] } {
  const owner = new Map<string, string>();
  for (const pub of publications) {
    for (const id of scheduleMap.get(pub.id) ?? []) owner.set(id, pub.id);
  }
  const byPublication = new Map<string, RunBase[]>();
  const independent: RunBase[] = [];
  for (const update of updates) {
    const scheduleId = update.summary?.scheduleId;
    const origin = typeof scheduleId === "string" ? owner.get(scheduleId) : undefined;
    if (!origin) {
      independent.push(update);
      continue;
    }
    const children = byPublication.get(origin) ?? [];
    children.push(update);
    byPublication.set(origin, children);
  }
  return { byPublication, independent };
}

/** Para a tela do processo: as atualizações aparecem dentro da campanha,
 * inclusive as que falharam e as que foram iniciadas por cron.
 */
export async function videoUpdatesForPublication(runId: string): Promise<VideoUpdateRow[]> {
  const ids = (await videoScheduleIdsByPublication([runId])).get(runId) ?? [];
  if (!ids.length) return [];
  const { data: runs, error } = await db()
    .from("ops_runs")
    .select("id,title,status,created_at,summary")
    .eq("kind", "catalog_update")
    .in("summary->>scheduleId", ids)
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw new Error(error.message);
  if (!runs?.length) return [];

  const { data: jobs, error: jobsError } = await db()
    .from("ops_jobs")
    .select("run_id,status,error")
    .in("run_id", runs.map((run) => run.id));
  if (jobsError) throw new Error(jobsError.message);

  const totals = new Map<string, { done: number; total: number; failed: number; waiting: number; error: string | null }>();
  for (const job of jobs ?? []) {
    const curr = totals.get(job.run_id) ?? { done: 0, total: 0, failed: 0, waiting: 0, error: null };
    curr.total++;
    if (job.status === "done" || job.status === "skipped") curr.done++;
    if (job.status === "failed") {
      curr.failed++;
      curr.error ??= job.error || "Falha ao atualizar produto";
    }
    if (job.status === "waiting_sync" || job.status === "pending" || job.status === "running") curr.waiting++;
    totals.set(job.run_id, curr);
  }

  return runs.map((run) => {
    const t = totals.get(run.id) ?? { done: 0, total: 0, failed: 0, waiting: 0, error: null };
    const title = String(run.title ?? "").replace(/^Automação · /, "").replace(/^Vídeo · [a-f0-9]{8} · [a-f0-9]{8} · /i, "");
    return {
      id: run.id,
      title,
      status: run.status as RunStatus,
      created_at: run.created_at,
      scheduleId: typeof run.summary?.scheduleId === "string" ? run.summary.scheduleId : "",
      ...t,
    };
  });
}
