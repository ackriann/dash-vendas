import { round2 } from "./money";

export type FeeKind = "percent_sale" | "fixed_sale" | "percent_ads" | "fixed_day";

export interface Fee {
  id: string;
  name: string;
  kind: FeeKind;
  value: number;
  platform: string | null;
  product: string | null;
  active: boolean;
}

export const FEE_KIND_LABEL: Record<FeeKind, string> = {
  percent_sale: "% sobre cada venda",
  fixed_sale: "Valor fixo por venda",
  percent_ads: "% sobre gasto em anúncios",
  fixed_day: "Custo fixo por dia",
};

export interface SaleForFees {
  platform: string;
  status: string;
  gross_base: number;
  product_name?: string | null;
}

/** Taxas de uma venda aprovada (moeda base). */
export function saleFees(sale: SaleForFees, fees: Fee[]): number {
  if (sale.status !== "approved") return 0;
  let total = 0;
  for (const f of fees) {
    if (!f.active) continue;
    if (f.platform && f.platform !== sale.platform) continue;
    if (f.product && f.product !== (sale.product_name ?? "")) continue;
    if (f.kind === "percent_sale") total += (sale.gross_base * Number(f.value)) / 100;
    if (f.kind === "fixed_sale") total += Number(f.value);
  }
  return round2(total);
}

export function adsFees(spend: number, fees: Fee[]): number {
  let pct = 0;
  for (const f of fees) if (f.active && f.kind === "percent_ads") pct += Number(f.value);
  return round2((spend * pct) / 100);
}

export function dailyFixed(days: number, fees: Fee[]): number {
  let v = 0;
  for (const f of fees) if (f.active && f.kind === "fixed_day") v += Number(f.value);
  return round2(v * days);
}
