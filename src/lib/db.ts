import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Cliente com service role, SEM filtro de conta. Use só para a tabela de contas (login/cadastro). */
export function rawDb(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// ---------------------------------------------------------------- Conta atual

const workspaceStore = new AsyncLocalStorage<string>();

/** Roda `fn` como a conta informada (webhooks, rastreamento e cron, que não têm login). */
export function runAsWorkspace<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceStore.run(workspaceId, fn);
}

/** Conta de quem está acessando: a de runAsWorkspace ou a do login. */
export async function currentWorkspaceId(): Promise<string> {
  const forced = workspaceStore.getStore();
  if (forced) return forced;
  let id: string | null = null;
  try {
    id = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, env.sessionSecret);
  } catch {
    /* fora de uma requisição */
  }
  if (!id) throw new Error("Sessão expirada: entre de novo.");
  return id;
}

// ------------------------------------------------- Cliente filtrado pela conta

/** Tabelas que pertencem a uma conta: toda consulta nelas é filtrada por workspace_id. */
const SCOPED = new Set([
  "settings", "clicks", "sales", "fees", "pixels", "push_subscriptions", "events_log",
  "meta_profiles", "ad_accounts", "automation_rules", "dashboards",
]);

const withWorkspace = (row: unknown, ws: string) =>
  Array.isArray(row) ? row.map((r) => ({ ...r, workspace_id: ws })) : { ...(row as object), workspace_id: ws };

/**
 * Grava a cadeia de chamadas (.select().eq().order()...) e só monta a consulta real
 * quando ela é executada (await), já com a conta atual:
 *   select/update/delete → + .eq("workspace_id", conta)
 *   insert/upsert        → workspace_id preenchido em cada linha
 */
function scopedFrom(table: string) {
  const calls: [string, unknown[]][] = [];
  const run = async () => {
    const ws = await currentWorkspaceId();
    let q: any = rawDb().from(table);
    calls.forEach(([method, args], i) => {
      if (i === 0) {
        if (method === "insert" || method === "upsert") {
          q = q[method](withWorkspace(args[0], ws), ...args.slice(1));
          return;
        }
        if (method === "update") {
          q = q.update(withWorkspace(args[0], ws), ...args.slice(1)).eq("workspace_id", ws);
          return;
        }
        q = q[method](...args);
        if (method === "select" || method === "delete") q = q.eq("workspace_id", ws);
        return;
      }
      q = q[method](...args);
    });
    return await q;
  };
  const builder: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") return (ok: any, fail: any) => run().then(ok, fail);
        if (prop === "catch") return (fail: any) => run().catch(fail);
        if (prop === "finally") return (fn: any) => run().finally(fn);
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

let scoped: SupabaseClient | null = null;

/** Cliente com service role, filtrado pela conta atual. Use apenas no servidor. */
export function db(): SupabaseClient {
  if (!scoped) {
    scoped = new Proxy(rawDb(), {
      get(target, prop, recv) {
        if (prop === "from") return (table: string) => (SCOPED.has(table) ? scopedFrom(table) : target.from(table));
        return Reflect.get(target, prop, recv);
      },
    });
  }
  return scoped;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return data.value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { error } = await db()
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function logEvent(
  source: string,
  kind: string,
  ok: boolean,
  message: string | null,
  payload?: unknown,
): Promise<void> {
  try {
    await db().from("events_log").insert({ source, kind, ok, message, payload: payload ?? null });
  } catch {
    /* log nunca deve derrubar a requisição */
  }
}
