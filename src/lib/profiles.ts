import "server-only";
import { db } from "./db";
import {
  type TokenInfo,
  META_SCOPES, MetaError, checkApp, debugToken, tokenApp, exchangeForLongToken, listAdAccounts, listPages, pageToken, whoAmI,
  type FbPage, type MetaAuth,
} from "./meta";

// =====================================================================
// Perfis da Meta: cada um é um token + o app que gerou o token.
// =====================================================================

export interface MetaProfile {
  id: string;
  name: string;
  fb_user_id: string | null;
  app_id: string;
  app_name: string | null;
  app_secret: string;
  token: string;
  token_type: string | null;
  expires_at: string | null;
  scopes: string[];
  status: "ok" | "error";
  last_error: string | null;
  checked_at: string | null;
  created_at: string;
}

export interface AccountRow {
  id: string; // act_123
  profile_id: string;
  name: string;
  currency: string;
  account_status: number | null;
  timezone_name: string | null;
  enabled: boolean;
}

export const authOf = (p: Pick<MetaProfile, "token" | "app_secret">): MetaAuth => ({ token: p.token, appSecret: p.app_secret });

export async function listProfiles(): Promise<MetaProfile[]> {
  const { data, error } = await db().from("meta_profiles").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as MetaProfile[];
}

export async function getProfile(id: string): Promise<MetaProfile | null> {
  const { data } = await db().from("meta_profiles").select("*").eq("id", id).maybeSingle();
  return (data as MetaProfile) ?? null;
}

export async function listAccounts(onlyEnabled = false): Promise<AccountRow[]> {
  let q = db().from("ad_accounts").select("*").order("name");
  if (onlyEnabled) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AccountRow[];
}

/** Auth do perfil dono da conta de anúncio. */
export async function authForAccount(accountId: string): Promise<MetaAuth> {
  const { data } = await db()
    .from("ad_accounts")
    .select("meta_profiles(token,app_secret)")
    .eq("id", accountId)
    .maybeSingle();
  const p = (data as any)?.meta_profiles;
  if (!p) throw new MetaError("Conta de anúncio sem perfil conectado. Confira em Perfis Meta.");
  return authOf(p);
}

// Página → perfil (vale enquanto a função estiver quente)
const pageOwner = new Map<string, { profileId: string; at: number }>();

/** Auth da página: procura qual perfil conectado consegue gerenciar a página. */
export async function pageAuth(pageId: string): Promise<MetaAuth> {
  const profiles = await listProfiles();
  const cached = pageOwner.get(pageId);
  const ordered = cached && Date.now() - cached.at < 10 * 60000
    ? [...profiles.filter((p) => p.id === cached.profileId), ...profiles.filter((p) => p.id !== cached.profileId)]
    : profiles;
  let lastError: unknown = null;
  for (const p of ordered) {
    try {
      const auth = await pageToken(authOf(p), pageId);
      pageOwner.set(pageId, { profileId: p.id, at: Date.now() });
      return auth;
    } catch (e) {
      lastError = e;
    }
  }
  if (!profiles.length) throw new MetaError("Conecte um perfil da Meta em Perfis Meta.");
  throw lastError instanceof Error ? lastError : new MetaError("Nenhum perfil conectado gerencia esta página.");
}

export async function profileAuth(profileId: string): Promise<MetaAuth> {
  const p = await getProfile(profileId);
  if (!p) throw new MetaError("Perfil não encontrado.");
  return authOf(p);
}

export interface PageWithProfile extends FbPage {
  profile_id: string;
  profile_name: string;
}

