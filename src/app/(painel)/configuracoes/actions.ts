"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { setSetting } from "@/lib/db";
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
