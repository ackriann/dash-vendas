import { getRunView, tick } from "@/lib/automacao/engine";

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
  return Response.json({ run, tickError }, { headers: { "Cache-Control": "no-store" } });
}
