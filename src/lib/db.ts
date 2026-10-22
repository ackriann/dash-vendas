import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Cliente com service role. Use apenas no servidor. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
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
