import { env } from "@/lib/env";
import { getSetting } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { METRICS } from "@/lib/ads";
import { loadSelectedAccounts } from "@/lib/report";
import { ACTION_LABEL, LEVEL_LABEL, OP_LABEL, PERIOD_LABEL, describeRule, listRules, type Rule } from "@/lib/rules";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import Help from "@/components/Help";
import Acc from "@/components/Acc";
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
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1>Regras automáticas</h1>
          <p className="sub">Pausam, ativam ou mudam o orçamento sozinhas, olhando as vendas reais.</p>
        </div>
        <Help title="Como as regras funcionam" label="Como funciona">
          <ul>
            <li>Cada regra olha um período (hoje, ontem, 7 dias…) e compara as métricas com as <b>vendas reais</b> do painel, não só o pixel.</li>
            <li>Se <b>todas</b> as condições forem verdadeiras, a ação é aplicada no item (campanha, conjunto ou anúncio).</li>
            <li>Depois de agir, a regra espera o tempo configurado antes de mexer de novo no mesmo item.</li>
            <li>Use <b>Simular</b> para ver o que ela faria agora sem mudar nada na Meta.</li>
            <li>Para rodar sozinha, cadastre a URL do <b>Agendador</b> num serviço de cron.</li>
          </ul>
          <p><b>Ideias</b></p>
          <ul>{TEMPLATES.map((t) => <li key={t}>{t}</li>)}</ul>
        </Help>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? loadError ?? undefined} />

      <section>
        {rules.map((r) => (
          <Acc
            key={r.id}
            title={r.name}
            sub={describeRule(r, base)}
            right={<span className={`pill ${r.active ? "pill-approved" : ""}`}>{r.active ? "Ligada" : "Desligada"}</span>}
          >
            <ul className="text-sm text-muted space-y-1">
              <li>Contas: {r.account_id ? accounts.find((a) => a.id === r.account_id)?.name ?? r.account_id : "todas"}</li>
              {r.name_contains && <li>Só itens com “{r.name_contains}” no nome</li>}
              <li>Espera {r.cooldown_hours}h antes de repetir no mesmo item{r.only_active && r.action !== "activate" ? " · só itens ativos" : ""}{r.notify ? " · avisa no celular" : ""}</li>
              {r.last_run_at && <li>Última execução {fmtDateTime(r.last_run_at, env.timezone)}: <span className="text-ink">{r.last_result}</span></li>}
            </ul>
            <div className="flex gap-1 flex-wrap">
              <form action={runRuleNow}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="dry" value="1" /><SubmitButton className="btn btn-sm" pendingText="…">Simular</SubmitButton></form>
              <form action={runRuleNow}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn btn-sm" pendingText="…" confirm="Executar agora? As mudanças vão para a Meta.">Executar</SubmitButton></form>
              <form action={toggleRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.active)} /><SubmitButton className={`btn btn-sm ${r.active ? "" : "btn-primary"}`} pendingText="…">{r.active ? "Desligar" : "Ligar"}</SubmitButton></form>
              <form action={deleteRule} className="ml-auto"><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover a regra ${r.name}?`}>Remover</SubmitButton></form>
            </div>
          </Acc>
        ))}

        <Acc title="Nova regra" sub="Condições + ação" open={!rules.length && !loadError}>
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
              <p className="label flex items-center gap-2">
                Condições (todas precisam ser verdadeiras)
                <Help title="Valores das condições">
                  <ul>
                    <li>Dinheiro em {base} (gastos, CPA, lucro…).</li>
                    <li>Porcentagem para CTR, margem e ROI (ex.: 1,5).</li>
                    <li>ROAS em “x” (ex.: 2 = 2x).</li>
                    <li>Métrica sem dado (ex.: CPA sem vendas) não atende a condição. Para “gastou e não vendeu”, use Gastos &gt; X e Vendas &lt; 1.</li>
                  </ul>
                </Help>
              </p>
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
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="field"><span className="label">Então</span>
                <select className="select" name="action" defaultValue="pause">{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="field"><span className="label">Valor (% ou orçamento)</span><input className="input num" name="action_value" inputMode="decimal" placeholder="20" /></label>
              <label className="field"><span className="label">Esperar antes de repetir (horas)</span><input className="input num" name="cooldown_hours" defaultValue="24" inputMode="numeric" /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="only_active" defaultChecked /> Só itens ativos</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="notify" defaultChecked /> Avisar no celular</label>
            </div>
            <SubmitButton className="btn btn-primary" pendingText="Salvando…">Criar regra</SubmitButton>
          </form>
        </Acc>

        <Acc
          title="Agendador"
          sub={cronKey ? "URL gerada — cadastre num serviço de cron" : "Gere a chave para as regras rodarem sozinhas"}
          right={
            <>
              <Help title="Como agendar">
                <ol>
                  <li>Gere a chave e copie a URL.</li>
                  <li>Crie uma conta grátis em <b>cron-job.org</b> (ou similar) e cadastre a URL para rodar a cada 15 ou 30 minutos.</li>
                  <li>A mesma chamada confere e renova os tokens dos perfis uma vez por dia.</li>
                </ol>
                <p>No plano pago da Vercel dá para usar o Vercel Cron com a variável CRON_SECRET apontando para /api/cron/rules.</p>
              </Help>
              <span className={`pill ${cronKey ? "pill-approved" : "pill-pending"}`}>{cronKey ? "Pronto" : "Falta"}</span>
            </>
          }
        >
          {cronUrl && (
            <div className="flex gap-2 items-start">
              <code className="codebox flex-1">{cronUrl}</code>
              <CopyButton text={cronUrl} />
            </div>
          )}
          <form action={newCronKey}>
            <SubmitButton className={cronKey ? "btn btn-sm" : "btn btn-primary"} pendingText="…" confirm={cronKey ? "Gerar nova chave? A URL antiga para de funcionar." : undefined}>
              {cronKey ? "Gerar nova chave" : "Gerar chave"}
            </SubmitButton>
          </form>
        </Acc>
      </section>
    </div>
  );
}
