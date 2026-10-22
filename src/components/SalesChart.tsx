"use client";
import { Bar, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartPoint {
  label: string;
  revenue: number;
  spend: number;
  profit: number;
}

export default function SalesChart({ data, currency = "BRL" }: { data: ChartPoint[]; currency?: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  if (!data.length) return <p className="sub">Sem dados no período.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#22404b" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8fa9a8", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={{ fill: "#8fa9a8", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => fmt(Number(v))} />
          <Tooltip
            cursor={{ fill: "rgba(124,196,255,0.06)" }}
            contentStyle={{ background: "#152a32", border: "1px solid #27444f", borderRadius: 10, color: "#e8f1ef" }}
            formatter={(v, n) => [fmt(Number(v)), n === "revenue" ? "Faturamento" : n === "spend" ? "Anúncios" : "Lucro"]}
          />
          <Bar dataKey="revenue" fill="#7cc4ff" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="spend" fill="#f2b544" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line dataKey="profit" stroke="#3ddc97" strokeWidth={2.5} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
