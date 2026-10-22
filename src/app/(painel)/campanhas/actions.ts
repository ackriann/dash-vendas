"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { duplicateObject, setDailyBudget, setObjectStatus, type Level } from "@/lib/meta";
import { authForAccount } from "@/lib/profiles";
import { parseMoneyInput } from "@/lib/money";

function back(url: string, key: "ok" | "erro", msg: string): never {
  const u = new URL(url.startsWith("/") ? url : "/campanhas", "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("erro");
  u.searchParams.set(key, msg);
  redirect(`${u.pathname}?${u.searchParams}`);
}

export async function toggleStatus(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const next = String(formData.get("next")) === "ACTIVE" ? "ACTIVE" : "PAUSED";
  const url = String(formData.get("back") ?? "/campanhas");
  try {
    await setObjectStatus(await authForAccount(String(formData.get("account"))), id, next);
  } catch (e: any) {
    back(url, "erro", e?.message ?? "Falha ao alterar status");
  }
  back(url, "ok", next === "ACTIVE" ? "Ativado." : "Pausado.");
}

export async function updateBudget(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const amount = parseMoneyInput(formData.get("budget"));
  const url = String(formData.get("back") ?? "/campanhas");
  if (!(amount > 0)) back(url, "erro", "Informe um orçamento válido.");
  try {
    await setDailyBudget(await authForAccount(String(formData.get("account"))), id, amount);
  } catch (e: any) {
    back(url, "erro", e?.message ?? "Falha ao alterar orçamento");
  }
  back(url, "ok", "Orçamento atualizado.");
}

export async function duplicate(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const level = String(formData.get("level")) as Level;
  const url = String(formData.get("back") ?? "/campanhas");
  if (!["campaign", "adset", "ad"].includes(level)) back(url, "erro", "Nível inválido.");
  try {
    await duplicateObject(await authForAccount(String(formData.get("account"))), id, level);
  } catch (e: any) {
    back(url, "erro", e?.message ?? "Falha ao duplicar");
  }
  back(url, "ok", "Cópia criada (pausada). Mostre os itens sem gasto para vê-la.");
}
