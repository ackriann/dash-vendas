import Link from "next/link";
import type { DateRange } from "@/lib/dates";

const OPTIONS: [string, string][] = [
  ["today", "Hoje"],
  ["yesterday", "Ontem"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["month", "Este mês"],
  ["lastmonth", "Mês passado"],
];

export default function RangeFilter({
  range,
  path,
  keep = {},
  variant = "classic",
}: {
  range: DateRange;
  path: string;
  keep?: Record<string, string | undefined>;
  variant?: "classic" | "summary";
}) {
  const href = (r: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    p.set("range", r);
    return `${path}?${p}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={variant === "summary"
        ? "flex flex-wrap items-center gap-1 rounded-full bg-[#1a2429] p-1"
        : "seg"}>
        {OPTIONS.map(([k, l]) => (
          <Link key={k} href={href(k)} aria-current={range.key === k ? "true" : undefined}
            className={variant === "summary"
              ? `rounded-full px-3.5 py-2 text-xs sm:text-sm whitespace-nowrap transition-colors ${range.key === k ? "bg-[#f1f5f5] text-[#0b1216] font-semibold" : "text-[#91a7b0] hover:text-white"}`
              : undefined}>
            {l}
          </Link>
        ))}
      </div>
      <details className="relative">
        <summary className={variant === "summary"
          ? "inline-flex items-center gap-2 rounded-full border border-[#223139] bg-[#0c1418] px-4 py-2 text-xs sm:text-sm text-[#96a8b1] hover:text-white"
          : `btn btn-sm ${range.key === "custom" ? "border-info" : ""}`}>
          {variant === "summary" && (
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2"/>
              <path d="M7 3v4M17 3v4M3 10h18"/>
            </svg>
          )}
          {range.key === "custom" ? range.label : variant === "summary" ? "Período" : "Período…"}
        </summary>
        <form method="get" action={path} className="panel absolute z-30 mt-2 p-3 flex flex-col gap-2 w-64 right-0 md:left-0 md:right-auto">
          {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input type="hidden" name="range" value="custom" />
          <label className="field"><span className="label">De</span><input className="input" type="date" name="since" defaultValue={range.since} required /></label>
          <label className="field"><span className="label">Até</span><input className="input" type="date" name="until" defaultValue={range.until} required /></label>
          <button className="btn btn-primary">Aplicar</button>
        </form>
      </details>
    </div>
  );
}
