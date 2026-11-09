import Link from "next/link";
import { notFound } from "next/navigation";
import { canRecoverCatalogPublication, creatorPages, getRunView } from "@/lib/automacao/engine";
import { normalizeDraft } from "@/lib/automacao/types";
import { videoUpdatesForPublication } from "@/lib/automacao/process-groups";
import { db } from "@/lib/db";
import { authForAccount } from "@/lib/profiles";
import { catalogBusinessesForAccount } from "@/lib/automacao/meta-ads";
import { fixCatalogBusinessAction } from "../../actions";
import SubmitButton from "@/components/SubmitButton";
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
  const videoUpdates = run.kind === "publish" ? await videoUpdatesForPublication(run.id) : [];

  const catalogFailed = run.kind === "publish" && run.status === "failed" &&
    run.jobs.some((j) => j.kind === "catalog_auto" && j.status === "failed") &&
    !run.jobs.some((j) => j.status === "done");
  const failedDraft = catalogFailed ? normalizeDraft(run.summary?.draft) : null;
  const catalogBusinesses = failedDraft?.accountId
    ? await catalogBusinessesForAccount(await authForAccount(failedDraft.accountId), failedDraft.accountId)
      .catch(() => [] as { id: string; name: string; relation: "partner" | "owner" }[])
    : [];
  const canRecoverCatalog = run.status === "failed" && run.kind === "publish"
    ? await canRecoverCatalogPublication(run.id) : false;

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
      <RunProgress initial={run} back={back} hasPendingVideos={hasPendingVideos}
        initialVideoUpdates={videoUpdates} canRecoverCatalog={canRecoverCatalog}
        hasCatalogBusinessError={catalogFailed} />
      {catalogFailed && (
        <section className="panel panel-pad space-y-3">
          <h2>Corrigir a BM do catálogo</h2>
          <p className="text-sm text-muted">
            Esta conta de anúncios pode pertencer a outra empresa. Selecione a BM parceira que o perfil conectado gerencia
            para criar o catálogo no local correto, sem criar uma nova campanha.
          </p>
          {catalogBusinesses.length > 0 ? (
            <form action={fixCatalogBusinessAction} className="grid gap-3 max-w-xl">
              <input type="hidden" name="run_id" value={run.id} />
              <label className="field">
                <span className="label">Business Manager para o catálogo</span>
                <select className="select" name="business_id"
                  defaultValue={catalogBusinesses.find((b) => b.id === failedDraft?.catalog.businessId)?.id ||
                    catalogBusinesses.find((b) => b.relation === "partner")?.id || catalogBusinesses[0].id}>
                  {catalogBusinesses.map((b) => <option key={b.id} value={b.id}>
                    {b.name} · {b.id} ({b.relation === "partner" ? "parceira" : "proprietária"})
                  </option>)}
                </select>
              </label>
              <SubmitButton className="btn btn-primary" pendingText="Corrigindo…"
                confirm="Usar esta BM no catálogo e tentar novamente a etapa que falhou? Os outros dados da campanha serão preservados.">
                Corrigir BM e continuar
              </SubmitButton>
            </form>
          ) : <p className="notice notice-warn text-sm">
            Não encontrei BMs elegíveis com acesso à conta neste perfil Meta. Confira o compartilhamento da conta e as permissões na empresa parceira.
          </p>}
        </section>
      )}
      {fix && <FixPanel runId={run.id} draftId={run.ref_id} draft={fix.draft} pages={fix.pages} error={fix.error} />}
    </div>
  );
}
