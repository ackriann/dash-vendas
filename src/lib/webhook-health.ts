import "server-only";
import { db } from "./db";

// Status real de um webhook, pelo que chegou de verdade (events_log),
// e não só porque a senha foi salva no painel.

export type HealthState = "off" | "waiting" | "ok" | "error";

export interface Health {
  state: HealthState;
  lastOk: { at: string; kind: string | null } | null;
  lastError: { at: string; message: string | null } | null;
}

export async function webhookHealth(filter: { source?: string; kind?: string }, configured: boolean): Promise<Health> {
  if (!configured) return { state: "off", lastOk: null, lastError: null };
  const q = (ok: boolean) => {
    let b = db().from("events_log").select("created_at,kind,message").eq("ok", ok);
    if (filter.source) b = b.eq("source", filter.source);
    if (filter.kind) b = b.eq("kind", filter.kind);
    return b.order("created_at", { ascending: false }).limit(1).maybeSingle();
  };
  const [okRow, errRow] = await Promise.all([q(true), q(false)]);
  const lastOk = okRow.data ? { at: okRow.data.created_at as string, kind: okRow.data.kind as string | null } : null;
  const lastError = errRow.data ? { at: errRow.data.created_at as string, message: errRow.data.message as string | null } : null;
  const state: HealthState =
    lastError && (!lastOk || lastError.at > lastOk.at) ? "error" : lastOk ? "ok" : "waiting";
  return { state, lastOk, lastError };
}

export const HEALTH_PILL: Record<HealthState, { cls: string; label: string }> = {
  off: { cls: "", label: "Falta conectar" },
  waiting: { cls: "pill-pending", label: "Aguardando 1º aviso" },
  ok: { cls: "pill-approved", label: "Recebendo" },
  error: { cls: "pill-refunded", label: "Com erro" },
};
