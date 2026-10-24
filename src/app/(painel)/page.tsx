import Link from "next/link";
import { hourInTz, resolveRange } from "@/lib/dates";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/money";
import { listObjects } from "@/lib/meta";
import { chartSeries, getContext, groupBy, loadSales, loadSpend, summarize, type SaleLite } from "@/lib/report";
import { PAYMENT_LABEL, paymentKind, platformLabel, type PaymentKind } from "@/lib/sales";
import { nameFromUtm } from "@/lib/utm";
import RangeFilter from "@/components/RangeFilter";
import ProfitStrip from "@/components/ProfitStrip";
import SalesChart from "@/components/SalesChart";
import DashBar from "@/components/DashBar";
import { listDashboards } from "@/lib/dashboards";

type SP = Promise<{ range?: string; since?: string; until?: string; conta?: string; plataforma?: string; produto?: string }>;

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [ctx, dashes] = await Promise.all([getContext({ useDash: true }), listDashboards()]);
  const range = resolveRange(sp, ctx.tz);
  const accounts = sp.conta ? ctx.accounts.filter((a) => a.id === sp.conta) : ctx.accounts;

  const [allSales, spend, accountCampaigns] = await Promise.all([
    loadSales(range, ctx.dash),
    loadSpend(range, accounts, ctx.base, ctx.rates),
    // Filtro por conta: só entram as vendas das campanhas daquela conta
    sp.conta && accounts[0]
      ? listObjects(accounts[0].auth, accounts[0].id, "campaign").then((l) => new Set(l.map((c) => c.id))).catch(() => null)
      : Promise.resolve(null),
  ]);

  const products = [...new Set(allSales.map((s) => s.product_name).filter(Boolean) as string[])].sort();
  const platforms = [...new Set(allSales.map((s) => s.platform))].sort();
  let sales: SaleLite[] = allSales;
  if (accountCampaigns) sales = sales.filter((s) => s.campaign_id && accountCampaigns.has(s.campaign_id));
  if (sp.plataforma) sales = sales.filter((s) => s.platform === sp.plataforma);
  if (sp.produto) sales = sales.filter((s) => s.product_name === sp.produto);

  const s = summarize(sales, ctx.fees, spend.total, range.days);
  const series = chartSeries(range, sales, spend, ctx.fees, ctx.tz);
  const cur = ctx.base;
  const net = s.revenue - s.saleFees;

  const approved = sales.filter((x) => x.status === "approved");
  const sum = (l: SaleLite[]) => l.reduce((a, b) => a + b.gross_base, 0);
  const byProduct = [...groupBy(approved, (x) => x.product_name || "Sem nome")]
    .map(([name, list]) => ({ name, count: list.length, value: sum(list) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const byPlatform = [...groupBy(approved, (x) => x.platform)]
    .map(([p, list]) => ({ p, count: list.length, value: sum(list) }))
    .sort((a, b) => b.value - a.value);
  const bySource = [...groupBy(approved, (x) => (x.utm_source ? nameFromUtm(x.utm_source) : null) || "Sem origem")]
    .map(([name, list]) => ({ name, count: list.length, value: sum(list) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const tracked = approved.filter((x) => x.campaign_id).length;

  // Vendas por forma de pagamento, com taxa de aprovação (aprovadas ÷ geradas)
  const paid = (x: SaleLite) => ["approved", "refunded", "chargeback"].includes(x.status);
  const byPayment = (Object.keys(PAYMENT_LABEL) as PaymentKind[])
    .map((k) => {
      const list = sales.filter((x) => paymentKind(x.payment_method) === k);
      const ok = list.filter((x) => x.status === "approved");
      return { k, total: list.length, count: ok.length, value: sum(ok), rate: list.length ? (list.filter(paid).length / list.length) * 100 : null };
    })
    .filter((p) => p.total > 0);

  const hours = Array(24).fill(0) as number[];
  for (const x of approved) hours[hourInTz(x.created_at, ctx.tz)]++;
  const maxHour = Math.max(...hours, 1);

  const allPaid = sales.filter(paid).length;
  const refundRate = allPaid ? (s.refunded / allPaid) * 100 : null;
  const cbRate = allPaid ? (s.chargebacks / allPaid) * 100 : null;
  const customers = new Set(approved.map((x) => x.customer_email || x.id)).size;

  const problems = ctx.profiles.filter((p) => p.status !== "ok" || (p.expires_at && new Date(p.expires_at).getTime() - Date.now() < 7 * 86400000));
  const keep = { conta: sp.conta, plataforma: sp.plataforma, produto: sp.produto };
  const rangeQs = `range=${range.key}${range.key === "custom" ? `&since=${range.since}&until=${range.until}` : ""}`;
  const filtered = !!(sp.plataforma || sp.produto);

  return (
    <div className="space-y-5">
      <DashBar dashes={dashes} active={ctx.dash} path="/" />
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>{ctx.dash ? ctx.dash.name : "Resumo"}</h1>
          <p className="sub">{range.label}</p>
        </div>
        <RangeFilter range={range} path="/" keep={keep} />
      </header>

      <form method="get" action="/" className="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="range" value={range.key} />
        {range.key === "custom" && (<><input type="hidden" name="since" value={range.since} /><input type="hidden" name="until" value={range.until} /></>)}
        {ctx.accounts.length > 1 && (
          <select className="select !h-[30px] !w-auto max-w-56 text-sm" name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta de anúncio">
            <option value="">Todas as contas</option>
            {ctx.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select className="select !h-[30px] !w-auto text-sm" name="plataforma" defaultValue={sp.plataforma ?? ""} aria-label="Plataforma">
          <option value="">Todas as plataformas</option>
          {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
        </select>
        <select className="select !h-[30px] !w-auto max-w-56 text-sm" name="produto" defaultValue={sp.produto ?? ""} aria-label="Produto">
          <option value="">Todos os produtos</option>
          {products.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-sm">Filtrar</button>
        {(sp.conta || filtered) && <Link className="btn btn-sm" href={`/?${rangeQs}`}>Limpar</Link>}
      </form>

      {!ctx.profiles.length && (
        <p className="notice notice-warn">
          Conecte seu perfil da Meta (token + app) em <Link className="underline" href="/perfis">Perfis Meta</Link> para ver o gasto com anúncios e o lucro real.
        </p>
      )}
      {ctx.profiles.length > 0 && !ctx.accounts.length && (
        <p className="notice notice-warn">
          Ative as contas de anúncio que entram no painel em <Link className="underline" href="/perfis">Perfis Meta</Link>.
        </p>
      )}
      {problems.map((p) => (
        <p key={p.id} className="notice notice-warn">
          Perfil <b>{p.name}</b>: {p.status !== "ok" ? p.last_error ?? "token com erro" : "token vence em breve"}. <Link className="underline" href="/perfis">Resolver</Link>
        </p>
      ))}
      {spend.errors.map((e) => (
        <p key={e} className="notice notice-err">Meta — {e}</p>
      ))}
      {filtered && spend.total > 0 && (
        <p className="text-xs text-muted">O gasto com anúncios é o total das contas: a Meta não separa gasto por plataforma ou produto.</p>
      )}

      <section className="panel panel-pad">
        <ProfitStrip revenue={s.revenue} fees={s.fees} spend={s.spend} profit={s.profit} currency={cur} />
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Faturamento líquido" value={fmtMoney(net, cur)} hint={`bruto ${fmtMoney(s.revenue, cur)}`} />
        <Stat label="Gastos com anúncios" value={fmtMoney(s.spend, cur)} hint={s.adsFees ? `+ ${fmtMoney(s.adsFees, cur)} de impostos` : undefined} tone="spend" />
        <Stat label="ROAS" value={s.roas ? `${fmtNum(s.roas, 2)}x` : "—"} hint={`ROI ${fmtPct(s.roi)}`} />
        <Stat label="Margem" value={fmtPct(s.margin)} hint={`lucro ${fmtMoney(s.profit, cur)}`} tone={s.profit < 0 ? "loss" : undefined} />
        <Stat label="Vendas aprovadas" value={fmtNum(s.approved)} hint={`${fmtNum(customers)} cliente(s)`} />
        <Stat label="CPA" value={s.cpa ? fmtMoney(s.cpa, cur) : "—"} hint="gasto ÷ vendas" />
        <Stat label="Ticket médio" value={s.ticket ? fmtMoney(s.ticket, cur) : "—"} hint={customers ? `ARPU ${fmtMoney(s.revenue / customers, cur)}` : undefined} />
        <Stat label="Vendas pendentes" value={fmtNum(s.pending)} hint={fmtMoney(s.pendingValue, cur)} />
        <Stat label="Reembolsos" value={fmtNum(s.refunded)} hint={`taxa ${fmtPct(refundRate)}`} tone={s.refunded ? "loss" : undefined} />
        <Stat label="Chargebacks" value={fmtNum(s.chargebacks)} hint={`taxa ${fmtPct(cbRate)} · ${fmtMoney(s.refundedValue, cur)} devolvidos`} tone={s.chargebacks ? "loss" : undefined} />
        <Stat label="Taxas e impostos" value={fmtMoney(s.saleFees + s.adsFees, cur)} hint={s.fixed ? `+ ${fmtMoney(s.fixed, cur)} custos fixos` : "das vendas e dos anúncios"} />
        <Stat label="Vendas rastreadas" value={s.approved ? fmtPct((tracked / s.approved) * 100, 0) : "—"} hint="com campanha identificada" />
      </section>

      <section className="panel panel-pad">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2>{range.days === 1 ? "Por hora" : "Por dia"}</h2>
          <div className="flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-info" />Faturamento</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-spend" />Anúncios</span>
            <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 bg-profit" />Lucro</span>
          </div>
        </div>
        <SalesChart data={series} currency={cur} />
      </section>

      <section className="grid md:grid-cols-2 gap-3">
        <div className="panel panel-pad">
          <h2 className="mb-3">Formas de pagamento</h2>
          {byPayment.length ? (
            <table className="tbl">
              <thead><tr><th>Forma</th><th className="r">Aprovadas</th><th className="r">Valor</th><th className="r">Aprovação</th></tr></thead>
              <tbody>
                {byPayment.map((p) => (
                  <tr key={p.k}>
                    <td>{PAYMENT_LABEL[p.k]}</td>
                    <td className="r num">{p.count}<span className="text-muted">/{p.total}</span></td>
                    <td className="r num">{fmtMoney(p.value, cur)}</td>
                    <td className="r num">{fmtPct(p.rate, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sub">Sem vendas no período.</p>
          )}
          <p className="text-xs text-muted mt-2">Aprovação = vendas pagas ÷ vendas geradas (inclui pix/boleto não pagos e cartões recusados).</p>
        </div>

        <div className="panel panel-pad">
          <h2 className="mb-3">Horários das vendas</h2>
          <div className="flex items-end gap-[3px] h-28" role="img" aria-label="Vendas aprovadas por hora do dia">
            {hours.map((n, h) => (
              <div key={h} className="flex-1 flex flex-col items-center justify-end h-full" title={`${String(h).padStart(2, "0")}h: ${n} venda(s)`}>
                <div className="w-full rounded-t bg-info/80" style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[0.7rem] text-muted mt-1"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-3">
        <Bars title="Produtos" items={byProduct} cur={cur} empty="Nenhuma venda aprovada no período." />
        <Bars title="Origem (utm_source)" items={bySource} cur={cur} empty="Sem vendas com origem." />
        <div className="panel panel-pad">
          <h2 className="mb-3">Plataformas</h2>
          {byPlatform.length ? (
            <table className="tbl">
              <tbody>
                {byPlatform.map((p) => (
                  <tr key={p.p}>
                    <td>{platformLabel(p.p)}</td>
                    <td className="r num">{p.count}</td>
                    <td className="r num">{fmtMoney(p.value, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sub">As vendas aparecem aqui assim que o primeiro webhook chegar.</p>
          )}
          <Link href={`/campanhas?${rangeQs}`} className="btn btn-sm mt-4">Ver resultado por campanha</Link>
        </div>
      </section>
    </div>
  );
}

function Bars({ title, items, cur, empty }: { title: string; items: { name: string; count: number; value: number }[]; cur: string; empty: string }) {
  return (
    <div className="panel panel-pad">
      <h2 className="mb-3">{title}</h2>
      {items.length ? (
        <ul className="space-y-2.5">
          {items.map((p) => (
            <li key={p.name}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{p.name}</span>
                <span className="num shrink-0">{fmtMoney(p.value, cur)} <span className="text-muted">· {p.count}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-info" style={{ width: `${(p.value / (items[0].value || 1)) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub">{empty}</p>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "spend" | "loss" }) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="sub">{label}</p>
      <p className={`num text-xl md:text-2xl font-semibold mt-0.5 ${tone === "spend" ? "text-spend" : tone === "loss" ? "neg" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
    </div>
  );
}
