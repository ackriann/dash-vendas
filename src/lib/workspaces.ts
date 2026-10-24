import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { currentWorkspaceId, rawDb } from "./db";
import { env } from "./env";
import { safeEqual } from "./auth";

// =====================================================================
// Contas (login por e-mail). Cada conta é um painel separado: perfis Meta,
// checkouts, pixels, vendas, taxas, regras e notificações próprios.
// A conta principal (is_owner) é a que já existia antes das contas.
// =====================================================================

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface Workspace {
  id: string;
  email: string | null;
  name: string | null;
  is_owner: boolean;
  created_at: string;
}

const COLS = "id,email,name,is_owner,created_at";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(got, expected);
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Cache curto: webhooks e rastreamento consultam a conta a cada requisição
const cache = new Map<string, { ws: Workspace | null; at: number }>();
const TTL = 60_000;

/** Limpa o cache depois de mudar a conta (nome, e-mail). */
export function forgetWorkspace(id: string): void {
  cache.delete(id);
  if (ownerCache?.ws.id === id) ownerCache = null;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.ws;
  const { data } = await rawDb().from("workspaces").select(COLS).eq("id", id).maybeSingle();
  cache.set(id, { ws: (data as Workspace) ?? null, at: Date.now() });
  return (data as Workspace) ?? null;
}

let ownerCache: { ws: Workspace; at: number } | null = null;

export async function ownerWorkspace(): Promise<Workspace> {
  if (ownerCache && Date.now() - ownerCache.at < TTL) return ownerCache.ws;
  const { data, error } = await rawDb().from("workspaces").select(COLS).eq("is_owner", true).order("created_at").limit(1).maybeSingle();
  if (error || !data) throw new Error("Conta principal não encontrada: rode a migração 003 no Supabase.");
  ownerCache = { ws: data as Workspace, at: Date.now() };
  return data as Workspace;
}

export async function currentWorkspace(): Promise<Workspace> {
  const ws = await getWorkspace(await currentWorkspaceId());
  if (!ws) throw new Error("Conta não encontrada: entre de novo.");
  return ws;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data } = await rawDb().from("workspaces").select(COLS).order("created_at");
  return (data ?? []) as Workspace[];
}

/**
 * Conta de uma URL pública (webhooks, t.js, cron): parâmetro ?a=<id>.
 * Sem o parâmetro vale a conta principal, para as URLs antigas continuarem funcionando.
 */
export async function workspaceFromUrl(url: string | URL): Promise<string | null> {
  const a = new URL(url).searchParams.get("a");
  if (!a) return (await ownerWorkspace()).id;
  return (await getWorkspace(a))?.id ?? null;
}

/** Acrescenta ?a=<conta> nas URLs públicas das contas que não são a principal. */
export function withWorkspace(url: string, ws: Pick<Workspace, "id" | "is_owner">): string {
  if (ws.is_owner) return url;
  return `${url}${url.includes("?") ? "&" : "?"}a=${ws.id}`;
}

// ---------------------------------------------------------------- Login

/**
 * Confere e-mail + senha e devolve o id da conta.
 * Primeiro acesso depois da atualização: a conta principal ainda não tem e-mail;
 * quem entrar com a senha antiga (ADMIN_PASSWORD) grava o e-mail e a senha nela.
 */
export async function login(emailRaw: string, password: string): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  if (!email || !password) return null;
  const { data } = await rawDb().from("workspaces").select("id,password_hash").eq("email", email).maybeSingle();
  if (data?.password_hash) return (await checkPassword(password, data.password_hash)) ? data.id : null;

  const owner = await ownerWorkspace();
  if (!data && !owner.email && validEmail(email) && env.adminPasswordOptional && safeEqual(password, env.adminPasswordOptional)) {
    const { error } = await rawDb()
      .from("workspaces")
      .update({ email, password_hash: await hashPassword(password) })
      .eq("id", owner.id)
      .is("email", null);
    if (error) return null;
    ownerCache = null;
    cache.delete(owner.id);
    return owner.id;
  }
  return null;
}

export async function changePassword(workspaceId: string, current: string, next: string): Promise<string | null> {
  const { data } = await rawDb().from("workspaces").select("password_hash").eq("id", workspaceId).maybeSingle();
  if (!data?.password_hash || !(await checkPassword(current, data.password_hash))) return "Senha atual incorreta.";
  if (next.length < 8) return "A nova senha precisa ter pelo menos 8 caracteres.";
  const { error } = await rawDb().from("workspaces").update({ password_hash: await hashPassword(next) }).eq("id", workspaceId);
  return error ? error.message : null;
}

// ---------------------------------------------------------------- Cadastro

const DEFAULT_SETTINGS: Record<string, unknown> = {
  base_currency: "BRL",
  fx_rates: { BRL: 1, USD: 5.4, EUR: 5.9, GBP: 6.9 },
  notify: { approved: true, pending: false, refund: true },
  auto_capi: false,
};

export async function createWorkspace(input: { email: string; name: string; password: string }): Promise<{ id?: string; error?: string }> {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) return { error: "E-mail inválido." };
  if (input.password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  const { data, error } = await rawDb()
    .from("workspaces")
    .insert({ email, name: input.name.trim() || email, password_hash: await hashPassword(input.password) })
    .select("id")
    .single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "Já existe uma conta com esse e-mail." : error.message };
  const now = new Date().toISOString();
  await rawDb()
    .from("settings")
    .insert(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ workspace_id: data.id, key, value, updated_at: now })));
  return { id: data.id };
}

// Código de convite: fica nos ajustes da conta principal
export async function getInviteCode(): Promise<string> {
  const owner = await ownerWorkspace();
  const { data } = await rawDb().from("settings").select("value").eq("workspace_id", owner.id).eq("key", "invite_code").maybeSingle();
  return typeof data?.value === "string" ? data.value : "";
}

export async function setInviteCode(code: string): Promise<void> {
  const owner = await ownerWorkspace();
  if (!code) {
    await rawDb().from("settings").delete().eq("workspace_id", owner.id).eq("key", "invite_code");
    return;
  }
  const { error } = await rawDb()
    .from("settings")
    .upsert({ workspace_id: owner.id, key: "invite_code", value: code, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function checkInviteCode(code: string): Promise<boolean> {
  const saved = await getInviteCode();
  return !!saved && !!code && safeEqual(code.trim(), saved);
}

/** URL pública do painel para a conta atual (webhooks, t.js, cron): leva ?a=<conta> fora da principal. */
export async function publicUrl(path: string): Promise<string> {
  return withWorkspace(`${env.appUrl}${path}`, await currentWorkspace());
}
