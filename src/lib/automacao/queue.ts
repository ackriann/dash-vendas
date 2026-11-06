import "server-only";
import { after } from "next/server";
import { currentWorkspaceId, db, logEvent, rawDb, runAsWorkspace } from "../db";
import type { JobStatus, RunStatus, RunView } from "./types";
import { isTransient } from "./meta-ads";

// =====================================================================
// Fila persistente (tabelas ops_runs / ops_jobs no Postgres).
// - Cada processo (run) tem operações em ordem (seq): uma só começa quando as
//   anteriores terminaram.
// - ops_claim_job (SQL) pega a próxima com FOR UPDATE SKIP LOCKED e uma trava
//   com prazo: duas abas, o cron e o after() nunca executam a mesma operação.
// - O resultado de cada operação (ex.: id da campanha) fica gravado; tentar de
//   novo continua de onde parou, sem recriar o que já existe.
// Quem processa: after() logo depois de enfileirar, a tela de processamento
// (a cada consulta) e o agendador (/api/cron/rules).
// =====================================================================

export interface JobRow {
  id: string;
  run_id: string;
  seq: number;
  key: string;
  kind: string;
  label: string;
  status: JobStatus;
  input: Record<string, any>;
  result: Record<string, any> | null;
  meta_id: string | null;
  message: string | null;
  error: string | null;
  attempts: number;
  polls: number;
  started_at: string | null;
}

export interface RunRow {
  id: string;
  kind: string;
  title: string;
  idem_key: string;
  status: RunStatus;
  ref_id: string | null;
  summary: Record<string, any>;
  created_at: string;
}

export interface JobSpec {
  key: string;
  kind: string;
  label: string;
  input?: Record<string, unknown>;
}

/** Resultado de uma operação: concluída, ou aguardando a Meta (volta depois). */
export type Outcome =
  | { status: "done"; result?: Record<string, unknown>; metaId?: string | null; message?: string }
  | { status: "waiting_sync"; delayMs: number; result?: Record<string, unknown>; metaId?: string | null; message?: string; maxPolls?: number }
  | { status: "skipped"; message?: string };

export interface ExecCtx {
  run: RunRow;
  job: JobRow;
  /** resultados das operações já concluídas do mesmo processo, por key */
  done: Record<string, Record<string, any>>;
  jobs: JobRow[];
}

export type Executor = (ctx: ExecCtx) => Promise<Outcome>;

const executors = new Map<string, Executor>();
export function registerExecutor(kind: string, fn: Executor) {
  executors.set(kind, fn);
}

const MAX_TRANSIENT_ATTEMPTS = 5;
const DEFAULT_MAX_POLLS = 60;

/**
 * Cria o processo. Se já existe um com a mesma chave (página recarregada,
 * clique duplo, conexão caiu), devolve o existente em vez de duplicar.
 */
export async function createRun(p: {
  kind: string;
  title: string;
  idemKey: string;
  refId?: string | null;
  summary?: Record<string, unknown>;
  jobs: JobSpec[];
}): Promise<{ id: string; existed: boolean }> {
  const existing = await findRunByKey(p.idemKey);
  if (existing) return { id: existing.id, existed: true };

  const { data: run, error } = await db()
    .from("ops_runs")
    .insert({ kind: p.kind, title: p.title, idem_key: p.idemKey, ref_id: p.refId ?? null, summary: p.summary ?? {}, status: "queued" })
    .select("id")
    .single();
  if (error) {
    // Corrida entre dois pedidos iguais: o índice único segura, fica o primeiro
    if (error.code === "23505") {
      const again = await findRunByKey(p.idemKey);
      if (again) return { id: again.id, existed: true };
    }
    throw new Error(error.message);
  }
  if (p.jobs.length) {
    const rows = p.jobs.map((j, i) => ({ run_id: run.id, seq: i + 1, key: j.key, kind: j.kind, label: j.label, input: j.input ?? {} }));
    const { error: e2 } = await db().from("ops_jobs").insert(rows);
    if (e2) {
      await db().from("ops_runs").delete().eq("id", run.id);
      throw new Error(e2.message);
    }
  }
  return { id: run.id, existed: false };
}

