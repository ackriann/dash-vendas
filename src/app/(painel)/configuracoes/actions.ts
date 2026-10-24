"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { randomBytes } from "crypto";
import { rawDb, setSetting } from "@/lib/db";
import { changePassword, currentWorkspace, forgetWorkspace, setInviteCode } from "@/lib/workspaces";
import { parseMoneyInput } from "@/lib/money";

export async function saveNotify(formData: FormData) {
  await requireAuth();
  await setSetting("notify", {
    approved: formData.get("approved") === "on",
    pending: formData.get("pending") === "on",
    refund: formData.get("refund") === "on",
  });
  redirect("/configuracoes?ok=Preferências salvas.");
}

export async function saveCurrency(formData: FormData) {
  await requireAuth();
  const base = String(formData.get("base") ?? "BRL").toUpperCase();
  const rates: Record<string, number> = { [base]: 1 };
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("rate_")) continue;
    const cur = k.slice(5).toUpperCase();
    const n = parseMoneyInput(v);
    if (cur && n > 0 && cur !== base) rates[cur] = n;
  }
  const extra = String(formData.get("new_cur") ?? "").trim().toUpperCase();
  const extraRate = parseMoneyInput(formData.get("new_rate"));
  if (/^[A-Z]{3}$/.test(extra) && extraRate > 0) rates[extra] = extraRate;
  await setSetting("base_currency", base);
  await setSetting("fx_rates", rates);
  redirect("/configuracoes?ok=Câmbio salvo. Vale para vendas novas e para o gasto em anúncios.");
}

// ------------------------------------------------------------------ Conta

export async function saveAccountName(formData: FormData) {
  await requireAuth();
  const ws = await currentWorkspace();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  await rawDb().from("workspaces").update({ name: name || null }).eq("id", ws.id);
  forgetWorkspace(ws.id);
  redirect("/configuracoes?ok=Nome da conta salvo.");
}

export async function savePassword(formData: FormData) {
  await requireAuth();
  const ws = await currentWorkspace();
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("next2") ?? "")) redirect("/configuracoes?erro=As senhas novas não conferem.");
  const err = await changePassword(ws.id, String(formData.get("current") ?? ""), next);
  redirect(err ? `/configuracoes?erro=${encodeURIComponent(err)}` : "/configuracoes?ok=Senha trocada.");
}

/** Só a conta principal gera o código de convite da tela /cadastro. */
export async function saveInviteCode(formData: FormData) {
  await requireAuth();
  if (!(await currentWorkspace()).is_owner) redirect("/configuracoes?erro=Só a conta principal mexe no convite.");
  const clear = formData.get("clear") === "1";
  await setInviteCode(clear ? "" : randomBytes(6).toString("hex"));
  redirect(`/configuracoes?ok=${encodeURIComponent(clear ? "Cadastro fechado: ninguém consegue criar conta." : "Código de convite novo gerado.")}`);
}
