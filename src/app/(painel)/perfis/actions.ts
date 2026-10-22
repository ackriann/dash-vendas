"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { db, logEvent } from "@/lib/db";
import { connectProfile, getProfile, refreshProfile, syncAccounts } from "@/lib/profiles";

function go(key: "ok" | "erro", msg: string): never {
  redirect(`/perfis?${key}=${encodeURIComponent(msg)}`);
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addProfile(formData: FormData) {
  await requireAuth();
  let msg = "";
  try {
    const r = await connectProfile({
      name: field(formData, "name"),
      appId: field(formData, "app_id"),
      appSecret: field(formData, "app_secret"),
      token: field(formData, "token"),
    });
    msg = `Perfil ${r.profile.name} conectado · ${r.accounts} conta(s) de anúncio encontrada(s). Ative as que entram no painel.`;
    if (r.missing.length) msg += ` Sem as permissões: ${r.missing.join(", ")} (algumas funções podem não funcionar).`;
    await logEvent("meta", "perfil", true, `Perfil ${r.profile.name} conectado (app ${r.profile.app_name})`);
  } catch (e: any) {
    await logEvent("meta", "perfil", false, e?.message);
    go("erro", e?.message ?? "Não foi possível conectar.");
  }
  go("ok", msg);
}

/** Troca o token (e, se informado, o app) de um perfil existente. */
export async function replaceToken(formData: FormData) {
  await requireAuth();
  const id = field(formData, "id");
  const p = await getProfile(id);
  if (!p) go("erro", "Perfil não encontrado.");
  let msg = "";
  try {
    const r = await connectProfile(
      {
        name: p.name,
        appId: field(formData, "app_id") || p.app_id,
        appSecret: field(formData, "app_secret") || p.app_secret,
        token: field(formData, "token"),
      },
      id,
    );
    msg = `Token de ${r.profile.name} atualizado.`;
  } catch (e: any) {
    go("erro", e?.message ?? "Token recusado.");
  }
  go("ok", msg);
}

export async function checkProfile(formData: FormData) {
  await requireAuth();
  const p = await getProfile(field(formData, "id"));
  if (!p) go("erro", "Perfil não encontrado.");
  const r = await refreshProfile(p);
  if (r.status !== "ok") go("erro", `${p.name}: ${r.last_error}`);
  go("ok", `${p.name}: token válido${r.expires_at ? " e renovado" : " (não expira)"}.`);
}

export async function syncProfile(formData: FormData) {
  await requireAuth();
  const p = await getProfile(field(formData, "id"));
  if (!p) go("erro", "Perfil não encontrado.");
  let n = 0;
  try {
    n = await syncAccounts(p);
  } catch (e: any) {
    go("erro", `${p.name}: ${e?.message ?? "erro"}`);
  }
  go("ok", `${n} conta(s) de anúncio em ${p.name}.`);
}

export async function renameProfile(formData: FormData) {
  await requireAuth();
  const name = field(formData, "name");
  if (!name) go("erro", "Dê um nome ao perfil.");
  await db().from("meta_profiles").update({ name }).eq("id", field(formData, "id"));
  go("ok", "Nome salvo.");
}

export async function removeProfile(formData: FormData) {
  await requireAuth();
  await db().from("meta_profiles").delete().eq("id", field(formData, "id"));
  go("ok", "Perfil removido (as contas dele saíram do painel).");
}

export async function saveAccounts(formData: FormData) {
  await requireAuth();
  const profileId = field(formData, "id");
  const chosen = formData.getAll("account").map(String);
  const supa = db();
  await supa.from("ad_accounts").update({ enabled: false }).eq("profile_id", profileId);
  if (chosen.length) await supa.from("ad_accounts").update({ enabled: true }).eq("profile_id", profileId).in("id", chosen);
  go("ok", `${chosen.length} conta(s) ativa(s) neste perfil.`);
}
