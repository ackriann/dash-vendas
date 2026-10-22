import { env } from "@/lib/env";
import { getSetting } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { METRICS } from "@/lib/ads";
import { loadSelectedAccounts } from "@/lib/report";
import { ACTION_LABEL, LEVEL_LABEL, OP_LABEL, PERIOD_LABEL, describeRule, listRules, type Rule } from "@/lib/rules";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import { createRule, deleteRule, newCronKey, runRuleNow, toggleRule } from "./actions";

const TEMPLATES = [
  "Pausar se gastar 1,5× o preço do produto sem vender (Gastos > 150 e Vendas < 1)",
  "Pausar se CPA passar do limite (CPA > 80)",
  "Escalar se ROAS bom (ROAS ≥ 2 e Vendas ≥ 3 → +20% orçamento)",
  "Reativar ontem lucrativo (período Ontem, Lucro > 0 → Ativar)",
];

export default async function Regras({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  let loadError: string | null = null;
  const [rules, accounts, cronKey, base] = await Promise.all([
    listRules().catch((e) => {
      loadError = `${e?.message ?? e}. Rode supabase/migrations/002_perfis_regras.sql no SQL Editor do Supabase.`;
      return [] as Rule[];
    }),
    loadSelectedAccounts(),
    getSetting<string>("cron_key", ""),
    getSetting<string>("base_currency", "BRL"),
  ]);
  const cronUrl = cronKey ? `${env.appUrl}/api/cron/rules?key=${cronKey}` : "";

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1>Regras automáticas</h1>
        <p className="sub">Pausam, ativam ou mudam o orçamento sozinhas, olhando as vendas reais (não só o pixel).</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? loadError ?? undefined} />

      <section className="space-y-3">
        {rules.map((r) => (
          <div key={r.id} className={`panel panel-pad space-y-2 ${r.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold">{r.name}</p>
                <p className="text-sm text-muted">{describeRule(r, base)}</p>
                <p className="text-xs text-muted">
                  {r.account_id ? accounts.find((a) => a.id === r.account_id)?.name ?? r.account_id : "Todas as contas"}
                  {r.name_contains && ` · nome contém “${r.name_contains}”`}
                  {` · espera ${r.cooldown_hours}h antes de repetir no mesmo item`}
                  {r.only_active && r.action !== "activate" && " · só itens ativos"}
                </p>
              </div>
              <div className="flex gap-1 flex-wrap">
                <form action={runRuleNow}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="dry" value="1" /><SubmitButton className="btn btn-sm" pendingText="…">Simular</SubmitButton></form>
                <form action={runRuleNow}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn btn-sm" pendingText="…" confirm="Executar agora? As mudanças vão para a Meta.">Executar</SubmitButton></form>
                <form action={toggleRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.active)} /><SubmitButton className={`btn btn-sm ${r.active ? "" : "btn-primary"}`} pendingText="…">{r.active ? "Desligar" : "Ligar"}</SubmitButton></form>
                <form action={deleteRule}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover a regra ${r.name}?`}>Remover</SubmitButton></form>
              </div>
            </div>
            {r.last_run_at && (
              <p className="text-xs border-t border-line pt-2">
                <span className="text-muted">Última execução {fmtDateTime(r.last_run_at, env.timezone)}:</span> {r.last_result}
              </p>
            )}
          </div>
        ))}
        {!rules.length && !loadError && <p className="sub">Nenhuma regra ainda.</p>}
      </section>

      <section className="panel panel-pad space-y-4">
        <h2>Nova regra</h2>
        <details>
          <summary className="sub underline">Ideias de regras</summary>
          <ul className="list-disc pl-5 mt-2 text-sm text-muted space-y-1">{TEMPLATES.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
        <form action={createRule} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="field sm:col-span-3"><span className="label">Nome</span><input className="input" name="name" required placeholder="Pausar anúncio sem venda" /></label>
            <label className="field"><span className="label">Aplicar em</span>
              <select className="select" name="level" defaultValue="ad">{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field"><span className="label">Olhando o período</span>
              <select className="select" name="period" defaultValue="today">{Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field"><span className="label">Conta</span>
              <select className="select" name="account_id" defaultValue="">
                <option value="">Todas as contas</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="field sm:col-span-3"><span className="label">Só itens cujo nome contém (opcional)</span><input className="input" name="name_contains" placeholder="[ESCALA]" /></label>
          </div>

          <div className="space-y-2">
            <p className="label">Condições (todas precisam ser verdadeiras)</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_120px] gap-2">
                <select className="select" name={`metric${i}`} defaultValue={i === 0 ? "spend" : i === 1 ? "sales" : ""} aria-label={`Métrica ${i + 1}`}>
                  {i > 0 && <option value="">—</option>}
                  {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <select className="select" name={`op${i}`} defaultValue={i === 1 ? "lt" : "gt"} aria-label="Operador">
                  {Object.entries(OP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input className="input num" name={`value${i}`} inputMode="decimal" placeholder={i === 0 ? "100" : i === 1 ? "1" : ""} aria-label="Valor" />
              </div>
            ))}
            <p className="text-xs text-muted">Valores em {base} para dinheiro, em % para CTR/margem/ROI e em “x” para ROAS. Métrica sem dado (ex.: CPA sem vendas) não atende.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <label className="field"><span className="label">Então</span>
              <select className="select" name="action" defaultValue="pause">{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field"><span className="label">Valor (% ou orçamento, nas ações de orçamento)</span><input className="input num" name="action_value" inputMode="decimal" placeholder="20" /></label>
            <label className="field"><span className="label">Esperar antes de repetir (horas)</span><input className="input num" name="cooldown_hours" defaultValue="24" inputMode="numeric" /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="only_active" defaultChecked /> Só itens ativos</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="notify" defaultChecked /> Notificar no celular</label>
          </div>
          <SubmitButton className="btn btn-primary" pendingText="Salvando…">Criar regra</SubmitButton>
        </form>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2>Agendador</h2>
        <p className="sub">
          As regras rodam quando esta URL é chamada. Cadastre-a em um cron gratuito (ex.: cron-job.org) a cada 15 ou 30 minutos.
          A mesma chamada confere e renova os tokens dos perfis uma vez por dia.
        </p>
        {cronUrl ? (
          <div className="flex gap-2 items-start">
            <code className="codebox flex-1">{cronUrl}</code>
            <CopyButton text={cronUrl} />
          </div>
        ) : (
          <p className="text-sm">Gere a chave para ver a URL.</p>
        )}
        <form action={newCronKey}>
          <SubmitButton className={cronKey ? "btn btn-sm" : "btn btn-primary"} pendingText="…" confirm={cronKey ? "Gerar nova chave? A URL antiga para de funcionar." : undefined}>
            {cronKey ? "Gerar nova chave" : "Gerar chave"}
          </SubmitButton>
        </form>
        <p className="text-xs text-muted">No plano pago da Vercel dá para usar o Vercel Cron com a variável CRON_SECRET apontando para /api/cron/rules.</p>
      </section>
    </div>
  );
}
