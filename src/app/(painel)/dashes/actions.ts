"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { DASH_COOKIE, requireAuth } from "@/lib/session";

function go(key: "ok" | "erro", msg: string): never {
  redirect(`/dashes?${key}=${encodeURIComponent(msg)}`);
}

function readForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const products = [...new Set(formData.getAll("product").map((p) => String(p).trim()).filter(Boolean))];
  const ad_account_ids = [...new Set(formData.getAll("ad_account").map(String).filter((a) => /^act_\d+$/.test(a)))];
  const pixel_ids = [...new Set(formData.getAll("pixel").map(String).filter((p) => /^[0-9a-f-]{36}$/i.test(p)))];
  return { name, products, ad_account_ids, pixel_ids };
}

export async function createDashboard(formData: FormData) {
  await requireAuth();
  const d = readForm(formData);
  if (!d.name) go("erro", "Dê um nome para o dash.");
  const { count } = await db().from("dashboards").select("id", { count: "exact", head: true });
  const { data, error } = await db().from("dashboards").insert({ ...d, position: count ?? 0 }).select("id").single();
  if (error) go("erro", error.message);
  // Já abre o dash novo
  (await cookies()).set(DASH_COOKIE, data.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  go("ok", `Dash "${d.name}" criado. Ele já está selecionado no Resumo, Vendas e Campanhas.`);
}

export async function updateDashboard(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const d = readForm(formData);
  if (!d.name) go("erro", "Dê um nome para o dash.");
  const { error } = await db().from("dashboards").update(d).eq("id", id);
  if (error) go("erro", error.message);
  go("ok", `Dash "${d.name}" salvo.`);
}

export async function deleteDashboard(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  await db().from("dashboards").delete().eq("id", id);
  const store = await cookies();
  if (store.get(DASH_COOKIE)?.value === id) store.delete(DASH_COOKIE);
  go("ok", "Dash removido. As vendas continuam no painel.");
}
