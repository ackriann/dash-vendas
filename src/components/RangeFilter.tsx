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
}: {
  range: DateRange;
  path: string;
  keep?: Record<string, string | undefined>;
}) {
  const href = (r: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    p.set("range", r);
    return `${path}?${p}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="seg">
        {OPTIONS.map(([k, l]) => (
          <Link key={k} href={href(k)} aria-current={range.key === k ? "true" : undefined}>
            {l}
          </Link>
        ))}
      </div>
      <details className="relative">
        <summary className={`btn btn-sm ${range.key === "custom" ? "border-info" : ""}`}>
          {range.key === "custom" ? range.label : "Período…"}
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
