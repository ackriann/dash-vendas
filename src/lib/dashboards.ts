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
  /** ids (uuid) da tabela pixels; vazio = todos os pixels da conta */
  pixel_ids: string[];
  /** código público do pixel deste dash (vai no site) */
  pixel_code: string;
  position: number;
}

const DASH_COLS = "id,name,products,ad_account_ids,pixel_ids,pixel_code,position";

export async function listDashboards(): Promise<Dashboard[]> {
  const { data, error } = await db().from("dashboards").select(DASH_COLS).order("position").order("created_at");
  if (error) return [];
  return (data ?? []) as Dashboard[];
}

/** Dash escolhido no seletor (cookie). null = "Todos". */
export async function getActiveDashboard(): Promise<Dashboard | null> {
  const id = (await cookies()).get(DASH_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("dashboards").select(DASH_COLS).eq("id", id).maybeSingle();
  return (data as Dashboard) ?? null;
}

// ------------------------------------------------------------ Código do pixel

/** Pixels de um dash (null = conta inteira). Dash sem pixel marcado usa todos. */
export function pixelsOfDash<T extends { id: string }>(all: T[], dash: Pick<Dashboard, "pixel_ids"> | null): T[] {
  if (!dash?.pixel_ids.length) return all;
  return all.filter((p) => dash.pixel_ids.includes(p.id));
}

/**
 * Pixels que recebem o Purchase de uma venda: os dos dashes do produto vendido.
 * Sem dash para o produto, vai para o pixel padrão (como antes dos dashes).
 */
export function pixelsForProduct<T extends { id: string; is_default: boolean }>(all: T[], dashes: Dashboard[], product: string | null): T[] {
  const matching = dashes.filter((d) => !d.products.length || (product != null && d.products.includes(product)));
  if (!matching.length) {
    const def = all.find((p) => p.is_default) ?? all[0];
    return def ? [def] : [];
  }
  const ids = new Set<string>();
  for (const d of matching) for (const p of pixelsOfDash(all, d)) ids.add(p.id);
  return all.filter((p) => ids.has(p.id));
}
