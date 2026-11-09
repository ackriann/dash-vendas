"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { JOB_STATUS_LABEL, RUN_KIND_LABEL, type RunView } from "@/lib/automacao/types";
import { JobPill, RunPill } from "@/components/automacao/JobStatus";
import SubmitButton from "@/components/SubmitButton";
import { cancelRunAction, recoverCatalogPublicationAction, retryRunAction, updateScheduledVideosNowAction } from "../../actions";
import type { VideoUpdateRow } from "@/lib/automacao/process-groups";

const ICON: Record<string, string> = { pending: "·", running: "↻", waiting_sync: "↻", done: "✓", failed: "!", skipped: "–" };
const LIVE = new Set(["queued", "running"]);

/**
 * Progresso real do processo. Consulta o servidor a cada 1,5 s; cada consulta
 * também avança a fila. Recarregar a página ou perder a conexão não duplica nada:
 * o estado está no banco e cada operação é travada enquanto executa.
 */
export default function RunProgress({ initial, back, hasPendingVideos = false, initialVideoUpdates = [], canRecoverCatalog = false }: {
  initial: RunView;
  back?: { href: string; label: string } | null;
  hasPendingVideos?: boolean;
  initialVideoUpdates?: VideoUpdateRow[];
  canRecoverCatalog?: boolean;
}) {
  const [run, setRun] = useState(initial);
  const [pendingVideos, setPendingVideos] = useState(hasPendingVideos);
  const [videoUpdates, setVideoUpdates] = useState(initialVideoUpdates);
  const [offline, setOffline] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setRun(initial), [initial]);
  useEffect(() => setPendingVideos(hasPendingVideos), [hasPendingVideos]);
  useEffect(() => setVideoUpdates(initialVideoUpdates), [initialVideoUpdates]);
  const childRunning = videoUpdates.some((v) => LIVE.has(v.status));
  const live = LIVE.has(run.status) || pendingVideos || childRunning;

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await fetch(`/api/automacao/runs/${initial.id}`, { cache: "no-store" });
        const j = await r.json();
        if (j.run) setRun(j.run);
        if (typeof j.hasPendingVideos === "boolean") setPendingVideos(j.hasPendingVideos);
        if (Array.isArray(j.videoUpdates)) setVideoUpdates(j.videoUpdates);
        setTickError(j.tickError ?? null);
        setOffline(false);
        if (!stop && (LIVE.has(j.run?.status) || j.hasPendingVideos || j.videoUpdates?.some((v: VideoUpdateRow) => LIVE.has(v.status)))) {
          timer.current = setTimeout(poll, LIVE.has(j.run?.status) ? 1500 : 15000);
        }
      } catch {
        setOffline(true);
        if (!stop) timer.current = setTimeout(poll, 15000);
      }
    }
    if (live) poll();
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [initial.id, live]);

  const total = run.jobs.length;
  const done = run.jobs.filter((j) => j.status === "done" || j.status === "skipped").length;
  const failed = run.jobs.filter((j) => j.status === "failed");
  const waiting = run.jobs.filter((j) => j.status === "waiting_sync").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const finished = !live;

  return (
    <div className="space-y-4">
      <section className="panel panel-pad space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <p className="sub">{RUN_KIND_LABEL[run.kind] ?? run.kind}</p>
            <h2 className="truncate">{run.title}</h2>
          </div>
          <RunPill status={run.status} />
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
        <p className="text-sm text-muted">
          {done} de {total} operações concluídas{waiting ? ` · ${waiting} aguardando a Meta` : ""}{failed.length ? ` · ${failed.length} com falha` : ""}
          {offline && <span className="text-spend"> · sem conexão, tentando de novo…</span>}
        </p>
        {tickError && <p className="notice notice-err">{tickError}</p>}
        {!finished && <p className="text-xs text-muted">
          A publicação continua no servidor. Com esta tela aberta, os vídeos agendados também são verificados automaticamente.
          Para executar o delay mesmo com o painel fechado, configure o cron gratuito em Regras.
        </p>}
      </section>

      <section className="panel panel-pad">
        <ol className="timeline">
          {run.jobs.map((j) => (
            <li key={j.id} className="tl-item">
              <span className="tl-dot" data-s={j.status} aria-label={JOB_STATUS_LABEL[j.status]}><span>{ICON[j.status] ?? "·"}</span></span>
              <div className="min-w-0 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-[0.92rem] min-w-0 break-words">{j.label}</p>
                  <JobPill status={j.status} />
                </div>
                {j.message && <p className="text-sm text-muted break-words">{j.message}</p>}
                {j.error && <p className="text-sm neg break-words">{j.error}</p>}
                {j.meta_id && j.status === "done" && <p className="text-xs text-muted mono">ID na Meta: {j.meta_id}</p>}
                {j.attempts > 1 && <p className="text-xs text-muted">{j.attempts} tentativas</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {run.kind === "publish" && run.jobs.some((j) => j.key === "video_schedule") && (
        <section className="panel panel-pad space-y-3">
          <div>
            <h2>Atualizações dos vídeos desta campanha</h2>
            <p className="text-sm text-muted">
              Os vídeos são agrupados aqui pelo agendamento da publicação. Cada resultado corresponde a
              uma atualização do catálogo, sem criar outra campanha ou outro anúncio.
            </p>
          </div>
          {videoUpdates.length ? (
            <div className="divide-y divide-line">
              {videoUpdates.map((v) => (
                <div key={v.id} className="py-3 space-y-1">
                  <div className="flex flex-wrap gap-2 items-center justify-between">
                    <span className="font-semibold break-words">{v.title}</span>
                    <RunPill status={v.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {v.done} de {v.total} operação(ões) concluída(s)
                    {v.waiting > 0 ? ` · ${v.waiting} aguardando` : ""}
                    {v.failed > 0 ? ` · ${v.failed} com falha` : ""}
                  </p>
                  {v.error && <p className="text-sm neg break-words">{v.error}</p>}
                  <Link className="text-xs text-info hover:underline" href={`/automacao/processos/${v.id}`}>
                    Ver detalhes técnicos da atualização
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Nenhuma atualização de vídeo executada ainda. As mídias aparecerão aqui quando o agendamento
              disparar ou quando você clicar em “Atualizar vídeos agora”.
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {pendingVideos && run.kind === "publish" && (
          <form action={updateScheduledVideosNowAction}>
            <input type="hidden" name="run_id" value={run.id} />
            <SubmitButton className="btn btn-primary" pendingText="Enviando atualização…" confirm="Enviar agora a atualização dos produtos com vídeo? A Meta pode processar e revisar os vídeos novamente.">
              Atualizar vídeos agora
            </SubmitButton>
          </form>
        )}
        {run.status === "failed" && canRecoverCatalog && (
          <form action={recoverCatalogPublicationAction}>
            <input type="hidden" name="id" value={run.id} />
            <SubmitButton className="btn btn-primary" pendingText="Recuperando…"
              confirm="Recuperar esta publicação? A campanha, o catálogo e os produtos existentes serão preservados. Será criado UM novo conjunto de anúncios pausado dentro da mesma campanha. O conjunto antigo permanecerá pausado e o processo validará novamente os vídeos.">
              Recuperar conjunto na campanha original
            </SubmitButton>
          </form>
        )}
        {(run.status === "canceled" || (run.status === "failed" && !canRecoverCatalog)) && (
          <form action={retryRunAction}>
            <input type="hidden" name="id" value={run.id} />
            <SubmitButton className="btn btn-primary" pendingText="Recolocando…">Tentar de novo</SubmitButton>
          </form>
        )}
        {run.kind === "publish" && run.status === "failed" && run.ref_id && (
          <Link className="btn" href={`/automacao/criar?rascunho=${run.ref_id}`}>Corrigir no rascunho</Link>
        )}
        {LIVE.has(run.status) && (
          <form action={cancelRunAction}>
            <input type="hidden" name="id" value={run.id} />
            <SubmitButton className="btn btn-danger" pendingText="…" confirm="Cancelar as operações que ainda não rodaram? O que já foi criado na Meta continua lá.">Cancelar</SubmitButton>
          </form>
        )}
        {finished && run.kind === "publish" && run.status === "done" && <Link className="btn btn-primary" href="/automacao/campanhas?criadas=1">Ver campanhas publicadas</Link>}
        {back && <Link className="btn" href={back.href}>{back.label}</Link>}
      </div>
      {finished && run.status === "failed" && (
        <p className="sub">
          {canRecoverCatalog
            ? "Este processo ainda referencia um conjunto de anúncios antigo, incompatível com produtos individuais. Use a recuperação acima: ela mantém a campanha e cria um conjunto corrigido dentro dela. O conjunto antigo não será apagado."
            : "Tentar de novo preserva as operações concluídas. Para alterar a configuração, use Corrigir no rascunho."}
        </p>
      )}
    </div>
  );
}
