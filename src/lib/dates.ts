// Datas sempre calculadas no fuso do painel (padrão America/Sao_Paulo).

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "custom";

export interface DateRange {
  key: RangeKey;
  since: string; // YYYY-MM-DD (fuso do painel)
  until: string; // YYYY-MM-DD (inclusive)
  startIso: string; // instante UTC do início
  endIso: string; // instante UTC do fim (exclusivo)
  days: number;
  label: string;
}

/** YYYY-MM-DD de um instante no fuso informado. */
export function ymdInTz(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Diferença (minutos) entre o fuso e UTC naquele instante. Ex.: São Paulo = -180. */
function tzOffsetMinutes(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** Instante UTC da meia-noite de YYYY-MM-DD no fuso. */
export function startOfDayUtc(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  const off = tzOffsetMinutes(guess, tz);
  return new Date(Date.UTC(y, m - 1, d) - off * 60000);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
}

const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function resolveRange(params: { range?: string; since?: string; until?: string }, tz: string): DateRange {
  const today = ymdInTz(new Date(), tz);
  const key = (params.range as RangeKey) || "today";
  let since = today;
  let until = today;
  let label = "Hoje";
  switch (key) {
    case "yesterday": since = until = addDays(today, -1); label = "Ontem"; break;
    case "7d": since = addDays(today, -6); label = "Últimos 7 dias"; break;
    case "30d": since = addDays(today, -29); label = "Últimos 30 dias"; break;
    case "month": since = today.slice(0, 8) + "01"; label = "Este mês"; break;
    case "lastmonth": {
      const firstThis = today.slice(0, 8) + "01";
      until = addDays(firstThis, -1);
      since = until.slice(0, 8) + "01";
      label = "Mês passado";
      break;
    }
    case "custom":
      if (isYmd(params.since) && isYmd(params.until) && params.since! <= params.until!) {
        since = params.since!; until = params.until!;
        label = `${br(since)} – ${br(until)}`;
      }
      break;
  }
  return {
    key: ["today", "yesterday", "7d", "30d", "month", "lastmonth", "custom"].includes(key) ? key : "today",
    since, until,
    startIso: startOfDayUtc(since, tz).toISOString(),
    endIso: startOfDayUtc(addDays(until, 1), tz).toISOString(),
    days: daysBetween(since, until),
    label,
  };
}

export function br(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function hourInTz(iso: string, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
}