/** Páginas de todos os perfis (sem repetir a mesma página). */
export async function listAllPages(): Promise<{ pages: PageWithProfile[]; errors: string[] }> {
  const profiles = await listProfiles();
  const seen = new Set<string>();
  const pages: PageWithProfile[] = [];
  const errors: string[] = [];
  await Promise.all(
    profiles.map(async (p) => {
      try {
        for (const pg of await listPages(authOf(p))) {
          if (seen.has(pg.id)) continue;
          seen.add(pg.id);
          pages.push({ ...pg, profile_id: p.id, profile_name: p.name });
          pageOwner.set(pg.id, { profileId: p.id, at: Date.now() });
        }
      } catch (e: any) {
        errors.push(`${p.name}: ${e?.message ?? "erro"}`);
      }
    }),
  );
  pages.sort((a, b) => a.name.localeCompare(b.name));
  return { pages, errors };
}

// ------------------------------------------------------------- Conectar / renovar

export interface ConnectInput {
  name?: string;
  /** opcionais: sem eles o painel usa o token do jeito que veio (sem trocar pelo de 60 dias) */
  appId?: string;
  appSecret?: string;
  token: string;
}

interface Validated {
  token: string;
  type: string;
  expiresAt: string | null;
  scopes: string[];
  appId: string;
  appName: string | null;
  appSecret: string;
  me: { id: string; name: string };
  missing: string[];
}

/**
 * Valida o token. O app (App ID + chave secreta) é opcional:
 * - com a chave: o token precisa ser do mesmo app, as chamadas vão com appsecret_proof
 *   e token de usuário comum é trocado pelo de 60 dias (e renovado depois);
 * - só o token: o painel descobre o app pelo próprio token e usa o token como veio.
 */
export async function validateToken(input: ConnectInput): Promise<Validated> {
  let appId = (input.appId ?? "").replace(/\D/g, "");
  const appSecret = (input.appSecret ?? "").trim();
  let token = input.token.trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new MetaError("Cole o token de acesso.");
  if (appSecret && !appId) throw new MetaError("Informe o App ID junto com a chave secreta.");

  let appName: string | null = null;
  if (appSecret) {
    try {
      appName = (await checkApp(appId, appSecret)).name;
    } catch {
      throw new MetaError("App ID ou chave secreta inválidos. Confira em developers.facebook.com → seu app → Configurações → Básico.");
    }
  }

  let info: TokenInfo;
  try {
    info = await debugToken(token, appSecret ? appId : null, appSecret || null);
  } catch (e: any) {
    throw new MetaError(`Token recusado pela Meta: ${e?.message ?? "inválido"}`);
  }
  if (!info.is_valid) throw new MetaError(`Token inválido ou expirado${info.error?.message ? `: ${info.error.message}` : "."}`);
  if (appSecret && String(info.app_id) !== appId) {
    throw new MetaError(`Esse token foi gerado por outro app (ID ${info.app_id}). Gere o token no app ${appName} ou deixe App ID e chave em branco.`);
  }
  if (info.type === "PAGE" || info.type === "APP") {
    throw new MetaError("Use um token de usuário ou de usuário do sistema, não de página/app.");
  }
  appId = String(info.app_id ?? appId);
  if (!appName) appName = (await tokenApp(token))?.name ?? null;

  // Token de usuário que vence em menos de 7 dias = curto: com a chave, troca pelo de longa duração
  if (appSecret && info.type === "USER" && info.expires_at && info.expires_at * 1000 - Date.now() < 7 * 86400000) {
    const long = await exchangeForLongToken(token, appId, appSecret);
    token = long.token;
    info = await debugToken(token, appId, appSecret);
  }

  const me = await whoAmI({ token, appSecret: appSecret || null });
  const scopes = info.scopes ?? [];
  if (!scopes.includes("ads_read") && !scopes.includes("ads_management")) {
    throw new MetaError("O token não tem a permissão ads_read (ou ads_management). Gere de novo marcando as permissões de anúncios.");
  }
  return {
    token,
    type: info.type,
    expiresAt: info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null,
    scopes,
    appId,
    appName,
    appSecret,
    me,
    missing: META_SCOPES.filter((s) => !scopes.includes(s)),
  };
}

