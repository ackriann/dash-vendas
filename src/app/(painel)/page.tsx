import Link from "next/link";
import { Suspense } from "react";
import Notice from "@/components/Notice";
import SummaryCampaignSlot from "@/components/SummaryCampaignSlot";
import CampaignModal from "@/components/CampaignModal";
import CampaignStatusList from "@/components/CampaignStatusList";
import Criar from "@/app/(painel)/automacao/criar/page";
import Processo from "@/app/(painel)/automacao/processos/[id]/page";
import { resolveRange } from "@/lib/dates";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/money";
import { listObjects } from "@/lib/meta";
import { chartSeries, getContext, groupBy, loadSales, loadSpend, summarize, type SaleLite } from "@/lib/report";
import { PAYMENT_LABEL, paymentKind, platformLabel, type PaymentKind } from "@/lib/sales";
import { nameFromUtm } from "@/lib/utm";
import RangeFilter from "@/components/RangeFilter";
import SummaryQuickFilters from "@/components/SummaryQuickFilters";
import ProfitStrip from "@/components/ProfitStrip";
import SalesChart from "@/components/SalesChart";
import DashBar from "@/components/DashBar";
import { listDashboards } from "@/lib/dashboards";

type SP = Promise<{
  range?: string; since?: string; until?: string; conta?: string; plataforma?: string; produto?: string;
  painel?: string; rascunho?: string; processo?: string; detalhe?: string; ok?: string; erro?: string;
}>;

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

  // Vendas por forma de pagamento, com taxa de aprovação (aprovadas ÷ geradas)
  const paid = (x: SaleLite) => ["approved", "refunded", "chargeback"].includes(x.status);
  const byPayment = (Object.keys(PAYMENT_LABEL) as PaymentKind[])
    .map((k) => {
      const list = sales.filter((x) => paymentKind(x.payment_method) === k);
      const ok = list.filter((x) => x.status === "approved");
      return { k, total: list.length, count: ok.length, value: sum(ok), rate: list.length ? (list.filter(paid).length / list.length) * 100 : null };
    })
    .filter((p) => p.total > 0);

  const allPaid = sales.filter(paid).length;
  const refundRate = allPaid ? (s.refunded / allPaid) * 100 : null;
  const cbRate = allPaid ? (s.chargebacks / allPaid) * 100 : null;
  const customers = new Set(approved.map((x) => x.customer_email || x.id)).size;

  const problems = ctx.profiles.filter((p) => p.status !== "ok" || (p.expires_at && new Date(p.expires_at).getTime() - Date.now() < 7 * 86400000));
  const keep = { conta: sp.conta, plataforma: sp.plataforma, produto: sp.produto };
  const rangeQs = `range=${range.key}${range.key === "custom" ? `&since=${range.since}&until=${range.until}` : ""}`;
  const filtered = !!(sp.plataforma || sp.produto);
  const summaryQuery = new URLSearchParams();
  summaryQuery.set("range", range.key);
  if (range.key === "custom") {
    summaryQuery.set("since", range.since);
    summaryQuery.set("until", range.until);
  }
  if (sp.conta) summaryQuery.set("conta", sp.conta);
  if (sp.plataforma) summaryQuery.set("plataforma", sp.plataforma);
  if (sp.produto) summaryQuery.set("produto", sp.produto);
  const summaryHref = `/?${summaryQuery.toString()}`;
  const openModal = (panel: "criar" | "status", runId?: string) =>
    `${summaryHref}&painel=${panel}${runId ? `&processo=${runId}` : ""}`;
  const panel = sp.painel === "criar" || sp.painel === "status" ? sp.painel : null;

  return (
    <div className="space-y-6">
      <DashBar dashes={dashes} active={ctx.dash} path="/" />
      <header className="space-y-6">
        <h1 className="!text-[32px] !font-bold !tracking-tight">{ctx.dash ? ctx.dash.name : "Resumo"}</h1>
        <RangeFilter range={range} path="/" keep={keep} variant="summary" />
      </header>

      <SummaryQuickFilters range={range.key} since={range.since} until={range.until}
        account={sp.conta} platform={sp.plataforma} product={sp.produto}
        accounts={ctx.accounts.map((a) => ({ id: a.id, label: a.name }))}
        platforms={platforms.map((p) => ({ id: p, label: platformLabel(p) }))}
        products={products.map((p) => ({ id: p, label: p }))} />

      <Notice ok={sp.ok} erro={sp.erro} />

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

      <ProfitStrip revenue={s.revenue} fees={s.fees + s.adsFees + s.fixed} spend={s.spend} profit={s.profit}
        currency={cur} variant="summary" periodLabel={range.label}
        hourlyChart={<SalesChart data={series} currency={cur} />} />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Indicadores do Resumo">
        <Stat label="Faturamento líquido" value={fmtMoney(net, cur)} hint={`bruto ${fmtMoney(s.revenue, cur)}`} />
        <Stat label="Margem" value={fmtPct(s.margin)} tone={s.profit < 0 && s.revenue > 0 ? "loss" : undefined} />
        <Stat label="ROAS" value={s.roas ? `${fmtNum(s.roas, 2)}x` : "—"} hint={`ROI ${fmtPct(s.roi)}`} />
        <Stat label="CPA" value={s.cpa ? fmtMoney(s.cpa, cur) : "—"} />
        <Stat label="Ticket médio" value={s.ticket ? fmtMoney(s.ticket, cur) : "—"} />
        <Stat label="Vendas aprovadas" value={fmtNum(s.approved)} hint={`${fmtNum(customers)} cliente(s)`} />
        <Stat label="Pendentes" value={fmtNum(s.pending)} hint={s.pending ? fmtMoney(s.pendingValue, cur) : undefined} />
        <Stat label="Reembolsos" value={fmtNum(s.refunded)} hint={s.refunded ? `taxa ${fmtPct(refundRate)}` : undefined} />
        <Stat label="Chargebacks" value={fmtNum(s.chargebacks)} hint={s.chargebacks ? `taxa ${fmtPct(cbRate)}` : undefined} />
      </section>

      <Suspense fallback={
        <section className="panel panel-pad space-y-3" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <h2>Campanhas</h2><span className="text-xs text-muted">Sincronizando com a Meta…</span>
          </div>
          <div className="h-36 bg-surface-2 animate-pulse rounded-xl" />
        </section>
      }>
        <SummaryCampaignSlot ctx={ctx} range={range} accountId={sp.conta} sales={allSales}
          backHref={summaryHref} startDetailId={sp.detalhe} />
      </Suspense>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-[24px] border border-[#263139] bg-[#11191d] p-6 min-h-[196px]">
          <h2 className="mb-3 text-[16px] font-semibold">Formas de pagamento</h2>
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
            <EmptySummary icon="card" message="Sem vendas no período." />
          )}
          {byPayment.length > 0 && <p className="text-xs text-muted mt-2">Aprovação = vendas pagas ÷ vendas geradas (inclui pix/boleto não pagos e cartões recusados).</p>}
        </div>

        <Bars title="Produtos" items={byProduct} cur={cur} empty="Nenhuma venda aprovada no período." emptyIcon="package" />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Bars title="Origem (utm_source)" items={bySource} cur={cur} empty="Sem vendas com origem." emptyIcon="globe" />
        <div className="rounded-[24px] border border-[#263139] bg-[#11191d] p-6 min-h-[196px]">
          <h2 className="mb-3 text-[16px] font-semibold">Plataformas</h2>
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
            <EmptySummary icon="plug" message="Aparecem assim que o primeiro webhook chegar." />
          )}
          <Link href={`/campanhas?${rangeQs}`} className="inline-flex items-center justify-center w-full mt-3 text-sm font-semibold text-[#39d9a3] hover:underline">Ver resultado por campanha →</Link>
        </div>
      </section>
      {panel && (
        <CampaignModal title={panel === "criar" ? "Criar campanha" : "Status da publicação"}
          closeHref={summaryHref}>
          {panel === "criar"
            ? <Criar searchParams={Promise.resolve({ rascunho: sp.rascunho, ok: sp.ok, erro: sp.erro })}
                embedded embeddedSurface="resumo" />
            : sp.processo && /^[0-9a-f-]{36}$/i.test(sp.processo)
              ? <Processo params={Promise.resolve({ id: sp.processo })}
                  searchParams={Promise.resolve({})} embedded embeddedSurface="resumo" />
              : <CampaignStatusList hrefFor={(id) => openModal("status", id)} />}
        </CampaignModal>
      )}
    </div>
  );
}

