import "server-only";
import { adsFees, saleFees } from "./fees";
import { toBase } from "./money";
import { ACCOUNT_STATUS, getInsights, listObjects, type Level } from "./meta";
import { groupBy, loadSales, type Context, type SaleLite, type SelectedAccount } from "./report";
import type { DateRange } from "./dates";

// =====================================================================
// Linhas da tabela de anúncios: gasto da Meta × vendas reais do painel.
// Usado na tela de Campanhas e nas Regras automáticas.
// =====================================================================

export type AdLevel = "account" | Level;

export interface AdRow {
  id: string;
  name: string;
  level: AdLevel;
  accountId: string;
  accountName: string;
  accountCurrency: string;
  profileName: string;
  status: string | null;
  effective: string | null;
  dailyBudget: number | null;
  hasBudget: boolean;
  parentId: string | null;
  campaignId: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  lpv: number;
  ic: number;
  api: number;
  metaPurchases: number;
  metaValue: number;
  video3s: number;
  sales: number;
  revenue: number;
  pending: number;
  pendingRevenue: number;
  refunds: number;
  fees: number;
  profit: number;
}

const empty = (): Omit<AdRow, "id" | "name" | "level" | "accountId" | "accountName" | "accountCurrency" | "profileName"> => ({
  status: null, effective: null, dailyBudget: null, hasBudget: false, parentId: null, campaignId: null,
  spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, lpv: 0, ic: 0, api: 0, metaPurchases: 0, metaValue: 0, video3s: 0,
  sales: 0, revenue: 0, pending: 0, pendingRevenue: 0, refunds: 0, fees: 0, profit: 0,
});

export interface AdRowsResult {
  rows: AdRow[];
  errors: string[];
  sales: SaleLite[];
  /** campanha → conta (para filtrar vendas por conta) */
  campaignAccount: Map<string, string>;
}

/** Monta as linhas de um nível. Para "account", agrega as campanhas de cada conta. */
export async function buildAdRows(ctx: Context, accounts: SelectedAccount[], level: AdLevel, range: DateRange): Promise<AdRowsResult> {
  const apiLevel: Level = level === "account" ? "campaign" : level;
  const errors: string[] = [];
  const rows = new Map<string, AdRow>();
  const campaignAccount = new Map<string, string>();
  const conv = (v: number, cur: string) => toBase(v, cur, ctx.base, ctx.rates);

  const [salesList] = await Promise.all([
    loadSales(range),
    ...accounts.map(async (acc) => {
      const base = { accountId: acc.id, accountName: acc.name, accountCurrency: acc.currency, profileName: acc.profile_name, level: apiLevel as AdLevel };
      try {
        const [objects, insights] = await Promise.all([
          listObjects(acc.auth, acc.id, apiLevel),
          getInsights(acc.auth, acc.id, apiLevel, range.since, range.until),
        ]);
        for (const o of objects) {
          if (apiLevel === "campaign") campaignAccount.set(o.id, acc.id);
          rows.set(o.id, {
            ...empty(), ...base, id: o.id, name: o.name,
            status: o.status, effective: o.effective_status,
            dailyBudget: o.daily_budget ? Number(o.daily_budget) / 100 : null,
            hasBudget: apiLevel !== "ad" && !!o.daily_budget,
            parentId: apiLevel === "adset" ? o.campaign_id ?? null : apiLevel === "ad" ? o.adset_id ?? null : null,
            campaignId: apiLevel === "campaign" ? o.id : o.campaign_id ?? null,
          });
        }
        for (const i of insights) {
          if (apiLevel === "campaign") campaignAccount.set(i.id, acc.id);
          const r = rows.get(i.id) ?? {
            ...empty(), ...base, id: i.id, name: i.name,
            parentId: apiLevel === "adset" ? i.campaign_id ?? null : apiLevel === "ad" ? i.adset_id ?? null : null,
            campaignId: apiLevel === "campaign" ? i.id : i.campaign_id ?? null,
          };
          Object.assign(r, {
            spend: conv(i.spend, acc.currency),
            impressions: i.impressions, reach: i.reach, clicks: i.clicks, linkClicks: i.link_clicks,
            lpv: i.landing_page_views, ic: i.initiate_checkout, api: i.add_payment_info,
            metaPurchases: i.meta_purchases, metaValue: conv(i.meta_purchase_value, acc.currency), video3s: i.video_3s,
          });
          rows.set(i.id, r);
        }
      } catch (e: any) {
        errors.push(`${acc.name}: ${e?.message ?? "erro"}`);
      }
    }),
  ]);
  const sales = salesList as SaleLite[];

  const key = apiLevel === "campaign" ? "campaign_id" : apiLevel === "adset" ? "adset_id" : "ad_id";
  const byKey = groupBy(sales, (s) => s[key]);
  for (const r of rows.values()) applySales(r, byKey.get(r.id) ?? [], ctx);

  let list = [...rows.values()];
  if (level === "account") {
    const accRows = new Map<string, AdRow>();
    for (const acc of accounts) {
      accRows.set(acc.id, {
        ...empty(), id: acc.id, name: acc.name, level: "account", accountId: acc.id, accountName: acc.name,
        accountCurrency: acc.currency, profileName: acc.profile_name, status: null, effective: null,
      });
    }
    for (const r of list) {
      const a = accRows.get(r.accountId);
      if (!a) continue;
      for (const k of ["spend", "impressions", "reach", "clicks", "linkClicks", "lpv", "ic", "api", "metaPurchases", "metaValue", "video3s", "sales", "revenue", "pending", "pendingRevenue", "refunds", "fees", "profit"] as const) {
        a[k] += r[k];
      }
      if (r.effective === "ACTIVE") a.effective = "ACTIVE";
    }
    list = [...accRows.values()];
  }
  return { rows: list, errors, sales, campaignAccount };
}

