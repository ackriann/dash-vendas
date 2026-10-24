import { getSetting } from "@/lib/db";
import { env } from "@/lib/env";
import type { FxRates } from "@/lib/money";
import Notice from "@/components/Notice";
import PushToggle from "@/components/PushToggle";
import SaleSoundSettings from "@/components/SaleSoundSettings";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import { currentWorkspace, getInviteCode, listWorkspaces } from "@/lib/workspaces";
import { fmtDateTime } from "@/lib/dates";
import { saveAccountName, saveCurrency, saveInviteCode, saveNotify, savePassword } from "./actions";

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const ws = await currentWorkspace();
  const [notify, base, rates, invite, all] = await Promise.all([
    getSetting("notify", { approved: true, pending: false, refund: true }),
    getSetting<string>("base_currency", "BRL"),
    getSetting<FxRates>("fx_rates", { BRL: 1 }),
    ws.is_owner ? getInviteCode() : Promise.resolve(""),
    ws.is_owner ? listWorkspaces() : Promise.resolve([]),
  ]);
  const signupUrl = `${env.appUrl}/cadastro`;
  const others = Object.entries(rates).filter(([c]) => c !== base);

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <h1>Ajustes</h1>
        <p className="sub">Conta, notificações no celular e moeda do painel.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <section className="panel panel-pad space-y-4">
        <div>
          <h2>Sua conta</h2>
          <p className="sub">
            Entrou como <b className="text-ink">{ws.email}</b>{ws.is_owner ? " · conta principal" : ""}. Cada conta é um painel separado: perfis Meta, checkouts, webhooks, pixel e vendas próprios.
          </p>
        </div>
        <form action={saveAccountName} className="flex gap-2 flex-wrap items-end">
          <label className="field flex-1 min-w-48"><span className="label">Nome da conta</span><input className="input" name="name" defaultValue={ws.name ?? ""} maxLength={60} /></label>
          <SubmitButton className="btn" pendingText="Salvando…">Salvar nome</SubmitButton>
        </form>
        <form action="/api/logout" method="post"><button className="btn btn-sm">Sair desta conta</button></form>
        <details>
          <summary className="sub underline cursor-pointer">Trocar senha</summary>
          <form action={savePassword} className="mt-3 grid sm:grid-cols-3 gap-3">
            <label className="field"><span className="label">Senha atual</span><input className="input" type="password" name="current" autoComplete="current-password" required /></label>
            <label className="field"><span className="label">Nova senha</span><input className="input" type="password" name="next" autoComplete="new-password" minLength={8} required /></label>
            <label className="field"><span className="label">Repita a nova</span><input className="input" type="password" name="next2" autoComplete="new-password" minLength={8} required /></label>
            <div><SubmitButton className="btn btn-primary" pendingText="Salvando…">Trocar senha</SubmitButton></div>
          </form>
        </details>

        {ws.is_owner && (
          <div className="border-t border-line pt-4 space-y-3">
            <h3>Criar outras contas</h3>
            <p className="sub">
              Para separar tudo (outro e-mail, outra Meta, outros checkouts), abra <b className="text-ink">{signupUrl}</b> e use o código de convite.
              Sem código, ninguém consegue se cadastrar.
            </p>
            {invite ? (
              <div className="flex gap-2 items-start flex-wrap">
                <code className="codebox flex-1">{invite}</code>
                <CopyButton text={invite} label="Copiar código" />
                <CopyButton text={signupUrl} label="Copiar link" />
              </div>
            ) : (
              <p className="text-sm text-muted">Cadastro fechado.</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <form action={saveInviteCode}><SubmitButton className={invite ? "btn btn-sm" : "btn btn-primary"} pendingText="Gerando…">{invite ? "Gerar código novo" : "Gerar código de convite"}</SubmitButton></form>
              {invite && (
                <form action={saveInviteCode}><input type="hidden" name="clear" value="1" /><SubmitButton className="btn btn-sm btn-danger" confirm="Fechar o cadastro? O código atual para de funcionar.">Fechar cadastro</SubmitButton></form>
              )}
            </div>
            {all.length > 1 && (
              <ul className="divide-y divide-[#1f3a44] border border-line rounded-xl">
                {all.map((w) => (
                  <li key={w.id} className="px-3 py-2 text-sm flex justify-between gap-3 flex-wrap">
                    <span>{w.name || w.email} <span className="text-muted">· {w.email ?? "sem e-mail"}</span></span>
                    <span className="text-xs text-muted">{w.is_owner ? "principal" : `criada em ${fmtDateTime(w.created_at, env.timezone)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

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