export async function connectProfile(input: ConnectInput, existingId?: string): Promise<{ profile: MetaProfile; missing: string[]; accounts: number }> {
  const v = await validateToken(input);
  const row = {
    name: input.name?.trim() || v.me.name,
    fb_user_id: v.me.id,
    app_id: v.appId,
    app_name: v.appName,
    app_secret: v.appSecret,
    token: v.token,
    token_type: v.type,
    expires_at: v.expiresAt,
    scopes: v.scopes,
    status: "ok",
    last_error: null,
    checked_at: new Date().toISOString(),
  };

  // Mesmo usuário + mesmo app = atualiza o perfil em vez de duplicar
  let id = existingId;
  if (!id) {
    const { data } = await db().from("meta_profiles").select("id").eq("fb_user_id", v.me.id).eq("app_id", row.app_id).maybeSingle();
    id = data?.id;
  }
  const q = id ? db().from("meta_profiles").update(row).eq("id", id) : db().from("meta_profiles").insert(row);
  const { data: saved, error } = await q.select("*").single();
  if (error) throw new Error(error.message);
  const accounts = await syncAccounts(saved as MetaProfile);
  return { profile: saved as MetaProfile, missing: v.missing, accounts };
}

/** Puxa as contas de anúncio do perfil. Contas novas entram desligadas; as que sumiram saem. */
export async function syncAccounts(profile: MetaProfile): Promise<number> {
  const list = await listAdAccounts(authOf(profile));
  const { data: current } = await db().from("ad_accounts").select("id,profile_id,enabled");
  const known = new Map((current ?? []).map((a: any) => [a.id, a]));
  const rows = list.map((a) => ({
    id: a.id,
    profile_id: profile.id,
    name: a.name,
    currency: a.currency,
    account_status: a.account_status,
    timezone_name: a.timezone_name ?? null,
    enabled: known.get(a.id)?.enabled ?? false,
    updated_at: new Date().toISOString(),
  }));
  // Se outra conexão já tem essa conta, ela passa para este perfil (o token mais novo)
  if (rows.length) {
    const { error } = await db().from("ad_accounts").upsert(rows, { onConflict: "workspace_id,id" });
    if (error) throw new Error(error.message);
  }
  const ids = new Set(rows.map((r) => r.id));
  const gone = (current ?? []).filter((a: any) => a.profile_id === profile.id && !ids.has(a.id)).map((a: any) => a.id);
  if (gone.length) await db().from("ad_accounts").delete().in("id", gone);
  return rows.length;
}

/** Confere o token do perfil e, se for de usuário comum, renova os 60 dias. */
export async function refreshProfile(profile: MetaProfile): Promise<MetaProfile> {
  const patch: Partial<MetaProfile> = { checked_at: new Date().toISOString() };
  try {
    let info = await debugToken(profile.token, profile.app_id, profile.app_secret || null);
    if (!info.is_valid) throw new MetaError(info.error?.message ?? "Token expirado ou revogado.");
    // Renovar exige a chave do app; sem ela o token fica como está
    if (profile.app_secret && info.type === "USER" && info.expires_at) {
      const long = await exchangeForLongToken(profile.token, profile.app_id, profile.app_secret).catch(() => null);
      if (long?.token) {
        patch.token = long.token;
        info = await debugToken(long.token, profile.app_id, profile.app_secret);
      }
    }
    patch.expires_at = info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null;
    patch.scopes = info.scopes ?? profile.scopes;
    patch.status = "ok";
    patch.last_error = null;
  } catch (e: any) {
    patch.status = "error";
    patch.last_error = e?.message ?? "erro";
  }
  const { data } = await db().from("meta_profiles").update(patch).eq("id", profile.id).select("*").single();
  return (data as MetaProfile) ?? { ...profile, ...patch };
}

export function daysLeft(p: Pick<MetaProfile, "expires_at">): number | null {
  if (!p.expires_at) return null;
  return Math.floor((new Date(p.expires_at).getTime() - Date.now()) / 86400000);
}