async function findRunByKey(idemKey: string): Promise<RunRow | null> {
  const { data } = await db().from("ops_runs").select("*").eq("idem_key", idemKey).maybeSingle();
  return (data as RunRow) ?? null;
}

/** Começa a processar logo depois da resposta (sem esperar a tela de progresso). */
export async function kick(runId?: string) {
  const ws = await currentWorkspaceId();
  try {
    after(() => runAsWorkspace(ws, () => tick({ runId, budgetMs: 45_000 }).then(() => undefined)));
  } catch {
    /* fora de uma requisição: a tela de progresso e o agendador processam */
  }
}

/** Processa operações prontas até acabar o tempo. Devolve quantas executou. */
export async function tick(opts: { runId?: string; budgetMs?: number } = {}): Promise<number> {
  const ws = await currentWorkspaceId();
  const until = Date.now() + (opts.budgetMs ?? 8_000);
  let n = 0;
  while (Date.now() < until) {
    const { data, error } = await rawDb().rpc("ops_claim_job", { p_workspace: ws, p_run: opts.runId ?? null, p_lock_seconds: 120 });
    if (error) {
      if (/ops_claim_job/.test(error.message)) throw new Error("Rode a migração 005_automacao.sql no Supabase para ativar a fila.");
      throw new Error(error.message);
    }
    const job = (Array.isArray(data) ? data[0] : data) as JobRow | undefined;
    if (!job) break;
    await execute(job);
    n++;
  }
  return n;
}

async function execute(job: JobRow) {
  const { data: run } = await db().from("ops_runs").select("*").eq("id", job.run_id).single();
  const { data: all } = await db().from("ops_jobs").select("*").eq("run_id", job.run_id).order("seq");
  const jobs = (all ?? []) as JobRow[];
  const done: ExecCtx["done"] = {};
  for (const j of jobs) if (j.status === "done" && j.result) done[j.key] = j.result;
  if ((run as RunRow).status === "queued") await setRun(job.run_id, { status: "running" });

  const now = new Date().toISOString();
  const fn = executors.get(job.kind);
  try {
    if (!fn) throw new Error(`Operação desconhecida: ${job.kind}`);
    const out = await fn({ run: run as RunRow, job, done, jobs });
    if (out.status === "waiting_sync") {
      const polls = job.polls + 1;
      if (polls > (out.maxPolls ?? DEFAULT_MAX_POLLS)) throw new Error("A Meta demorou demais para concluir. Tente de novo em alguns minutos.");
      await setJob(job.id, {
        status: "waiting_sync",
        polls,
        result: out.result ?? job.result,
        meta_id: out.metaId ?? job.meta_id,
        message: out.message ?? null,
        error: null,
        run_after: new Date(Date.now() + out.delayMs).toISOString(),
        locked_until: null,
      });
    } else {
      await setJob(job.id, {
        status: out.status,
        result: out.status === "done" ? out.result ?? {} : job.result,
        meta_id: out.status === "done" ? out.metaId ?? job.meta_id : job.meta_id,
        message: out.message ?? null,
        error: null,
        finished_at: now,
        locked_until: null,
      });
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "erro");
    if (isTransient(e) && job.attempts < MAX_TRANSIENT_ATTEMPTS) {
      await setJob(job.id, {
        status: "pending",
        error: msg,
        message: `Instabilidade/limite da Meta — nova tentativa em ${15 * job.attempts}s`,
        run_after: new Date(Date.now() + 15_000 * job.attempts).toISOString(),
        locked_until: null,
      });
    } else {
      await setJob(job.id, { status: "failed", error: msg, message: null, finished_at: now, locked_until: null });
      await logEvent("automacao", job.kind, false, `${(run as RunRow).title} · ${job.label}: ${msg}`);
    }
  }
  await rollUp(job.run_id);
}