function Bars({ title, items, cur, empty, emptyIcon = "package" }: {
  title: string;
  items: { name: string; count: number; value: number }[];
  cur: string; empty: string;
  emptyIcon?: "card" | "package" | "globe" | "plug";
}) {
  return (
    <div className="rounded-[24px] border border-[#263139] bg-[#11191d] p-6 min-h-[196px]">
      <h2 className="mb-3 text-[16px] font-semibold">{title}</h2>
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
        <EmptySummary icon={emptyIcon} message={empty} />
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "spend" | "loss" }) {
  return (
    <div className="rounded-[24px] border border-[#263139] bg-[#11191d] p-[22px] min-h-[123px]">
      <p className="text-sm text-[#91a8b2]">{label}</p>
      <p className={`num mt-1.5 text-[24px] font-semibold leading-tight ${tone === "spend" ? "text-spend" : tone === "loss" ? "neg" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-[#8298a0] mt-1">{hint}</p>}
    </div>
  );
}

function EmptySummary({ icon, message }: { icon: "card" | "package" | "globe" | "plug"; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[126px] text-center">
      <span className="grid place-items-center h-11 w-11 rounded-full bg-[#1d282e] text-[#8799a1]">
        <svg width="21" height="21" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon === "card" && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></>}
          {icon === "package" && <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/></>}
          {icon === "globe" && <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9M12 3c-3 3-4 6-4 9s1 6 4 9"/></>}
          {icon === "plug" && <><path d="M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v3"/></>}
        </svg>
      </span>
      <p className="text-sm text-[#91a8b2] max-w-[250px]">{message}</p>
    </div>
  );
}
