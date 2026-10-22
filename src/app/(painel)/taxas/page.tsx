import { FEE_KIND_LABEL, type FeeKind } from "@/lib/fees";
import { fmtMoney, fmtNum } from "@/lib/money";
import { loadFees } from "@/lib/report";
import { db, getSetting } from "@/lib/db";
import { PLATFORM_LABEL } from "@/lib/sales";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { addFee, deleteFee, toggleFee, updateFee } from "./actions";

const PRESETS: { name: string; kind: FeeKind; value: string; hint: string }[] = [
  { name: "Taxa do gateway", kind: "percent_sale", value: "4,99", hint: "percentual cobrado por venda" },
  { name: "Tarifa fixa do gateway", kind: "fixed_sale", value: "1,00", hint: "valor fixo por transação" },
  { name: "Imposto sobre faturamento", kind: "percent_sale", value: "6,00", hint: "ex.: alíquota do Simples" },
  { name: "Impostos sobre anúncios", kind: "percent_ads", value: "12,15", hint: "confira o percentual na fatura da Meta" },
  { name: "Ferramentas e equipe", kind: "fixed_day", value: "30,00", hint: "custo mensal dividido por 30" },
  { name: "Custo do produto", kind: "fixed_sale", value: "15,00", hint: "frete/produção por venda — escolha o produto abaixo" },
];

export default async function Taxas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const [fees, base, prod] = await Promise.all([
    loadFees(),
    getSetting<string>("base_currency", "BRL"),
    db().from("sales").select("product_name").not("product_name", "is", null).order("created_at", { ascending: false }).limit(1000),
  ]);
  const products = [...new Set((prod.data ?? []).map((r: any) => r.product_name as string))].sort();
  const fmtVal = (kind: FeeKind, v: number) => (kind.startsWith("percent") ? `${fmtNum(v, 2)}%` : fmtMoney(v, base));
  const existing = new Set(fees.map((f) => f.name));

  // Simulação de uma venda de 197 com 60 de anúncio
  const sim = { gross: 197, spend: 60 };
  let simFees = 0;
  for (const f of fees) {
    if (!f.active) continue;
    if (f.platform || f.product) continue;
    if (f.kind === "percent_sale") simFees += (sim.gross * f.value) / 100;
    if (f.kind === "fixed_sale") simFees += f.value;
    if (f.kind === "percent_ads") simFees += (sim.spend * f.value) / 100;
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <header>
        <h1>Taxas e custos</h1>
        <p className="sub">Tudo que sai do faturamento antes de virar lucro. Vale para o resumo, as campanhas e cada venda.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <section className="panel overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead><tr><th>Ativa</th><th>Nome</th><th>Tipo</th><th>Aplica em</th><th>Valor</th><th /></tr></thead>
          <tbody>
            {fees.map((f) => (
              <tr key={f.id} className={f.active ? "" : "opacity-50"}>
                <td>
                  <form action={toggleFee}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="active" value={String(!f.active)} />
                    <SubmitButton className={`pill ${f.active ? "pill-approved" : ""} cursor-pointer`} pendingText="…">{f.active ? "Sim" : "Não"}</SubmitButton>
                  </form>
                </td>
                <td>{f.name}</td>
                <td className="text-sm text-muted">{FEE_KIND_LABEL[f.kind]}</td>
                <td className="text-sm">
                  {f.platform || f.product ? (
                    [f.platform && (PLATFORM_LABEL[f.platform] ?? f.platform), f.product].filter(Boolean).join(" · ")
                  ) : <span className="text-muted">Todas as vendas</span>}
                </td>
                <td>
                  <form action={updateFee} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={f.id} />
                    <input className="input !h-8 !w-24 num text-sm" name="value" defaultValue={String(f.value).replace(".", ",")} inputMode="decimal" aria-label={`Valor de ${f.name}`} />
                    <span className="text-xs text-muted">{f.kind.startsWith("percent") ? "%" : base}</span>
                    <SubmitButton className="btn btn-sm" pendingText="…">Salvar</SubmitButton>
                  </form>
                </td>
                <td className="r">
                  <form action={deleteFee}>
                    <input type="hidden" name="id" value={f.id} />
                    <SubmitButton className="btn btn-sm btn-danger" confirm={`Remover "${f.name}"?`}>Remover</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
            {!fees.length && <tr><td colSpan={6} className="text-center text-muted py-8">Nenhuma taxa cadastrada: o lucro está sendo calculado só com o gasto em anúncios.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="grid md:grid-cols-[1fr_320px] gap-4 items-start">
        <form action={addFee} className="panel panel-pad grid sm:grid-cols-2 gap-3">
          <h2 className="sm:col-span-2">Adicionar taxa</h2>
          <label className="field sm:col-span-2"><span className="label">Nome</span><input className="input" name="name" placeholder="Ex.: Taxa da Hotmart" required /></label>
          <label className="field"><span className="label">Tipo</span>
            <select className="select" name="kind" defaultValue="percent_sale">
              {Object.entries(FEE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Valor (% ou {base})</span><input className="input num" name="value" inputMode="decimal" placeholder="9,90" required /></label>
          <label className="field sm:col-span-2"><span className="label">Aplicar só nas vendas de (opcional)</span>
            <select className="select" name="platform" defaultValue="">
              <option value="">Todas as plataformas</option>
              {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field sm:col-span-2"><span className="label">Só no produto (opcional — ex.: custo do produto, coprodução)</span>
            <input className="input" name="product" list="produtos" placeholder="Todos os produtos" />
            <datalist id="produtos">{products.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <div className="sm:col-span-2"><SubmitButton className="btn btn-primary" pendingText="Adicionando…">Adicionar taxa</SubmitButton></div>
        </form>

        <div className="space-y-4">
          <div className="panel panel-pad">
            <h3 className="mb-2">Atalhos comuns</h3>
            <ul className="space-y-2">
              {PRESETS.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    {p.name} <span className="num text-muted">{p.kind.startsWith("percent") ? `${p.value}%` : `${base} ${p.value}`}</span>
                    <div className="text-xs text-muted">{p.hint}</div>
                  </div>
                  {existing.has(p.name) ? <span className="text-xs text-muted">adicionada</span> : (
                    <form action={addFee}>
                      <input type="hidden" name="name" value={p.name} />
                      <input type="hidden" name="kind" value={p.kind} />
                      <input type="hidden" name="value" value={p.value} />
                      <SubmitButton className="btn btn-sm" pendingText="…">Adicionar</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-3">Os valores são só ponto de partida. Ajuste para os da sua operação.</p>
          </div>
          <div className="panel panel-pad text-sm">
            <h3 className="mb-1">Na prática</h3>
            <p className="text-muted">Uma venda de {fmtMoney(sim.gross, base)} que custou {fmtMoney(sim.spend, base)} em anúncio:</p>
            <p className="mt-2">Taxas: <span className="num">{fmtMoney(simFees, base)}</span></p>
            <p>Lucro real: <span className={`num font-semibold ${sim.gross - sim.spend - simFees < 0 ? "neg" : "pos"}`}>{fmtMoney(sim.gross - sim.spend - simFees, base)}</span></p>
          </div>
        </div>
      </section>
    </div>
  );
}
