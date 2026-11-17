"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { db, logEvent } from "@/lib/db";
import { connectProfile, getProfile, refreshProfile, syncAccounts } from "@/lib/profiles";

function go(key: "ok" | "erro", msg: string, formData?: FormData): never {
  const base = formData?.get("surface") === "integracoes" ? "/integracoes?area=perfil&" : "/perfis?";
  redirect(`${base}${key}=${encodeURIComponent(msg)}`);
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addProfile(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  let msg = "";
  try {
    const r = await connectProfile({
      name: field(formData, "name"),
      appId: field(formData, "app_id"),
      appSecret: field(formData, "app_secret"),
      token: field(formData, "token"),
    });
    msg = `Perfil ${r.profile.name} conectado · ${r.accounts} conta(s) disponíveis para seleção nas campanhas.`;
    if (r.missing.length) msg += ` Sem as permissões: ${r.missing.join(", ")} (algumas funções podem não funcionar).`;
    await logEvent("meta", "perfil", true, `Perfil ${r.profile.name} conectado (app ${r.profile.app_name})`);
  } catch (e: any) {
    await logEvent("meta", "perfil", false, e?.message);
    finish("erro", e?.message ?? "Não foi possível conectar.");
  }
  finish("ok", msg);
}

/** Troca o token (e, se informado, o app) de um perfil existente. */
export async function replaceToken(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const id = field(formData, "id");
  const p = await getProfile(id);
  if (!p) finish("erro", "Perfil não encontrado.");
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
    finish("erro", e?.message ?? "Token recusado.");
  }
  finish("ok", msg);
}

export async function checkProfile(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const p = await getProfile(field(formData, "id"));
  if (!p) finish("erro", "Perfil não encontrado.");
  const r = await refreshProfile(p);
  if (r.status !== "ok") finish("erro", `${p.name}: ${r.last_error}`);
  finish("ok", `${p.name}: token válido${r.expires_at ? " e renovado" : " (não expira)"}.`);
}

export async function syncProfile(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const p = await getProfile(field(formData, "id"));
  if (!p) finish("erro", "Perfil não encontrado.");
  let n = 0;
  try {
    n = await syncAccounts(p);
  } catch (e: any) {
    finish("erro", `${p.name}: ${e?.message ?? "erro"}`);
  }
  finish("ok", `${n} conta(s) de anúncio em ${p.name}.`);
}

export async function renameProfile(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const name = field(formData, "name");
  if (!name) finish("erro", "Dê um nome ao perfil.");
  await db().from("meta_profiles").update({ name }).eq("id", field(formData, "id"));
  finish("ok", "Nome salvo.");
}

export async function removeProfile(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  await db().from("meta_profiles").delete().eq("id", field(formData, "id"));
  finish("ok", "Perfil removido (as contas dele saíram do painel).");
}

export async function saveAccounts(formData: FormData) {
  const finish = (key: "ok" | "erro", msg: string): never => go(key, msg, formData);
  await requireAuth();
  const profileId = field(formData, "id");
  const chosen = formData.getAll("account").map(String);
  const supa = db();
  await supa.from("ad_accounts").update({ enabled: false }).eq("profile_id", profileId);
  if (chosen.length) await supa.from("ad_accounts").update({ enabled: true }).eq("profile_id", profileId).in("id", chosen);
  finish("ok", `${chosen.length} conta(s) ativa(s) neste perfil.`);
}
