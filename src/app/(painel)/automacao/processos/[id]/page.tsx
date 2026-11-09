import Link from "next/link";
import { notFound } from "next/navigation";
import { creatorPages, getRunView } from "@/lib/automacao/engine";
import { normalizeDraft } from "@/lib/automacao/types";
import { db } from "@/lib/db";
import Notice from "@/components/Notice";
import RunProgress from "./RunProgress";
import FixPanel from "./FixPanel";

type SP = Promise<{ ok?: string; erro?: string; de?: string; catalogo?: string; perfil?: string }>;

export default async function Processo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const run = await getRunView(id);
  if (!run) notFound();

  // O botão só aparece para os agendamentos ainda ativos da publicação atual.
  // A consulta é limitada ao workspace autenticado pelo cliente do banco.
  let hasPendingVideos = false;
  if (run.kind === "publish") {
    const { data: job } = await db().from("ops_jobs").select("status,result")
      .eq("run_id", run.id).eq("key", "video_schedule").maybeSingle();
    const ids: string[] = job?.status === "done" && Array.isArray(job.result?.scheduleIds)
      ? job.result.scheduleIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (ids.length) {
      const { count } = await db().from("catalog_schedules").select("id", { count: "exact", head: true })
        .in("id", ids).eq("update_type", "set_media").eq("active", true);
      hasPendingVideos = (count ?? 0) > 0;
    }
  }

  const back =
    sp.de === "fanpages" || run.kind === "page_sync"
      ? { href: "/automacao/fanpages", label: "Ver resultado nas FanPages" }
      : run.kind === "catalog_update"
        ? { href: `/automacao/catalogos/${sp.catalogo ?? run.ref_id}${sp.perfil || run.summary?.profileId ? `?perfil=${sp.perfil ?? run.summary?.profileId}` : ""}`, label: "Voltar ao catálogo" }
        : null;

  // Publicação que falhou: corrige aqui mesmo e continua
  const fix =
    run.kind === "publish" && run.status === "failed" && run.summary?.draft
      ? { draft: normalizeDraft(run.summary.draft), pages: (await creatorPages()).pages, error: run.jobs.find((j) => j.status === "failed")?.error ?? null }
      : null;

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link className="text-muted hover:text-ink" href="/automacao/processos">← Processos</Link></p>
      <Notice ok={sp.ok} erro={sp.erro} />
      <RunProgress initial={run} back={back} hasPendingVideos={hasPendingVideos} />
      {fix && <FixPanel runId={run.id} draftId={run.ref_id} draft={fix.draft} pages={fix.pages} error={fix.error} />}
    </div>
  );
}