function applySales(r: AdRow, list: SaleLite[], ctx: Context) {
  for (const s of list) {
    if (s.status === "approved") {
      r.sales++;
      r.revenue += s.gross_base;
      r.fees += saleFees(s, ctx.fees);
    } else if (s.status === "pending") {
      r.pending++;
      r.pendingRevenue += s.gross_base;
    } else if (s.status === "refunded" || s.status === "chargeback") {
      r.refunds++;
    }
  }
  r.fees += adsFees(r.spend, ctx.fees);
  r.profit = r.revenue - r.fees - r.spend;
}

// ------------------------------------------------------------- Métricas

export type MetricKey =
  | "spend" | "sales" | "revenue" | "profit" | "roas" | "roi" | "margin" | "cpa"
  | "ic" | "cpi" | "lpv" | "cplpv" | "cpc" | "ctr" | "cpm" | "impressions" | "clicks" | "linkClicks"
  | "convLpvIc" | "convIcSale" | "pending" | "pendingRevenue" | "refunds" | "metaPurchases" | "frequency" | "hook";

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function metric(r: AdRow, k: MetricKey): number | null {
  switch (k) {
    case "roas": return div(r.revenue, r.spend);
    case "roi": return div(r.profit, r.spend) === null ? null : (r.profit / r.spend) * 100;
    case "margin": return div(r.profit, r.revenue) === null ? null : (r.profit / r.revenue) * 100;
    case "cpa": return r.sales ? div(r.spend, r.sales) : null;
    case "cpi": return r.ic ? div(r.spend, r.ic) : null;
    case "cplpv": return r.lpv ? div(r.spend, r.lpv) : null;
    case "cpc": return r.linkClicks ? div(r.spend, r.linkClicks) : null;
    case "ctr": return r.impressions ? (r.linkClicks / r.impressions) * 100 : null;
    case "cpm": return r.impressions ? (r.spend / r.impressions) * 1000 : null;
    case "convLpvIc": return r.lpv ? (r.ic / r.lpv) * 100 : null;
    case "convIcSale": return r.ic ? (r.sales / r.ic) * 100 : null;
    case "frequency": return r.reach ? r.impressions / r.reach : null;
    case "hook": return r.impressions ? (r.video3s / r.impressions) * 100 : null;
    default: return r[k];
  }
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  kind: "money" | "int" | "pct" | "x" | "dec";
  title?: string;
  tone?: "spend" | "signed";
  /** coluna visível por padrão */
  def?: boolean;
}

export const METRICS: MetricDef[] = [
  { key: "spend", label: "Gastos", kind: "money", tone: "spend", def: true },
  { key: "sales", label: "Vendas", kind: "int", def: true },
  { key: "revenue", label: "Faturamento", kind: "money", def: true },
  { key: "profit", label: "Lucro", kind: "money", tone: "signed", def: true },
  { key: "roas", label: "ROAS", kind: "x", def: true },
  { key: "margin", label: "Margem", kind: "pct", def: true },
  { key: "roi", label: "ROI", kind: "pct" },
  { key: "cpa", label: "CPA", kind: "money", def: true },
  { key: "ic", label: "IC", kind: "int", title: "Inícios de checkout (pixel)", def: true },
  { key: "cpi", label: "Custo/IC", kind: "money", def: true },
  { key: "lpv", label: "Vis. página", kind: "int", title: "Visualizações da página de destino" },
  { key: "cplpv", label: "Custo/vis.", kind: "money" },
  { key: "convLpvIc", label: "Pág → IC", kind: "pct", title: "Conversão da página para checkout" },
  { key: "convIcSale", label: "IC → Venda", kind: "pct", title: "Conversão do checkout" },
  { key: "cpc", label: "CPC", kind: "money", def: true },
  { key: "ctr", label: "CTR", kind: "pct", def: true },
  { key: "cpm", label: "CPM", kind: "money", def: true },
  { key: "impressions", label: "Impressões", kind: "int" },
  { key: "linkClicks", label: "Cliques", kind: "int", title: "Cliques no link" },
  { key: "frequency", label: "Frequência", kind: "dec" },
  { key: "hook", label: "Hook", kind: "pct", title: "Visualizações de 3s ÷ impressões" },
  { key: "pending", label: "Pendentes", kind: "int" },
  { key: "pendingRevenue", label: "Fat. pendente", kind: "money" },
  { key: "refunds", label: "Reemb.", kind: "int", title: "Reembolsos e chargebacks" },
  { key: "metaPurchases", label: "Compras Meta", kind: "int", title: "Compras que o pixel atribuiu" },
];

export const METRIC_LABEL = Object.fromEntries(METRICS.map((m) => [m.key, m.label])) as Record<MetricKey, string>;

export function accountStatusLabel(n: number | null | undefined): string {
  return n == null ? "—" : ACCOUNT_STATUS[n] ?? String(n);
}
