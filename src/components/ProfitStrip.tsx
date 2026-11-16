import { fmtMoney } from "@/lib/money";
import type { ReactNode } from "react";

/**
 * A faixa do "valor real": o faturamento inteiro como 100%, dividido no que
 * vai para taxas, para anúncios e no que sobra de lucro.
 */
export default function ProfitStrip({
  revenue,
  fees,
  spend,
  profit,
  currency,
  variant = "classic",
  periodLabel = "Hoje",
  hourlyChart,
}: {
  revenue: number;
  fees: number;
  spend: number;
  profit: number;
  currency: string;
  variant?: "classic" | "summary";
  periodLabel?: string;
  hourlyChart?: ReactNode;
}) {
  const total = Math.max(revenue, fees + spend, 1);
  const pct = (n: number) => `${Math.max(0, (n / total) * 100)}%`;
  const loss = profit < 0;
  const parts = [
    { key: "fees", label: "Taxas e custos", value: fees, color: "bg-muted/60" },
    { key: "spend", label: "Anúncios", value: spend, color: "bg-spend" },
    { key: "profit", label: loss ? "Prejuízo" : "Lucro", value: Math.abs(profit), color: loss ? "bg-loss" : "bg-profit" },
  ];
  if (variant === "summary") {
    // Distribuição de gastos e resultado positivo no faturamento; prejuízo não
    // duplica o gasto na barra. Com prejuízo, o valor aparece acima, em destaque.
    const costs = Math.max(fees + spend, revenue, 1);
    const width = (value: number) => `${Math.max(0, (value / costs) * 100)}%`;
    return (
      <section className="relative rounded-[24px] border border-[#26333a] bg-[#11191d] p-6 sm:p-9">
        <div className="flex flex-col md:flex-row gap-8 md:gap-6 justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] text-[#90a6af]">Lucro real</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${loss ? "bg-[#341b20] text-[#fb5356]" : "bg-[#17362a] text-[#50d69f]"}`}>
                {loss ? "↘ Prejuízo" : "↗ Lucro"}
              </span>
            </div>
            <p className={`num mt-3 text-5xl sm:text-[64px] leading-none font-bold tracking-tight ${loss ? "text-[#ff5559]" : "text-[#46dfa3]"}`}>
              {fmtMoney(profit, currency)}
            </p>
            <p className="mt-2 text-sm text-[#90a6af]">{periodLabel}</p>
          </div>
          <div className="grid grid-cols-2 gap-6 sm:gap-10 shrink-0 md:min-w-[260px]">
            <div>
              <p className="text-xs text-[#90a6af] flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#89979f]" />Taxas e custos
              </p>
              <p className="num font-semibold text-lg mt-1.5">{fmtMoney(fees, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-[#90a6af] flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#f6b738]" />Anúncios
              </p>
              <p className="num font-semibold text-lg mt-1.5">{fmtMoney(spend, currency)}</p>
              {hourlyChart && (
                <details className="relative mt-2">
                  <summary className="text-xs font-medium text-[#36d8a1] cursor-pointer hover:underline">
                    {periodLabel === "Hoje" ? "Ver por hora →" : "Ver evolução →"}
                  </summary>
                  <div className="absolute right-0 top-7 z-40 w-[min(85vw,490px)] p-4 rounded-2xl border border-[#263c43] bg-[#101c21] shadow-2xl">
                    <p className="text-sm font-semibold mb-3">Desempenho · {periodLabel}</p>
                    {hourlyChart}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
        <div className="mt-9 flex h-[9px] w-full overflow-hidden rounded-full bg-[#27363d]"
          role="img"
          aria-label={`Taxas ${fmtMoney(fees,currency)}, anúncios ${fmtMoney(spend,currency)}, resultado ${fmtMoney(profit,currency)}`}>
          {fees > 0 && <div className="h-full bg-[#89979f]" style={{ width: width(fees) }} />}
          {spend > 0 && <div className="h-full bg-[#f6b738]" style={{ width: width(spend) }} />}
          {!loss && profit > 0 && <div className="h-full bg-[#46dfa3]" style={{ width: width(profit) }} />}
        </div>
      </section>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="sub">Lucro real</p>
          <p className={`num text-[2.6rem] md:text-[3.2rem] leading-none font-semibold ${loss ? "neg" : "pos"}`}>
            {fmtMoney(profit, currency)}
          </p>
        </div>
        <p className="sub text-right">
          de <span className="num text-ink text-base">{fmtMoney(revenue, currency)}</span> faturados
        </p>
      </div>
      <div className="mt-5 flex h-3.5 w-full overflow-hidden rounded-full bg-surface-2" role="img"
        aria-label={`Faturamento ${fmtMoney(revenue, currency)}: taxas ${fmtMoney(fees, currency)}, anúncios ${fmtMoney(spend, currency)}, ${loss ? "prejuízo" : "lucro"} ${fmtMoney(profit, currency)}`}>
        {parts.map((p) => (
          <div key={p.key} className={`${p.color} h-full`} style={{ width: pct(p.value) }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        {parts.map((p) => (
          <div key={p.key}>
            <dt className="flex items-center gap-1.5 text-muted"><span className={`inline-block h-2 w-2 rounded-full ${p.color}`} />{p.label}</dt>
            <dd className="num text-base">{fmtMoney(p.value, currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
