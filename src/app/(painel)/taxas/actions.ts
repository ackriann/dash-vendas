"use server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { parseMoneyInput } from "@/lib/money";

const KINDS = ["percent_sale", "fixed_sale", "percent_ads", "fixed_day"];

export async function addFee(formData: FormData) {
  await requireAuth();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind"));
  const value = parseMoneyInput(formData.get("value"));
  const platform = String(formData.get("platform") ?? "") || null;
  const product = String(formData.get("product") ?? "").trim() || null;
  if (!name || !KINDS.includes(kind) || !(value >= 0)) redirect("/taxas?erro=Preencha nome, tipo e valor.");
  const perSale = kind.endsWith("_sale");
  const { error } = await db().from("fees").insert({ name, kind, value, platform: perSale ? platform : null, product: perSale ? product : null });
  redirect(error ? `/taxas?erro=${encodeURIComponent(error.message)}` : "/taxas?ok=Taxa adicionada.");
}

export async function updateFee(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const value = parseMoneyInput(formData.get("value"));
  await db().from("fees").update({ value }).eq("id", id);
  redirect("/taxas?ok=Taxa atualizada.");
}

export async function toggleFee(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  await db().from("fees").update({ active }).eq("id", id);
  redirect("/taxas");
}

export async function deleteFee(formData: FormData) {
  await requireAuth();
  await db().from("fees").delete().eq("id", String(formData.get("id")));
  redirect("/taxas?ok=Taxa removida.");
}
