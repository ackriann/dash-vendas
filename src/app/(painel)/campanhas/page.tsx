import Link from "next/link";
import { resolveRange } from "@/lib/dates";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/money";
import { METRICS, buildAdRows, metric, type AdLevel, type AdRow, type MetricDef, type MetricKey } from "@/lib/ads";
import { getContext } from "@/lib/report";
import RangeFilter from "@/components/RangeFilter";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import ColumnPicker from "@/components/ColumnPicker";
import { duplicate, toggleStatus, updateBudget } from "./actions";

type SP = Promise<{
  range?: string; since?: string; until?: string; level?: string; perfil?: string; conta?: string; parent?: string;
  todos?: string; q?: string; status?: string; ordem?: string; dir?: string; ok?: string; erro?: string;
}>;

const LEVELS: [AdLevel, string][] = [["account", "Contas"], ["campaign", "Campanhas"], ["adset", "Conjuntos"], ["ad", "Anúncios"]];
const CHILD: Record<AdLevel, AdLevel | null> = { account: "campaign", campaign: "adset", adset: "ad", ad: null };

function fmtMetric(m: MetricDef, v: number | null, cur: string): string {
  if (v === null || (v === 0 && m.kind !== "money" && m.kind !== "int")) return "—";
  switch (m.kind) {
    case "money": return fmtMoney(v, cur);
    case "int": return fmtNum(v);
    case "pct": return fmtPct(v, 2);
    case "x": return `${fmtNum(v, 2)}x`;
    default: return fmtNum(v, 2);
  }
}

