import Link from "next/link";
import { env } from "@/lib/env";
import { resolveRange } from "@/lib/dates";
import { fmtMoney, fmtNum } from "@/lib/money";
import { db } from "@/lib/db";
import { getInsights, type InsightRow } from "@/lib/meta";
import { authForAccount, listAccounts } from "@/lib/profiles";
import { listManaged, type ManagedObject } from "@/lib/automacao/meta-ads";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { duplicate, toggleStatus, updateBudget } from "../../campanhas/actions";

type Lv = "campaign" | "adset" | "ad";
type SP = Promise<{ conta?: string; nivel?: string; range?: string; filtro?: string; parent?: string; criadas?: string; ok?: string; erro?: string }>;

const LEVELS: [Lv, string][] = [["campaign", "Campanhas"], ["adset", "Conjuntos"], ["ad", "Anúncios"]];
const CHILD: Record<Lv, Lv | null> = { campaign: "adset", adset: "ad", ad: null };
const RANGES: [string, string][] = [["today", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"]];
const FILTERS: [string, string][] = [["", "Todos"], ["problemas", "Com problemas"], ["revisao", "Em revisão"], ["reprovados", "Reprovados"]];

const EFFECTIVE: Record<string, [string, string]> = {
  ACTIVE: ["Veiculando", "pill-approved"],
  PAUSED: ["Pausado", ""],
  CAMPAIGN_PAUSED: ["Campanha pausada", ""],
  ADSET_PAUSED: ["Conjunto pausado", ""],
  PENDING_REVIEW: ["Em revisão", "pill-pending"],
  IN_PROCESS: ["Processando", "pill-pending"],
  PREAPPROVED: ["Pré-aprovado", "pill-pending"],
  DISAPPROVED: ["Reprovado", "pill-refunded"],
  WITH_ISSUES: ["Com problemas", "pill-refunded"],
  PENDING_BILLING_INFO: ["Falta pagamento", "pill-refunded"],
};

function problems(o: ManagedObject): string[] {
  const out: string[] = [];
  for (const i of o.issues_info ?? []) out.push(i.error_summary || i.error_message || "Problema de publicação");
  for (const v of Object.values(o.ad_review_feedback?.global ?? {})) out.push(String(v));
  return out;
}

export default async function CampanhasPublicadas({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tz = env.timezone;
  const level: Lv = LEVELS.some(([l]) => l === sp.nivel) ? (sp.nivel as Lv) : "campaign";
  const rangeKey = RANGES.some(([k]) => k === sp.range) ? sp.range! : "7d";
  const range = resolveRange({ range: rangeKey }, tz);
  const all = await listAccounts().catch(() => []);
  const accounts = all.filter((a) => a.enabled).length ? all.filter((a) => a.enabled) : all;
  const account = accounts.find((a) => a.id === sp.conta) ?? accounts[0];

  const keep = { conta: account?.id, nivel: level, range: rangeKey, filtro: sp.filtro, parent: sp.parent, criadas: sp.criadas };
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    return `/automacao/campanhas?${p}`;
  };
  const backUrl = qs({});

  if (!account) {
    return (
      <div className="space-y-4">
        <h1>Campanhas publicadas</h1>
        <p className="notice notice-warn">Nenhuma conta de anúncio. Conecte um perfil e ative as contas em <Link className="underline" href="/perfis">Perfis Meta</Link>.</p>
      </div>
    );
  }

  let objects: ManagedObject[] = [];
  let insights: InsightRow[] = [];
  let error: string | null = null;
  try {
    const auth = await authForAccount(account.id);
    [objects, insights] = await Promise.all([
      listManaged(auth, account.id, level),
      getInsights(auth, account.id, level, range.since, range.until).catch(() => [] as InsightRow[]),
    ]);
  } catch (e: any) {
    error = e?.message ?? "Erro na API da Meta";
  }

  // Estruturas criadas pelo módulo (para o filtro "criadas pelo módulo")
  const { data: created } = await db().from("ops_jobs").select("meta_id").in("kind", ["campaign", "adset", "ad"]).eq("status", "done").not("meta_id", "is", null).limit(2000);
  const createdIds = new Set((created ?? []).map((c: any) => c.meta_id));

  const ins = new Map(insights.map((r) => [r.id, r]));
  let list = objects;
  if (sp.parent) list = list.filter((o) => (level === "adset" ? o.campaign_id === sp.parent : o.adset_id === sp.parent));
  if (sp.criadas) list = list.filter((o) => createdIds.has(o.id));
  if (sp.filtro === "problemas") list = list.filter((o) => problems(o).length || ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"].includes(o.effective_status));
  if (sp.filtro === "revisao") list = list.filter((o) => ["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"].includes(o.effective_status));
  if (sp.filtro === "reprovados") list = list.filter((o) => o.effective_status === "DISAPPROVED");
  list = [...list].sort((a, b) => (ins.get(b.id)?.spend ?? 0) - (ins.get(a.id)?.spend ?? 0) || (b.created_time ?? "").localeCompare(a.created_time ?? ""));

  const review = objects.filter((o) => ["PENDING_REVIEW", "IN_PROCESS"].includes(o.effective_status)).length;
  const rejected = objects.filter((o) => o.effective_status === "DISAPPROVED").length;
  const withIssues = objects.filter((o) => problems(o).length || o.effective_status === "WITH_ISSUES").length;
  const spend = list.reduce((s, o) => s + (ins.get(o.id)?.spend ?? 0), 0);
  const purchases = list.reduce((s, o) => s + (ins.get(o.id)?.meta_purchases ?? 0), 0);
  const cur = account.currency;
  const child = CHILD[level];

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Campanhas publicadas</h1>
          <p className="sub">Dados reais da Meta na conta {account.name} · {range.label}</p>
        </div>
        <form method="get" action="/automacao/campanhas" className="flex flex-wrap gap-2">
          <input type="hidden" name="nivel" value={level} />
          <input type="hidden" name="range" value={rangeKey} />
          {accounts.length > 1 && (
            <select className="select !w-auto max-w-64" name="conta" defaultValue={account.id} aria-label="Conta de anúncio">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button className="btn">Abrir</button>
        </form>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? error ?? undefined} />

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Mini label="Investimento" value={fmtMoney(spend, cur)} cls="text-spend" />
        <Mini label="Compras (Meta)" value={fmtNum(purchases)} />
        <Mini label="Custo por compra" value={purchases ? fmtMoney(spend / purchases, cur) : "—"} />
        <Link href={qs({ filtro: "revisao" })} className="panel px-4 py-3 hover:border-[#3b6170]"><p className="sub">Em revisão</p><p className="num text-xl font-semibold text-spend">{review}</p></Link>
        <Link href={qs({ filtro: "problemas" })} className="panel px-4 py-3 hover:border-[#3b6170]"><p className="sub">Reprovados / problemas</p><p className={`num text-xl font-semibold ${rejected + withIssues ? "neg" : ""}`}>{rejected + withIssues}</p></Link>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">{LEVELS.map(([l, label]) => <Link key={l} href={qs({ nivel: l, parent: undefined })} aria-current={level === l ? "true" : undefined}>{label}</Link>)}</div>
        <div className="seg">{RANGES.map(([k, label]) => <Link key={k} href={qs({ range: k })} aria-current={rangeKey === k ? "true" : undefined}>{label}</Link>)}</div>
        <div className="seg">{FILTERS.map(([k, label]) => <Link key={k} href={qs({ filtro: k || undefined })} aria-current={(sp.filtro ?? "") === k ? "true" : undefined}>{label}</Link>)}</div>
        <Link className="btn btn-sm" href={qs({ criadas: sp.criadas ? undefined : "1" })}>{sp.criadas ? "Mostrar todas" : "Só criadas pelo módulo"}</Link>
      </div>
      {sp.parent && <p className="text-sm">Filtrando por <span className="mono">{sp.parent}</span> · <Link className="underline" href={qs({ parent: undefined })}>ver todos</Link></p>}

      <section className="panel overflow-x-auto">
        <table className="tbl min-w-[980px]">
          <thead>
            <tr><th>Status</th><th>Nome</th><th>Veiculação</th><th>Orçamento/dia</th><th className="r">Investimento</th><th className="r">Compras</th><th className="r">Custo/compra</th><th className="r">Cliques</th><th>Problemas</th><th /></tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const r = ins.get(o.id);
              const active = o.status === "ACTIVE";
              const [effLabel, effCls] = EFFECTIVE[o.effective_status] ?? [o.effective_status.toLowerCase().replace(/_/g, " "), ""];
              const probs = problems(o);
              const hasBudget = level !== "ad" && (o.daily_budget || o.lifetime_budget);
              return (
                <tr key={o.id}>
                  <td>
                    <form action={toggleStatus}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="account" value={account.id} />
                      <input type="hidden" name="next" value={active ? "PAUSED" : "ACTIVE"} />
                      <input type="hidden" name="back" value={backUrl} />
                      <SubmitButton className={`pill cursor-pointer ${active ? "pill-approved" : ""}`} pendingText="…" confirm={active ? undefined : `Reativar "${o.name}"?`}>{active ? "Ativo" : "Pausado"}</SubmitButton>
                    </form>
                  </td>
                  <td className="max-w-[280px]">
                    {child ? <Link className="hover:underline block truncate" title={o.name} href={qs({ nivel: child, parent: o.id })}>{o.name}</Link> : <span className="block truncate" title={o.name}>{o.name}</span>}
                    <span className="text-xs text-muted mono">{o.id}{createdIds.has(o.id) ? " · criado pelo módulo" : ""}</span>
                  </td>
                  <td><span className={`pill ${effCls}`}>{effLabel}</span></td>
                  <td>
                    {o.daily_budget ? (
                      <form action={updateBudget} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="account" value={account.id} />
                        <input type="hidden" name="back" value={backUrl} />
                        <input name="budget" defaultValue={(Number(o.daily_budget) / 100).toFixed(2)} className="input !h-8 !w-24 text-sm num" inputMode="decimal" aria-label={`Orçamento diário em ${cur}`} />
                        <SubmitButton className="btn btn-sm" pendingText="…">Salvar</SubmitButton>
                      </form>
                    ) : hasBudget ? (
                      <span className="text-xs text-muted">Total {fmtMoney(Number(o.lifetime_budget) / 100, cur)}</span>
                    ) : (
                      <span className="text-xs text-muted">{level === "ad" ? "—" : level === "adset" ? "na campanha" : "nos conjuntos"}</span>
                    )}
                  </td>
                  <td className="r num text-spend">{r ? fmtMoney(r.spend, cur) : "—"}</td>
                  <td className="r num">{r?.meta_purchases ? fmtNum(r.meta_purchases) : "—"}</td>
                  <td className="r num">{r?.meta_purchases ? fmtMoney(r.spend / r.meta_purchases, cur) : "—"}</td>
                  <td className="r num">{r?.link_clicks ? fmtNum(r.link_clicks) : "—"}</td>
                  <td className="max-w-[260px]">{probs.length ? <span className="text-xs neg block">{probs.join(" · ")}</span> : <span className="text-muted text-xs">—</span>}</td>
                  <td className="r">
                    <form action={duplicate}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="account" value={account.id} />
                      <input type="hidden" name="level" value={level} />
                      <input type="hidden" name="back" value={backUrl} />
                      <SubmitButton className="btn btn-sm" pendingText="…" confirm={`Duplicar "${o.name}"${level !== "ad" ? " com tudo dentro" : ""}? A cópia nasce pausada.`}>Duplicar</SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={10} className="text-center text-muted py-8">{error ? "Não deu para ler a conta." : "Nada encontrado com esses filtros."}</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="sub">Orçamentos na moeda da conta ({cur}). Pausar, reativar, orçamento e duplicar usam a mesma conexão da tela Campanhas.</p>
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
