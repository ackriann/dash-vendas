export type FxRates = Record<string, number>;

/** Converte um valor de uma moeda para a moeda base usando taxas "1 MOEDA = X BASE". */
export function toBase(amount: number, currency: string, base: string, rates: FxRates): number {
  const cur = (currency || base).toUpperCase();
  const b = base.toUpperCase();
  if (cur === b) return round2(amount);
  const rCur = rates[cur];
  const rBase = rates[b] ?? 1;
  if (!rCur) return round2(amount); // sem taxa cadastrada: mantém o número
  return round2((amount * rCur) / rBase);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmtMoney(n: number, currency = "BRL"): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toFixed(2)}`;
  }
}

export function fmtNum(n: number, digits = 0): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n || 0);
}

export function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${fmtNum(n, digits)}%`;
}

export function parseMoneyInput(v: FormDataEntryValue | null): number {
  if (v === null) return 0;
  let s = String(v).trim().replace(/[^\d,.-]/g, "");
  // "1.234,56" -> "1234.56" ; "1234.56" mantém
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
