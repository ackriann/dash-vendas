import { getRunView, tick } from "@/lib/automacao/engine";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Status do processo para a tela de progresso. Cada consulta também processa
 * as próximas operações prontas (a fila trava cada uma, então abas abertas
 * ao mesmo tempo, o agendador e o after() não executam nada duas vezes).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tickError: string | null = null;
  try {
    await tick({ runId: id, budgetMs: 8_000 });
  } catch (e: any) {
    tickError = e?.message ?? "erro ao processar";
  }
  const run = await getRunView(id);
  if (!run) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
  let hasPendingVideos = false;
  if (run.kind === "publish") {
    const { data: job } = await db().from("ops_jobs").select("status,result")
      .eq("run_id", id).eq("key", "video_schedule").maybeSingle();
    const ids: string[] = job?.status === "done" && Array.isArray(job.result?.scheduleIds)
      ? job.result.scheduleIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (ids.length) {
      const { count } = await db().from("catalog_schedules").select("id", { count: "exact", head: true })
        .in("id", ids).eq("update_type", "set_media").eq("active", true);
      hasPendingVideos = (count ?? 0) > 0;
    }
  }
  return Response.json({ run, tickError, hasPendingVideos }, { headers: { "Cache-Control": "no-store" } });
}