export default async function Campanhas({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const range = resolveRange(sp, ctx.tz);
  const level: AdLevel = LEVELS.some(([l]) => l === sp.level) ? (sp.level as AdLevel) : "campaign";
  const showAll = sp.todos === "1";
  const sortKey = (METRICS.some((m) => m.key === sp.ordem) ? sp.ordem : "spend") as MetricKey;
  const dir = sp.dir === "asc" ? 1 : -1;

  const keep = { level, perfil: sp.perfil, conta: sp.conta, parent: sp.parent, todos: sp.todos, q: sp.q, status: sp.status, ordem: sp.ordem, dir: sp.dir };
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { range: range.key, since: range.key === "custom" ? range.since : undefined, until: range.key === "custom" ? range.until : undefined, ...keep, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/campanhas?${p}`;
  };
  const backUrl = qs({});

  if (!ctx.accounts.length) {
    return (
      <div className="space-y-4">
        <h1>Campanhas</h1>
        <p className="notice notice-warn">
          {ctx.profiles.length ? "Ative as contas de anúncio" : "Conecte um perfil da Meta (token + app) e ative as contas de anúncio"} em{" "}
          <Link className="underline" href="/perfis">Perfis Meta</Link>.
        </p>
      </div>
    );
  }

  const profilesInUse = ctx.profiles.filter((p) => ctx.accounts.some((a) => a.profile_id === p.id));
  let accounts = ctx.accounts;
  if (sp.perfil) accounts = accounts.filter((a) => a.profile_id === sp.perfil);
  if (sp.conta) accounts = accounts.filter((a) => a.id === sp.conta);
  const accountChoices = sp.perfil ? ctx.accounts.filter((a) => a.profile_id === sp.perfil) : ctx.accounts;

  const { rows, errors, sales } = await buildAdRows(ctx, accounts, level, range);

  let list: AdRow[] = rows;
  if (sp.parent) list = list.filter((r) => (level === "campaign" ? r.accountId === sp.parent : r.parentId === sp.parent));
  if (sp.q) {
    const q = sp.q.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q));
  }
  if (sp.status === "ativos") list = list.filter((r) => r.effective === "ACTIVE");
  else if (sp.status === "pausados") list = list.filter((r) => r.status && r.status !== "ACTIVE");
  if (!showAll && level !== "account") list = list.filter((r) => r.spend > 0 || r.sales > 0 || r.pending > 0 || r.effective === "ACTIVE");
  list.sort((a, b) => ((metric(a, sortKey) ?? -Infinity) - (metric(b, sortKey) ?? -Infinity)) * dir || b.spend - a.spend);

  // Vendas sem campanha identificada (só quando olhando tudo)
  const allAccounts = accounts.length === ctx.accounts.length;
  const untracked = sp.parent || sp.q || !allAccounts ? [] : sales.filter((s) => s.status === "approved" && !s.campaign_id);
  const untrackedRevenue = untracked.reduce((a, b) => a + b.gross_base, 0);

  const tot: AdRow = list.reduce(
    (t, r) => {
      for (const k of ["spend", "impressions", "reach", "clicks", "linkClicks", "lpv", "ic", "api", "metaPurchases", "metaValue", "video3s", "sales", "revenue", "pending", "pendingRevenue", "refunds", "fees", "profit"] as const) t[k] += r[k];
      return t;
    },
    { ...list[0], id: "total", name: "Total", spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, lpv: 0, ic: 0, api: 0, metaPurchases: 0, metaValue: 0, video3s: 0, sales: 0, revenue: 0, pending: 0, pendingRevenue: 0, refunds: 0, fees: 0, profit: 0 } as AdRow,
  );
  const cur = ctx.base;
  const child = CHILD[level];
  const parentName = sp.parent ? (ctx.accounts.find((a) => a.id === sp.parent)?.name ?? null) : null;
  const sortHref = (k: MetricKey) => qs({ ordem: k, dir: sortKey === k && dir === -1 ? "asc" : undefined });
  const multiAccount = accounts.length > 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Campanhas</h1>
          <p className="sub">{range.label} · vendas reais cruzadas com o gasto da Meta</p>
        </div>
        <RangeFilter range={range} path="/campanhas" keep={keep} />
      </header>

      <Notice ok={sp.ok} erro={sp.erro} />
      {errors.map((e) => <p key={e} className="notice notice-err">Meta — {e}</p>)}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {LEVELS.map(([l, label]) => (
            <Link key={l} href={qs({ level: l, parent: undefined, ordem: undefined, dir: undefined })} aria-current={level === l ? "true" : undefined}>{label}</Link>
          ))}
        </div>
        <form method="get" action="/campanhas" className="flex flex-wrap gap-2 items-center">
          {Object.entries({ range: range.key, since: range.key === "custom" ? range.since : undefined, until: range.key === "custom" ? range.until : undefined, level, parent: sp.parent, todos: sp.todos, ordem: sp.ordem, dir: sp.dir })
            .map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          {profilesInUse.length > 1 && (
            <select className="select !h-[30px] !w-auto text-sm" name="perfil" defaultValue={sp.perfil ?? ""} aria-label="Perfil">
              <option value="">Todos os perfis</option>
              {profilesInUse.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {accountChoices.length > 1 && (
            <select className="select !h-[30px] !w-auto max-w-56 text-sm" name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta de anúncio">
              <option value="">Todas as contas</option>
              {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <select className="select !h-[30px] !w-auto text-sm" name="status" defaultValue={sp.status ?? ""} aria-label="Status">
            <option value="">Qualquer status</option>
            <option value="ativos">Ativos</option>
            <option value="pausados">Pausados</option>
          </select>
          <input className="input !h-[30px] !w-44 text-sm" name="q" defaultValue={sp.q} placeholder="Buscar nome ou ID" />
          <button className="btn btn-sm">Filtrar</button>
        </form>
        <div className="flex gap-2 md:ml-auto">
          {level !== "account" && (
            <Link className="btn btn-sm" href={qs({ todos: showAll ? undefined : "1" })}>{showAll ? "Só com resultado" : "Mostrar sem gasto"}</Link>
          )}
          <ColumnPicker storageKey="cols:campanhas" columns={[{ key: "budget", label: "Orçamento", def: true }, ...METRICS]} />
        </div>
      </div>
      {sp.parent && (
        <p className="text-sm">
          Dentro de <b>{parentName ?? rows.find((r) => r.id === sp.parent)?.name ?? sp.parent}</b> ·{" "}
          <Link className="underline" href={qs({ parent: undefined })}>ver todos</Link>
        </p>
      )}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Mini label="Gastos" value={fmtMoney(tot.spend, cur)} cls="text-spend" />
        <Mini label="Vendas" value={fmtNum(tot.sales)} />
        <Mini label="Faturamento" value={fmtMoney(tot.revenue, cur)} />
        <Mini label="ROAS" value={tot.spend ? `${fmtNum(tot.revenue / tot.spend, 2)}x` : "—"} />
        <Mini label="Lucro (sem custos fixos)" value={fmtMoney(tot.profit, cur)} cls={tot.profit < 0 ? "neg" : "pos"} />
      </section>

      <section className="panel overflow-x-auto">
        <table className="tbl min-w-[900px]">
          <thead>
            <tr>
              <th>Status</th>
              <th>Nome</th>
              <th data-c="budget">Orçamento/dia</th>
              {METRICS.map((m) => (
                <th key={m.key} data-c={m.key} className="r" title={m.title}>
                  <Link href={sortHref(m.key)} className="hover:text-ink">
                    {m.label}{sortKey === m.key ? (dir === -1 ? " ↓" : " ↑") : ""}
                  </Link>
                </th>
              ))}
              {level !== "account" && <th />}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const active = r.status === "ACTIVE";
              return (
                <tr key={r.id}>
                  <td>
                    {level === "account" ? (
                      <span className={`pill ${r.effective === "ACTIVE" ? "pill-approved" : ""}`}>{r.effective === "ACTIVE" ? "Veiculando" : "Parada"}</span>
                    ) : r.status ? (
                      <form action={toggleStatus}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="account" value={r.accountId} />
                        <input type="hidden" name="next" value={active ? "PAUSED" : "ACTIVE"} />
                        <input type="hidden" name="back" value={backUrl} />
                        <SubmitButton className={`pill ${active ? "pill-approved" : ""} cursor-pointer`} pendingText="…">
                          {active ? (r.effective === "ACTIVE" ? "Ativo" : r.effective?.toLowerCase().replace(/_/g, " ")) : "Pausado"}
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="pill">—</span>
                    )}
                  </td>
                  <td className="max-w-[300px]">
                    {child ? (
                      <Link href={qs({ level: child, parent: r.id, ordem: undefined, dir: undefined })} className="hover:underline block truncate" title={r.name}>{r.name}</Link>
                    ) : (
                      <span className="block truncate" title={r.name}>{r.name}</span>
                    )}
                    <span className="text-xs text-muted">
                      {level === "account" ? `${r.id.replace("act_", "")} · ${r.profileName}` : multiAccount ? r.accountName : r.id}
                    </span>
                  </td>
                  <td data-c="budget">
                    {r.hasBudget ? (
                      <form action={updateBudget} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="account" value={r.accountId} />
                        <input type="hidden" name="back" value={backUrl} />
                        <input name="budget" defaultValue={r.dailyBudget?.toFixed(2)} className="input !h-8 !w-24 text-sm num" inputMode="decimal" aria-label={`Orçamento diário em ${r.accountCurrency}`} />
                        <SubmitButton className="btn btn-sm" pendingText="…">Salvar</SubmitButton>
                      </form>
                    ) : (
                      <span className="text-muted text-xs">{level === "ad" || level === "account" ? "—" : level === "adset" ? "na campanha" : "nos conjuntos"}</span>
                    )}
                  </td>
                  {METRICS.map((m) => {
                    const v = metric(r, m.key);
                    const cls = m.tone === "spend" ? "text-spend" : m.tone === "signed" ? (v && v < 0 ? "neg" : v && v > 0 ? "pos" : "") : "";
                    return <td key={m.key} data-c={m.key} className={`r num ${cls}`}>{fmtMetric(m, v, cur)}</td>;
                  })}
                  {level !== "account" && (
                    <td className="r">
                      <form action={duplicate}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="account" value={r.accountId} />
                        <input type="hidden" name="level" value={level} />
                        <input type="hidden" name="back" value={backUrl} />
                        <SubmitButton className="btn btn-sm" pendingText="…" confirm={`Duplicar "${r.name}"? A cópia nasce pausada.`}>Duplicar</SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
            {untracked.length > 0 && level !== "account" && (
              <tr>
                <td><span className="pill">—</span></td>
                <td className="text-muted">Vendas sem rastreio <span className="block text-xs">sem UTM com ID da Meta — veja <Link className="underline" href="/utms">UTMs</Link></span></td>
                <td data-c="budget" />
                {METRICS.map((m) => (
                  <td key={m.key} data-c={m.key} className="r num text-muted">
                    {m.key === "sales" ? untracked.length : m.key === "revenue" ? fmtMoney(untrackedRevenue, cur) : ""}
                  </td>
                ))}
                <td />
              </tr>
            )}
            {!list.length && (
              <tr><td colSpan={METRICS.length + 4} className="text-center text-muted py-8">Nada com gasto ou venda neste período.</td></tr>
            )}
          </tbody>
          {list.length > 1 && (
            <tfoot>
              <tr className="font-semibold border-t border-line">
                <td />
                <td>Total ({list.length})</td>
                <td data-c="budget" />
                {METRICS.map((m) => {
                  const v = metric(tot, m.key);
                  return <td key={m.key} data-c={m.key} className={`r num ${m.tone === "signed" && v ? (v < 0 ? "neg" : "pos") : ""}`}>{fmtMetric(m, v, cur)}</td>;
                })}
                {level !== "account" && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      <p className="sub">
        Orçamentos ficam na moeda de cada conta. Lucro = faturamento − taxas − gasto (custos fixos por dia só entram no Resumo).
        A coluna “Compras Meta” mostra o que o pixel atribuiu, para comparar com as vendas reais.
      </p>
    </div>
  );
}

function Mini({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="sub">{label}</p>
      <p className={`num text-xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
