import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";
import { DASH_COOKIE } from "./session";

// =====================================================================
// Dashes: visões de uma conta filtradas por produto e por conta de anúncio.
// Lista vazia = sem filtro (todos os produtos / todas as contas de anúncio).
// =====================================================================

export interface Dashboard {
  id: string;
  name: string;
  products: string[];
  ad_account_ids: string[];
  position: number;
}

export async function listDashboards(): Promise<Dashboard[]> {
  const { data, error } = await db().from("dashboards").select("id,name,products,ad_account_ids,position").order("position").order("created_at");
  if (error) return [];
  return (data ?? []) as Dashboard[];
}

/** Dash escolhido no seletor (cookie). null = "Todos". */
export async function getActiveDashboard(): Promise<Dashboard | null> {
  const id = (await cookies()).get(DASH_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("dashboards").select("id,name,products,ad_account_ids,position").eq("id", id).maybeSingle();
  return (data as Dashboard) ?? null;
}
