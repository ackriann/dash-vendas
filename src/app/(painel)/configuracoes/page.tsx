import { getSetting } from "@/lib/db";
import { env } from "@/lib/env";
import type { FxRates } from "@/lib/money";
import Notice from "@/components/Notice";
import PushToggle from "@/components/PushToggle";
import SaleSoundSettings from "@/components/SaleSoundSettings";
import SubmitButton from "@/components/SubmitButton";
import { saveCurrency, saveNotify } from "./actions";

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const [notify, base, rates] = await Promise.all([
    getSetting("notify", { approved: true, pending: false, refund: true }),
    getSetting<string>("base_currency", "BRL"),
    getSetting<FxRates>("fx_rates", { BRL: 1 }),
  ]);
  const others = Object.entries(rates).filter(([c]) => c !== base);

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <h1>Ajustes</h1>
        <p className="sub">Notificações no celular e moeda do painel.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <section className="panel panel-pad space-y-4">
        <div>
          <h2>Notificação de venda no celular</h2>
          <p className="sub">Ative em cada aparelho que deve receber. No celular, instale o painel primeiro: Android → menu do Chrome → Instalar app; iPhone → Compartilhar → Adicionar à Tela de Início.</p>
        </div>
        <PushToggle vapidKey={env.vapidPublic} />
        <SaleSoundSettings />
        <form action={saveNotify} className="border-t border-line pt-4 space-y-2">
          <h3>Avisar quando</h3>
          <label className="flex items-center gap-2"><input type="checkbox" name="approved" defaultChecked={notify.approved} /> Uma venda for aprovada</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="pending" defaultChecked={notify.pending} /> Um Pix ou boleto for gerado</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="refund" defaultChecked={notify.refund} /> Houver reembolso ou chargeback</label>
          <SubmitButton className="btn btn-primary mt-2" pendingText="Salvando…">Salvar preferências</SubmitButton>
        </form>
      </section>

      <section className="panel panel-pad space-y-4">
        <div>
          <h2>Moeda e câmbio</h2>
          <p className="sub">Vendas e gastos em outras moedas são convertidos para a moeda do painel com estas cotações.</p>
        </div>
        <form action={saveCurrency} className="space-y-3">
          <label className="field max-w-xs"><span className="label">Moeda do painel</span>
            <select className="select" name="base" defaultValue={base}>{["BRL", "USD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            {others.map(([c, r]) => (
              <label key={c} className="field"><span className="label">1 {c} = ? {base}</span><input className="input num" name={`rate_${c}`} defaultValue={String(r).replace(".", ",")} inputMode="decimal" /></label>
            ))}
            <label className="field"><span className="label">Outra moeda</span><input className="input" name="new_cur" placeholder="MXN" maxLength={3} /></label>
            <label className="field"><span className="label">Cotação</span><input className="input num" name="new_rate" inputMode="decimal" placeholder="0,30" /></label>
          </div>
          <SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar câmbio</SubmitButton>
        </form>
      </section>
    </div>
  );
}
