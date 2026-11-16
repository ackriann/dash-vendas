"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdRow } from "@/lib/ads";
import type { DateRange } from "@/lib/dates";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/money";
import { readableLabel, searchLabel } from "@/lib/readable-label";
import SubmitButton from "@/components/SubmitButton";
import { toggleStatus, updateBudget } from "@/app/(painel)/campanhas/actions";

type Child = {
  id: string; name: string; status: string; effective: string;
  budget?: number | null; adsetId?: string;
};
type Details = {
  campaign: { id: string; name: string; objective?: string; status?: string; effective?: string };
  adsets: Child[];
  ads: Child[];
  adsetsTotal: number;
  adsTotal: number;
  fetchedAt: string;
};
type Filter = "all" | "active" | "paused" | "issues";

function tone(row: AdRow): "active" | "paused" | "issues" {
  if (row.status && row.status !== "ACTIVE") return "paused";
  if (row.effective === "ACTIVE") return "active";
  return "issues";
}

function StatusMark({ row }: { row: AdRow }) {
  const state = tone(row);
  const labels = { active: "Veiculando", paused: "Pausada", issues: "Verificar" };
  const classes = {
    active: "text-[#8de0be] bg-[#15382f] border-[#255e47]",
    paused: "text-[#afc6ca] bg-[#243b42] border-[#31515a]",
    issues: "text-[#f1bd91] bg-[#483223] border-[#78553a]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${classes[state]}`}
      title={`Status na Meta: ${row.status || "indefinido"} · Veiculação: ${row.effective || "indefinida"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {labels[state]}
    </span>
  );
}

function currentState(status: string | undefined, effective?: string): string {
  if (status && status !== "ACTIVE") return "Pausado";
  return effective === "ACTIVE" ? "Ativo" : (effective || status || "—").replaceAll("_", " ").toLowerCase();
}

function CampaignDrawer({
  row, currency, timezone, range, close, backHref,
}: {
  row: AdRow; currency: string; timezone: string;
  range: DateRange; close: () => void; backHref: string;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusables = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"
      )).filter((element) => element.getClientRects().length > 0);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [close]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetails(null);
    fetch(`/api/campanhas/detail?campaign=${encodeURIComponent(row.id)}&account=${encodeURIComponent(row.accountId)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha na consulta à Meta");
      return json as Details;
    }).then(setDetails).catch((err) => {
      if (!controller.signal.aborted) setError(String(err?.message ?? err));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [row.id, row.accountId, retry]);

  const changeHref = `${backHref}${backHref.includes("?") ? "&" : "?"}detalhe=${row.id}`;
  const active = row.status === "ACTIVE";
  const campHref = `/campanhas?level=campaign&conta=${encodeURIComponent(row.accountId)}&q=${encodeURIComponent(row.id)}&range=${range.key}${range.key === "custom" ? `&since=${range.since}&until=${range.until}` : ""}&todos=1`;
  const setsHref = `/campanhas?level=adset&conta=${encodeURIComponent(row.accountId)}&parent=${row.id}&range=${range.key}${range.key === "custom" ? `&since=${range.since}&until=${range.until}` : ""}&todos=1`;
  const metrics = [
    ["Gastos", fmtMoney(row.spend, currency)],
    ["Vendas confirmadas", fmtNum(row.sales)],
    ["Faturamento", fmtMoney(row.revenue, currency)],
    ["Lucro sem custos fixos", fmtMoney(row.profit, currency)],
    ["ROAS de vendas", row.spend > 0 ? `${fmtNum(row.revenue / row.spend, 2)}x` : "—"],
    ["CPA de vendas", row.sales ? fmtMoney(row.spend / row.sales, currency) : "—"],
  ];

  return (
    <div className="fixed inset-0 z-[95] flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/65" onClick={close} aria-hidden="true" />
      <section ref={dialog} role="dialog" aria-modal="true" aria-label={`Detalhes da campanha ${readableLabel(row.name)}`}
        className="relative w-full sm:max-w-xl h-full overflow-y-auto bg-[#10242e] shadow-2xl border-l border-line">
        <header className="sticky top-0 z-10 bg-[#10242e] border-b border-line px-4 sm:px-6 py-4 flex items-start gap-3 justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted">Detalhes da campanha · Facebook Ads</p>
            <h2 className="text-lg font-semibold break-words">{readableLabel(row.name)}</h2>
            <p className="text-xs text-muted break-all">ID {row.id} · {readableLabel(row.accountName)}</p>
          </div>
          <button ref={closeButton} type="button" className="btn btn-sm shrink-0" onClick={close} aria-label="Fechar detalhes">Fechar ×</button>
        </header>

        <div className="p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <StatusMark row={row} />
            <span className="text-xs text-muted">Período: {range.label}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {metrics.map(([label, value]) => (
              <div key={label} className="border border-line rounded-lg p-3 min-w-0">
                <p className="text-xs text-muted">{label}</p>
                <p className={`font-semibold num mt-1 text-sm ${label.startsWith("Lucro") && row.profit < 0 ? "neg" : ""}`}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Gastos: Meta convertidos para {currency}. Vendas e faturamento: eventos rastreados pelo Dash Vendas.
            O ROAS pode ser diferente do ROAS atribuído pela Meta.
          </p>

          <div className="rounded-xl border border-line p-4 space-y-3">
            <h3 className="font-semibold">Ações rápidas</h3>
            <form action={toggleStatus}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="account" value={row.accountId} />
              <input type="hidden" name="next" value={active ? "PAUSED" : "ACTIVE"} />
              <input type="hidden" name="back" value={changeHref} />
              <SubmitButton className={`btn btn-sm ${active ? "" : "btn-primary"}`}
                pendingText="Enviando à Meta…"
                confirm={active
                  ? `Pausar a campanha "${readableLabel(row.name)}" na Meta?`
                  : `Ativar a campanha "${readableLabel(row.name)}" na Meta? Confira antes as configurações de veiculação e orçamento.`}>
                {active ? "Pausar campanha" : "Ativar campanha"}
              </SubmitButton>
            </form>

            {row.hasBudget && row.dailyBudget !== null ? (
              <form action={updateBudget} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="account" value={row.accountId} />
                <input type="hidden" name="back" value={changeHref} />
                <label className="field flex-1 min-w-[160px]">
                  <span className="label">Orçamento diário ({row.accountCurrency})</span>
                  <input className="input !h-9 w-full" type="text" name="budget"
                    defaultValue={row.dailyBudget.toFixed(2)} inputMode="decimal"
                    aria-label={`Orçamento diário em ${row.accountCurrency}`} required />
                </label>
                <SubmitButton className="btn btn-sm" pendingText="Salvando…"
                  confirm="Salvar o novo orçamento diário desta campanha na Meta?">
                  Salvar orçamento
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted">
                O orçamento desta campanha está configurado nos conjuntos de anúncios.
                <Link className="underline ml-1" href={setsHref}>Editar conjuntos</Link>
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex justify-between gap-2 items-center">
              <h3 className="font-semibold">Conjuntos e anúncios</h3>
              <button className="btn btn-sm" type="button" onClick={() => setRetry((n) => n + 1)} disabled={loading}>
                {loading ? "Consultando…" : "Atualizar detalhes"}
              </button>
            </div>
            {loading && <p role="status" className="text-sm text-muted">Consultando estrutura e status na Meta…</p>}
            {error && <div className="notice notice-warn text-sm" role="alert">
              Não foi possível carregar a estrutura: {error}
              <button type="button" className="underline ml-2" onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>
            </div>}
            {details && (
              <>
                <p className="text-xs text-muted">
                  Estado atual: {currentState(details.campaign.status, details.campaign.effective)} ·
                  {details.adsetsTotal} conjunto(s) · {details.adsTotal} anúncio(s)
                  {" · "}consulta {new Date(details.fetchedAt).toLocaleString("pt-BR", { timeZone: timezone })}
                </p>
                <details open className="rounded-xl border border-line p-3">
                  <summary className="font-semibold text-sm cursor-pointer">Conjuntos ({details.adsetsTotal})</summary>
                  <ul className="divide-y divide-line mt-2">
                    {details.adsets.map((set) => (
                      <li key={set.id} className="py-2 flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">{readableLabel(set.name)}</p>
                          <p className="text-xs text-muted">ID {set.id}{set.budget != null ? ` · ${fmtMoney(set.budget, row.accountCurrency)}/dia` : ""}</p>
                        </div>
                        <span className="text-xs text-muted shrink-0">{currentState(set.status, set.effective)}</span>
                      </li>
                    ))}
                    {!details.adsets.length && <li className="py-2 text-sm text-muted">Nenhum conjunto encontrado.</li>}
                  </ul>
                  {details.adsetsTotal > details.adsets.length && <p className="text-xs text-muted">Exibindo os primeiros {details.adsets.length} conjuntos.</p>}
                </details>
                <details open className="rounded-xl border border-line p-3">
                  <summary className="font-semibold text-sm cursor-pointer">Anúncios ({details.adsTotal})</summary>
                  <ul className="divide-y divide-line mt-2">
                    {details.ads.map((ad) => (
                      <li key={ad.id} className="py-2 flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">{readableLabel(ad.name)}</p>
                          <p className="text-xs text-muted">ID {ad.id}</p>
                        </div>
                        <span className="text-xs text-muted shrink-0">{currentState(ad.status, ad.effective)}</span>
                      </li>
                    ))}
                    {!details.ads.length && <li className="py-2 text-sm text-muted">Nenhum anúncio encontrado.</li>}
                  </ul>
                  {details.adsTotal > details.ads.length && <p className="text-xs text-muted">Exibindo os primeiros {details.ads.length} anúncios.</p>}
                </details>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Link className="btn btn-primary" href={campHref}>Gerenciar no painel</Link>
            <Link className="btn" href={setsHref}>Ver todos os conjuntos</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function SummaryCampaignClient({
  rows, currency, accountId, timezone, range, backHref, startDetailId, syncedAt, partialErrors,
}: {
  rows: AdRow[]; currency: string; accountId?: string; timezone: string; range: DateRange;
  backHref: string; startDetailId?: string; syncedAt: string; partialErrors: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [show10, setShow10] = useState(false);
  const [selected, setSelected] = useState<AdRow | null>(() =>
    rows.find((row) => row.id === startDetailId) ?? null);
  const [refreshing, startRefresh] = useTransition();
  const active = rows.filter((row) => tone(row) === "active").length;
  const issues = rows.filter((row) => tone(row) === "issues").length;

  const list = useMemo(() => {
    const needle = searchLabel(query.trim());
    return rows.filter((row) => {
      if (filter !== "all" && tone(row) !== filter) return false;
      if (!needle) return true;
      return searchLabel(`${row.name} ${row.id} ${row.accountName} ${row.accountId} ${row.profileName}`)
        .includes(needle);
    });
  }, [rows, filter, query]);
  const pageSize = show10 ? 10 : 5;
  const visible = list.slice(0, pageSize);

  const close = useCallback(() => {
    setSelected(null);
    if (startDetailId) router.replace(backHref, { scroll: false });
  }, [backHref, router, startDetailId]);
  const createHref = `${backHref}${backHref.includes("?") ? "&" : "?"}painel=criar`;
  const allHref = `/campanhas?level=campaign&range=${range.key}${range.key === "custom" ? `&since=${range.since}&until=${range.until}` : ""}${accountId ? `&conta=${encodeURIComponent(accountId)}` : ""}&todos=1`;

  return (
    <section className="panel panel-pad space-y-4" aria-label="Campanhas no Resumo">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2>Campanhas</h2>
          <p className="text-xs text-muted mt-1">Acompanhe e gerencie sem sair do Resumo · {range.label}</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button type="button" className="btn btn-sm" disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
            title="Sincronizar novamente com a Meta">
            {refreshing ? "Atualizando…" : "↻ Atualizar"}
          </button>
          <Link className="btn btn-primary" href={createHref}>+ Criar campanha</Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <label className="relative block flex-1 max-w-lg">
          <span className="sr-only">Pesquisar campanha</span>
          <input type="search" className="input w-full" value={query}
            onChange={(event) => { setQuery(event.target.value); setShow10(false); }}
            placeholder="Buscar campanha, ID ou conta…" />
        </label>
        <div className="flex items-center gap-1 flex-wrap" aria-label="Filtrar por status">
          {([
            ["all", `Todas (${rows.length})`],
            ["active", `Veiculando (${active})`],
            ["paused", "Pausadas"],
            ["issues", `Verificar (${issues})`],
          ] as const).map(([key, label]) => (
            <button type="button" key={key}
              className={`btn btn-sm ${filter === key ? "btn-primary" : ""}`}
              aria-pressed={filter === key}
              onClick={() => { setFilter(key); setShow10(false); }}>{label}</button>
          ))}
        </div>
      </div>

      {partialErrors.length > 0 && (
        <div className="notice notice-warn text-sm" role="alert">
          A Meta não retornou todas as contas. Os resultados podem estar incompletos.
          <details className="mt-1"><summary className="cursor-pointer underline">Ver {partialErrors.length} erro(s)</summary>
            <ul className="mt-2 list-disc pl-5">{partialErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>
          </details>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="tbl w-full min-w-[560px]">
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Status</th>
              <th className="r">Gasto</th>
              <th className="r hidden sm:table-cell">Vendas</th>
              <th className="r">ROAS</th>
              <th className="r">Ação</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const isActive = row.status === "ACTIVE";
              const roas = row.spend > 0 ? `${fmtNum(row.revenue / row.spend, 2)}x` : "—";
              return (
                <tr key={row.id}>
                  <td className="max-w-[240px]">
                    <button type="button" className="text-left w-full hover:underline font-semibold text-sm truncate block"
                      title={readableLabel(row.name)} onClick={() => setSelected(row)}>
                      {readableLabel(row.name)}
                    </button>
                    <p className="text-xs text-muted truncate">{readableLabel(row.accountName)} · {row.id}</p>
                  </td>
                  <td><StatusMark row={row} /></td>
                  <td className="r num text-sm text-spend">{fmtMoney(row.spend, currency)}</td>
                  <td className="r num text-sm hidden sm:table-cell">{fmtNum(row.sales)}</td>
                  <td className="r num text-sm">{roas}</td>
                  <td className="r">
                    <form action={toggleStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="account" value={row.accountId} />
                      <input type="hidden" name="next" value={isActive ? "PAUSED" : "ACTIVE"} />
                      <input type="hidden" name="back" value={backHref} />
                      <SubmitButton className="btn btn-sm" pendingText="Enviando…"
                        confirm={isActive
                          ? `Pausar a campanha "${readableLabel(row.name)}" na Meta?`
                          : `Ativar a campanha "${readableLabel(row.name)}" na Meta? Confirme o orçamento e a veiculação antes.`}>
                        {isActive ? "Pausar" : "Ativar"}
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr>
              <td colSpan={6} className="text-center py-6 text-muted">
                Nenhuma campanha corresponde à pesquisa ou aos filtros.
              </td>
            </tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
        <div className="text-xs text-muted">
          {list.length ? `Exibindo ${visible.length} de ${list.length} campanha(s)` : "Nenhuma campanha"}
          {" · "}Sincronização: {syncedAt} ({timezone})
        </div>
        <div className="flex gap-2 flex-wrap">
          {!show10 && list.length > 5 && (
            <button type="button" className="btn btn-sm"
              onClick={() => setShow10(true)}>Mostrar até 10</button>
          )}
          <Link className="btn btn-sm" href={allHref}>Ver todas as campanhas →</Link>
        </div>
      </div>
      <p className="text-xs text-muted">
        Gastos: Meta Marketing API; vendas e ROAS: vendas confirmadas por campanhas rastreadas.
        Os filtros de plataforma/produto do Resumo não alteram este quadro, que usa período e contas.
        Clique no nome para ver métricas, conjuntos, anúncios e editar.
      </p>

      {selected && <CampaignDrawer key={selected.id} row={selected}
        currency={currency} timezone={timezone} range={range}
        close={close} backHref={backHref} />}
    </section>
  );
}
