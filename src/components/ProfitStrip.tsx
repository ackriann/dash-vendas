import { fmtMoney } from "@/lib/money";

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
}: {
  revenue: number;
  fees: number;
  spend: number;
  profit: number;
  currency: string;
}) {
  const total = Math.max(revenue, fees + spend, 1);
  const pct = (n: number) => `${Math.max(0, (n / total) * 100)}%`;
  const loss = profit < 0;
  const parts = [
    { key: "fees", label: "Taxas e custos", value: fees, color: "bg-muted/60" },
    { key: "spend", label: "Anúncios", value: spend, color: "bg-spend" },
    { key: "profit", label: loss ? "Prejuízo" : "Lucro", value: Math.abs(profit), color: loss ? "bg-loss" : "bg-profit" },
  ];
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
