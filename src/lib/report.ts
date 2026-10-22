import "server-only";
import { db, getSetting } from "./db";
import { env } from "./env";
import { adsFees, dailyFixed, saleFees, type Fee } from "./fees";
import { round2, toBase, type FxRates } from "./money";
import { getDailySpend, getHourlySpend, type MetaAuth } from "./meta";
import { authOf } from "./profiles";
import { addDays, hourInTz, ymdInTz, type DateRange } from "./dates";

export interface SelectedAccount {
  id: string; // act_123
  name: string;
  currency: string;
  profile_id: string;
  profile_name: string;
  auth: MetaAuth;
}

export interface SaleLite {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  product_name: string | null;
  payment_method: string | null;
  customer_email: string | null;
  utm_source: string | null;
  gross_base: number;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
}

export async function getContext() {
  const [base, rates, accounts, fees, profiles] = await Promise.all([
    getSetting<string>("base_currency", "BRL"),
    getSetting<FxRates>("fx_rates", { BRL: 1 }),
    loadSelectedAccounts(),
    loadFees(),
    db().from("meta_profiles").select("id,name,status,expires_at,last_error").order("created_at"),
  ]);
  return {
    base, rates, accounts, fees, tz: env.timezone,
    profiles: (profiles.data ?? []) as { id: string; name: string; status: string; expires_at: string | null; last_error: string | null }[],
  };
}

export type Context = Awaited<ReturnType<typeof getContext>>;

/** Contas de anúncio ligadas no painel, já com o token do perfil dono. */
export async function loadSelectedAccounts(): Promise<SelectedAccount[]> {
  const { data, error } = await db()
    .from("ad_accounts")
    .select("id,name,currency,profile_id,meta_profiles(name,token,app_secret)")
    .eq("enabled", true)
    .order("name");
  if (error) return [];
  return (data ?? [])
    .filter((a: any) => a.meta_profiles)
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      profile_id: a.profile_id,
      profile_name: a.meta_profiles.name,
      auth: authOf(a.meta_profiles),
    }));
}

export async function loadFees(): Promise<Fee[]> {
  const { data } = await db().from("fees").select("*").order("created_at");
  return (data ?? []).map((f: any) => ({ ...f, value: Number(f.value) })) as Fee[];
}

