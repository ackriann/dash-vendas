"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { duplicateObject, graph, setDailyBudget, setObjectStatus, type Level, type MetaAuth } from "@/lib/meta";
import { authForAccount } from "@/lib/profiles";
import { parseMoneyInput } from "@/lib/money";

function back(url: string, key: "ok" | "erro", msg: string): never {
  // Links de retorno só podem permanecer em telas do próprio painel.
  const u = new URL(url.startsWith("/") && !url.startsWith("//") ? url : "/campanhas", "http://x");
  if (!["/campanhas", "/"].includes(u.pathname)) {
    u.pathname = "/campanhas";
    u.search = "";
  }
  u.searchParams.delete("ok");
  u.searchParams.delete("erro");
  u.searchParams.set(key, msg);
  redirect(`${u.pathname}?${u.searchParams}`);
}

/** Confere o vínculo Meta entre objeto e conta do workspace antes de mutar o objeto.
 * Evita que um ID informado em formulário altere campanha de outra conta.
 */
async function verifiedAuth(accountId: string, objectId: string): Promise<MetaAuth> {
  if (!/^act_\d+$/.test(accountId) || !/^\d+$/.test(objectId)) {
    throw new Error("Conta ou objeto Meta inválido.");
  }
  const auth = await authForAccount(accountId);
  const obj = await graph<{ account_id?: string }>(objectId, {
    params: { fields: "account_id" }, auth,
  });
  if (!obj.account_id ||
      String(obj.account_id).replace(/^act_/, "") !== accountId.replace(/^act_/, "")) {
    throw new Error("Esta campanha ou conjunto não pertence à conta selecionada.");
  }
  return auth;
}

export async function toggleStatus(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const next = String(formData.get("next")) === "ACTIVE" ? "ACTIVE" : "PAUSED";
  const url = String(formData.get("back") ?? "/campanhas");
  try {
    await setObjectStatus(await verifiedAuth(String(formData.get("account")), id), id, next);
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
    await setDailyBudget(await verifiedAuth(String(formData.get("account")), id), id, amount);
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
    await duplicateObject(await verifiedAuth(String(formData.get("account")), id), id, level);
  } catch (e: any) {
    back(url, "erro", e?.message ?? "Falha ao duplicar");
  }
  back(url, "ok", "Cópia criada (pausada). Mostre os itens sem gasto para vê-la.");
}