async function setJob(id: string, patch: Record<string, unknown>) {
  await db().from("ops_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

async function setRun(id: string, patch: Record<string, unknown>) {
  await db().from("ops_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

const finishHooks = new Map<string, (run: RunRow, jobs: JobRow[]) => Promise<void>>();
/** Chamado quando um processo daquele tipo termina (concluído ou com falha). */
export function onRunFinished(kind: string, fn: (run: RunRow, jobs: JobRow[]) => Promise<void>) {
  finishHooks.set(kind, fn);
}

/** Atualiza o status do processo a partir das operações. */
async function rollUp(runId: string) {
  const { data: run } = await db().from("ops_runs").select("*").eq("id", runId).single();
  const { data } = await db().from("ops_jobs").select("*").eq("run_id", runId).order("seq");
  const jobs = (data ?? []) as JobRow[];
  if (!run || run.status === "canceled") return;
  let status: RunStatus = "running";
  if (jobs.some((j) => j.status === "failed")) status = "failed";
  else if (jobs.every((j) => j.status === "done" || j.status === "skipped")) status = "done";
  if (status === run.status) return;
  const finished = status === "done" || status === "failed";
  await setRun(runId, { status, finished_at: finished ? new Date().toISOString() : null });
  if (finished) {
    try {
      await finishHooks.get(run.kind)?.({ ...(run as RunRow), status }, jobs);
    } catch (e: any) {
      await logEvent("automacao", "finalizar", false, e?.message);
    }
  }
}

/** Tenta de novo as operações que falharam (o que já foi feito na Meta é mantido). */
export async function retryRun(runId: string) {
  const { data: run } = await db().from("ops_runs").select("status").eq("id", runId).single();
  if (!run) throw new Error("Processo não encontrado.");
  if (run.status !== "failed" && run.status !== "canceled") return;
  await db()
    .from("ops_jobs")
    // attempts = 1: a próxima tentativa conta como repetição, então antes de criar
    // a operação confere se a anterior já tinha criado na Meta (evita duplicar)
    .update({ status: "pending", error: null, message: "Na fila de novo", attempts: 1, polls: 0, run_after: new Date().toISOString(), locked_until: null, finished_at: null })
    .eq("run_id", runId)
    .in("status", ["failed", "pending", "running", "waiting_sync"]);
  await setRun(runId, { status: "running", finished_at: null });
  await kick(runId);
}

export async function cancelRun(runId: string) {
  await db().from("ops_jobs").update({ status: "skipped", message: "Cancelada", locked_until: null }).eq("run_id", runId).in("status", ["pending", "waiting_sync"]);
  await setRun(runId, { status: "canceled", finished_at: new Date().toISOString() });
}

export async function getRunView(runId: string): Promise<RunView | null> {
  const { data: run } = await db().from("ops_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return null;
  const { data: jobs } = await db()
    .from("ops_jobs")
    .select("id,seq,key,kind,label,status,meta_id,message,error,attempts,updated_at")
    .eq("run_id", runId)
    .order("seq");
  const { idem_key: _k, updated_at: _u, workspace_id: _w, ...rest } = run as any;
  return { ...rest, jobs: jobs ?? [] } as RunView;
}

export async function listRuns(limit = 50, kind?: string) {
  let q = db().from("ops_runs").select("id,kind,title,status,ref_id,created_at,finished_at,summary").order("created_at", { ascending: false }).limit(limit);
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  return (data ?? []) as Omit<RunView, "jobs">[];
}

/** Contagem por status das operações de vários processos (para as listas). */
export async function jobCounts(runIds: string[]) {
  const out: Record<string, { total: number; done: number; failed: number; waiting: number }> = {};
  if (!runIds.length) return out;
  const { data } = await db().from("ops_jobs").select("run_id,status").in("run_id", runIds);
  for (const j of data ?? []) {
    const c = (out[j.run_id] ??= { total: 0, done: 0, failed: 0, waiting: 0 });
    c.total++;
    if (j.status === "done" || j.status === "skipped") c.done++;
    if (j.status === "failed") c.failed++;
    if (j.status === "waiting_sync") c.waiting++;
  }
  return out;
}