/** Vendas do período (pela data da venda). */
export async function loadSales(range: DateRange): Promise<SaleLite[]> {
  const out: SaleLite[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await db()
      .from("sales")
      .select("id,platform,status,created_at,approved_at,product_name,payment_method,customer_email,utm_source,gross_base,campaign_id,adset_id,ad_id")
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((s: any) => ({ ...s, gross_base: Number(s.gross_base) })));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export interface SpendResult {
  total: number; // moeda base
  byDay: Record<string, number>;
  byHour: number[];
  errors: string[];
}

export async function loadSpend(
  range: DateRange,
  accounts: SelectedAccount[],
  base: string,
  rates: FxRates,
): Promise<SpendResult> {
  const res: SpendResult = { total: 0, byDay: {}, byHour: Array(24).fill(0), errors: [] };
  if (!accounts.length) return res;
  await Promise.all(
    accounts.map(async (acc) => {
      try {
        if (range.days === 1) {
          const rows = await getHourlySpend(acc.auth, acc.id, range.since);
          let sub = 0;
          for (const r of rows) {
            const h = r.hour;
            const v = toBase(r.spend, acc.currency, base, rates);
            if (h >= 0 && h < 24) res.byHour[h] += v;
            sub += v;
          }
          res.total += sub;
          res.byDay[range.since] = (res.byDay[range.since] ?? 0) + sub;
        } else {
          const days = await getDailySpend(acc.auth, acc.id, range.since, range.until);
          for (const d of days) {
            const v = toBase(d.spend, acc.currency, base, rates);
            res.byDay[d.date] = (res.byDay[d.date] ?? 0) + v;
            res.total += v;
          }
        }
      } catch (e: any) {
        res.errors.push(`${acc.name}: ${e?.message ?? "erro"}`);
      }
    }),
  );
  res.total = round2(res.total);
  return res;
}

export interface Summary {
  revenue: number;
  approved: number;
  pending: number;
  pendingValue: number;
  refunded: number;
  refundedValue: number;
  chargebacks: number;
  saleFees: number;
  adsFees: number;
  fixed: number;
  fees: number;
  spend: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  margin: number | null;
  cpa: number | null;
  ticket: number | null;
}

export function summarize(sales: SaleLite[], fees: Fee[], spend: number, days: number): Summary {
  let revenue = 0, approved = 0, pending = 0, pendingValue = 0, refunded = 0, refundedValue = 0, chargebacks = 0, sf = 0;
  for (const s of sales) {
    if (s.status === "approved") {
      approved++;
      revenue += s.gross_base;
      sf += saleFees(s, fees);
    } else if (s.status === "pending") {
      pending++;
      pendingValue += s.gross_base;
    } else if (s.status === "refunded") {
      refunded++;
      refundedValue += s.gross_base;
    } else if (s.status === "chargeback") {
      chargebacks++;
      refundedValue += s.gross_base;
    }
  }
  const af = adsFees(spend, fees);
  const fixed = dailyFixed(days, fees);
  const totalFees = round2(sf + af + fixed);
  const profit = round2(revenue - totalFees - spend);
  return {
    revenue: round2(revenue),
    approved,
    pending,
    pendingValue: round2(pendingValue),
    refunded,
    refundedValue: round2(refundedValue),
    chargebacks,
    saleFees: round2(sf),
    adsFees: af,
    fixed,
    fees: totalFees,
    spend,
    profit,
    roas: spend > 0 ? revenue / spend : null,
    roi: spend + af > 0 ? (profit / (spend + af)) * 100 : null,
    margin: revenue > 0 ? (profit / revenue) * 100 : null,
    cpa: approved > 0 && spend > 0 ? spend / approved : null,
    ticket: approved > 0 ? revenue / approved : null,
  };
}

export function chartSeries(range: DateRange, sales: SaleLite[], spend: SpendResult, fees: Fee[], tz: string) {
  if (range.days === 1) {
    const rev = Array(24).fill(0);
    const sf = Array(24).fill(0);
    for (const s of sales) {
      if (s.status !== "approved") continue;
      const h = hourInTz(s.created_at, tz);
      rev[h] += s.gross_base;
      sf[h] += saleFees(s, fees);
    }
    const fixedHour = dailyFixed(1, fees) / 24;
    const isToday = range.since === ymdInTz(new Date(), tz);
    const lastHour = isToday ? hourInTz(new Date().toISOString(), tz) : 23;
    return rev.slice(0, lastHour + 1).map((r, h) => {
      const sp = spend.byHour[h];
      return {
        label: `${String(h).padStart(2, "0")}h`,
        revenue: round2(r),
        spend: round2(sp),
        profit: round2(r - sf[h] - sp - adsFees(sp, fees) - fixedHour),
      };
    });
  }
  const out = [];
  for (let d = range.since; d <= range.until; d = addDays(d, 1)) {
    let r = 0, f = 0;
    for (const s of sales) {
      if (s.status !== "approved" || ymdInTz(new Date(s.created_at), tz) !== d) continue;
      r += s.gross_base;
      f += saleFees(s, fees);
    }
    const sp = spend.byDay[d] ?? 0;
    out.push({
      label: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
      revenue: round2(r),
      spend: round2(sp),
      profit: round2(r - f - sp - adsFees(sp, fees) - dailyFixed(1, fees)),
    });
  }
  return out;
}

export function groupBy<T>(list: T[], key: (t: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of list) {
    const k = key(i) ?? "";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return m;
}
