"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { getPixels, sendPurchase, type SaleRow } from "@/lib/capi";
import { ingestSale, mapStatus } from "@/lib/sales";
import { parseMoneyInput } from "@/lib/money";
import { idFromUtm } from "@/lib/utm";
import { env } from "@/lib/env";
import { startOfDayUtc } from "@/lib/dates";

function go(path: string, key: "ok" | "erro", msg: string): never {
  const u = new URL(path.startsWith("/") ? path : "/vendas", "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("erro");
  u.searchParams.set(key, msg);
  redirect(`${u.pathname}?${u.searchParams}`);
}

/** Botão "Disparar no pixel": envia a venda pela API de Conversões. */
export async function dispatchToPixel(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const pixelId = String(formData.get("pixel") ?? "");
  const back = String(formData.get("back") ?? "/vendas");
  const { data: sale } = await db().from("sales").select("*").eq("id", id).maybeSingle();
  if (!sale) go(back, "erro", "Venda não encontrada.");
  const pixels = await getPixels();
  const pixel = pixels.find((p) => p.id === pixelId) ?? pixels.find((p) => p.is_default) ?? pixels[0];
  if (!pixel) go(back, "erro", "Cadastre um pixel em Integrações antes de disparar.");
  const r = await sendPurchase(sale as SaleRow, pixel);
  revalidatePath("/vendas");
  go(back, r.ok ? "ok" : "erro", r.ok ? `Venda disparada no pixel ${pixel.name}.` : r.message);
}

/** Cria uma venda manualmente (e opcionalmente já dispara no pixel). */
export async function createManualSale(formData: FormData) {
  await requireAuth();
  const amount = parseMoneyInput(formData.get("amount"));
  if (!(amount > 0)) go("/vendas", "erro", "Informe o valor da venda.");

  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "") || "12:00";
  let createdAt = new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [h, m] = time.split(":").map(Number);
    createdAt = new Date(startOfDayUtc(date, env.timezone).getTime() + ((h || 0) * 60 + (m || 0)) * 60000).toISOString();
  }

  const utmCampaign = String(formData.get("utm_campaign") ?? "").trim() || null;
  const utmMedium = String(formData.get("utm_medium") ?? "").trim() || null;
  const utmContent = String(formData.get("utm_content") ?? "").trim() || null;
  const campaignId = String(formData.get("campaign_id") ?? "").trim() || idFromUtm(utmCampaign);

  const externalId = String(formData.get("external_id") ?? "").trim() || `manual-${Date.now()}`;
  const { id } = await ingestSale({
    platform: "manual",
    external_id: externalId,
    status: mapStatus(String(formData.get("status") ?? "approved")),
    created_at: createdAt,
    approved_at: createdAt,
    product_name: String(formData.get("product") ?? "").trim() || null,
    customer_name: String(formData.get("name") ?? "").trim() || null,
    customer_email: String(formData.get("email") ?? "").trim() || null,
    customer_phone: String(formData.get("phone") ?? "").trim() || null,
    customer_country: String(formData.get("country") ?? "").trim().toUpperCase() || null,
    currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
    gross_amount: amount,
    utm_source: utmCampaign ? "FB" : null,
    utm_campaign: utmCampaign,
    utm_medium: utmMedium,
    utm_content: utmContent,
    campaign_id: campaignId,
    raw: { manual: true },
  });

  if (formData.get("send_pixel") === "on") {
    const { data: sale } = await db().from("sales").select("*").eq("id", id).single();
    const pixels = await getPixels();
    const pixel = pixels.find((p) => p.id === String(formData.get("pixel"))) ?? pixels.find((p) => p.is_default) ?? pixels[0];
    if (!pixel) go(`/vendas?id=${id}`, "erro", "Venda criada, mas não há pixel cadastrado para disparar.");
    const r = await sendPurchase(sale as SaleRow, pixel);
    go(`/vendas?id=${id}`, r.ok ? "ok" : "erro", r.ok ? "Venda criada e disparada no pixel." : `Venda criada. Pixel: ${r.message}`);
  }
  go(`/vendas?id=${id}`, "ok", "Venda criada.");
}

export async function setSaleStatus(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  const { data: sale } = await db().from("sales").select("*").eq("id", id).maybeSingle();
  if (!sale) go("/vendas", "erro", "Venda não encontrada.");
  // Mudança manual: grava direto (sem a proteção contra rebaixar status)
  const status = mapStatus(String(formData.get("status")));
  await db()
    .from("sales")
    .update({ status, updated_at: new Date().toISOString(), approved_at: status === "approved" ? sale.approved_at ?? new Date().toISOString() : sale.approved_at })
    .eq("id", id);
  go(`/vendas?id=${id}`, "ok", "Status atualizado.");
}

export async function deleteSale(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id"));
  await db().from("sales").delete().eq("id", id);
  go("/vendas", "ok", "Venda excluída.");
}
