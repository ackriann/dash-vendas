"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import MediaUploader from "@/components/automacao/MediaUploader";
import {
  BID_STRATEGIES, CATALOG_FORMATS, CTAS, EVENTS, FB_POSITIONS, GOALS, IG_POSITIONS, NEEDS_PIXEL, OBJECTIVES, PLATFORMS,
  RECOMMENDED_URL_TAGS, STEP_LABELS, needsBidAmount, validateDraft,
  type AccountLite, type DraftData, type MediaLite, type Named, type PageLite, type Region,
} from "@/lib/automacao/types";
import { publishDraftAction, saveDraftAction } from "../actions";

type Lookups = {
  pixels: { id: string; name: string; last_fired_time?: string }[];
  catalogs: { id: string; name: string; product_count?: number }[];
  instagram: { id: string; username?: string }[];
  audiences: { id: string; name: string; approximate_count_lower_bound?: number }[];
};
const EMPTY: Lookups = { pixels: [], catalogs: [], instagram: [], audiences: [] };

const COUNTRIES: [string, string][] = [
  ["BR", "Brasil"], ["PT", "Portugal"], ["US", "Estados Unidos"], ["MX", "México"], ["AR", "Argentina"], ["CO", "Colômbia"],
  ["CL", "Chile"], ["PE", "Peru"], ["ES", "Espanha"], ["GB", "Reino Unido"], ["CA", "Canadá"], ["DE", "Alemanha"],
  ["FR", "França"], ["IT", "Itália"], ["AU", "Austrália"],
];
const SPECIAL: [string, string][] = [
  ["FINANCIAL_PRODUCTS_SERVICES", "Crédito / serviços financeiros"],
  ["EMPLOYMENT", "Emprego"],
  ["HOUSING", "Moradia"],
  ["ISSUES_ELECTIONS_POLITICS", "Política / eleições"],
];

async function api<T>(op: string, account: string, extra: Record<string, string> = {}): Promise<T> {
  const p = new URLSearchParams({ op, account, ...extra });
  const r = await fetch(`/api/automacao/meta?${p}`, { cache: "no-store" });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.data as T;
}

const label = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] ?? v;

export default function Wizard({
  draftId, initial, initialStep, accounts, pages, pagesFromSync, media: initialMedia,
}: {
  draftId: string;
  initial: DraftData;
  initialStep: number;
  accounts: AccountLite[];
  pages: PageLite[];
  pagesFromSync: boolean;
  media: MediaLite[];
}) {
  const router = useRouter();
  const [d, setD] = useState<DraftData>(initial);
  const [step, setStep] = useState(Math.min(4, Math.max(1, initialStep || 1)));
  const [save, setSave] = useState<{ state: "saved" | "dirty" | "saving" | "error"; at?: string; error?: string }>({ state: "saved" });
  const [look, setLook] = useState<Lookups>(EMPTY);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sets, setSets] = useState<{ id: string; name: string; product_count?: number }[]>([]);
  const [media, setMedia] = useState(initialMedia);
  const [publishing, setPublishing] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const first = useRef(true);

  const errors = useMemo(() => validateDraft(d), [d]);
  const account = accounts.find((a) => a.id === d.accountId);
  const cur = account?.currency ?? "BRL";
  const page = pages.find((p) => p.id === d.creative.pageId);
  const catalog = d.creative.mode === "catalog";

  const setC = (p: Partial<DraftData["campaign"]>) => setD((x) => ({ ...x, campaign: { ...x.campaign, ...p } }));
  const setA = (p: Partial<DraftData["adset"]>) => setD((x) => ({ ...x, adset: { ...x.adset, ...p } }));
  const setCr = (p: Partial<DraftData["creative"]>) => setD((x) => ({ ...x, creative: { ...x.creative, ...p } }));

  // Salva sozinho 1,2 s depois da última alteração
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSave({ state: "dirty" });
    const t = setTimeout(() => doSave(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, step]);

  async function doSave() {
    setSave({ state: "saving" });
    const r = await saveDraftAction(draftId, d, step).catch((e) => ({ ok: false, error: String(e?.message ?? e) }) as const);
    setSave(r.ok ? { state: "saved", at: (r as any).at } : { state: "error", error: (r as any).error });
  }

  // Dados da conta: pixels, catálogos, Instagram, públicos
  useEffect(() => {
    if (!d.accountId) return;
    let alive = true;
    setLoading(true);
    setLookErr(null);
    Promise.allSettled([
      api<Lookups["pixels"]>("pixels", d.accountId),
      api<Lookups["catalogs"]>("catalogs", d.accountId),
      api<Lookups["instagram"]>("instagram", d.accountId),
      api<Lookups["audiences"]>("audiences", d.accountId),
    ]).then((r) => {
      if (!alive) return;
      const v = <T,>(i: number, fb: T) => (r[i].status === "fulfilled" ? (r[i] as PromiseFulfilledResult<T>).value : fb);
      setLook({ pixels: v(0, []), catalogs: v(1, []), instagram: v(2, []), audiences: v(3, []) });
      const failed = r.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason?.message);
      if (failed.length) setLookErr(failed.join(" · "));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [d.accountId]);

  useEffect(() => {
    if (!d.accountId || !d.campaign.catalogId) { setSets([]); return; }
    api<typeof sets>("productsets", d.accountId, { catalog: d.campaign.catalogId }).then(setSets).catch(() => setSets([]));
  }, [d.accountId, d.campaign.catalogId]);

  // Pixel padrão: o único da conta
  useEffect(() => {
    if (!d.adset.pixelId && look.pixels.length === 1) setA({ pixelId: look.pixels[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.pixels]);

  function changeObjective(o: DraftData["campaign"]["objective"]) {
    const goals = GOALS[o];
    setC({ objective: o });
    if (!goals.some(([g]) => g === d.adset.optimizationGoal)) setA({ optimizationGoal: goals[0][0] });
  }

  function setMode(mode: "media" | "catalog") {
    setCr({ mode });
    if (mode === "catalog") changeObjective("OUTCOME_SALES");
  }

  async function publish() {
    setPublishing(true);
    setServerErrors([]);
    const r: { runId?: string; errors?: string[] } = await publishDraftAction(draftId, d).catch((e) => ({ errors: [String(e?.message ?? e)] }));
    if (r.runId) {
      router.push(`/automacao/processos/${r.runId}`);
      return;
    }
    setServerErrors(r.errors ?? ["Falha ao publicar."]);
    setPublishing(false);
  }

  const stepState = (n: 1 | 2 | 3) => (errors[n].length ? "err" : "ok");
  const allErrors = [...errors[1], ...errors[2], ...errors[3]];

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate">{d.campaign.name || "Nova campanha"}</h1>
          <p className="sub">{account ? `${account.name} · ${account.profile_name}` : "Escolha a conta"} · <SaveState s={save} /></p>
        </div>
        <button type="button" className="btn" onClick={doSave} disabled={save.state === "saving"}>Salvar rascunho</button>
      </header>

      <nav className="steps" aria-label="Etapas">
        {STEP_LABELS.map((l, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4;
          const state = n === 4 ? (allErrors.length ? "" : "ok") : stepState(n);
          const sub = n === 4 ? (allErrors.length ? `${allErrors.length} pendência(s)` : "Pronto") : errors[n].length ? `${errors[n].length} pendência(s)` : "Completo";
          return (
            <button key={l} type="button" className="step" data-state={state} aria-current={step === n ? "step" : undefined} onClick={() => setStep(n)}>
              <span className="step-num">{state === "ok" && step !== n ? "✓" : n}</span>
              <span className="min-w-0"><span className="step-label block">{l}</span><span className="step-sub block">{sub}</span></span>
            </button>
          );
        })}
      </nav>

      {lookErr && <p className="notice notice-warn text-sm">Alguns dados da conta não carregaram: {lookErr}</p>}

      {step === 1 && (
        <section className="panel panel-pad grid gap-4">
          <h2>Campanha</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="field">
              <span className="label">Conta de anúncio conectada</span>
              <select className="select" value={d.accountId} onChange={(e) => setD((x) => ({ ...x, accountId: e.target.value, adset: { ...x.adset, pixelId: "", audiences: [], excludedAudiences: [], productSetId: "" }, campaign: { ...x.campaign, catalogId: "" } }))}>
                <option value="">Escolha…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {a.profile_name}{a.enabled ? "" : " (fora do painel)"}{a.account_status && a.account_status !== 1 ? " — não ativa" : ""}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Nome da campanha</span>
              <input className="input" value={d.campaign.name} maxLength={200} onChange={(e) => setC({ name: e.target.value })} placeholder="Ex.: [VENDAS] Produto X — Broad" />
            </label>
          </div>

          <div>
            <span className="label">Tipo de anúncio</span>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="choice"><input type="radio" checked={!catalog} onChange={() => setMode("media")} /><span><b>Imagens e vídeos</b><span className="block text-xs text-muted">Um anúncio para cada mídia escolhida</span></span></label>
              <label className="choice"><input type="radio" checked={catalog} onChange={() => setMode("catalog")} /><span><b>Catálogo</b><span className="block text-xs text-muted">Anúncio dinâmico com os produtos do catálogo</span></span></label>
            </div>
          </div>

          {catalog && (
            <label className="field">
              <span className="label">Catálogo vinculado</span>
              <select className="select" value={d.campaign.catalogId} onChange={(e) => { setC({ catalogId: e.target.value }); setA({ productSetId: "" }); }}>
                <option value="">{loading ? "Carregando…" : look.catalogs.length ? "Escolha…" : "Nenhum catálogo no BM da conta"}</option>
                {look.catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.product_count ?? 0} produto(s)</option>)}
              </select>
              <span className="text-xs text-muted">Gerencie produtos e mídias em <Link className="underline" href="/automacao/catalogos">Catálogos</Link>.</span>
            </label>
          )}

          <div>
            <span className="label">Objetivo</span>
            <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {OBJECTIVES.map(([k, l, sub]) => (
                <label key={k} className="choice" aria-disabled={catalog && k !== "OUTCOME_SALES"}>
                  <input type="radio" name="objective" checked={d.campaign.objective === k} disabled={catalog && k !== "OUTCOME_SALES"} onChange={() => changeObjective(k)} />
                  <span><b>{l}</b><span className="block text-xs text-muted">{sub}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <span className="label">Onde fica o orçamento</span>
              <div className="grid gap-2">
                <label className="choice"><input type="radio" checked={d.campaign.budgetLevel === "adset"} onChange={() => setC({ budgetLevel: "adset" })} /><span><b>No conjunto</b> <span className="text-xs text-muted">(ABO)</span></span></label>
                <label className="choice"><input type="radio" checked={d.campaign.budgetLevel === "campaign"} onChange={() => setC({ budgetLevel: "campaign" })} /><span><b>Na campanha</b> <span className="text-xs text-muted">(Advantage+ / CBO)</span></span></label>
              </div>
            </div>
            <div className="grid gap-3">
              <label className="field">
                <span className="label">Tipo de orçamento</span>
                <select className="select" value={d.campaign.budgetType} onChange={(e) => setC({ budgetType: e.target.value as any })}>
                  <option value="daily">Diário</option>
                  <option value="lifetime">Total (exige data de término)</option>
                </select>
              </label>
              {d.campaign.budgetLevel === "campaign" && (
                <label className="field">
                  <span className="label">Orçamento da campanha ({cur})</span>
                  <MoneyInput value={d.campaign.budget} onChange={(v) => setC({ budget: v })} />
                </label>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="field">
              <span className="label">Estratégia de lance</span>
              <select className="select" value={d.campaign.bidStrategy} onChange={(e) => setC({ bidStrategy: e.target.value })}>
                {BID_STRATEGIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {(needsBidAmount(d.campaign.bidStrategy) || d.campaign.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS") && <span className="text-xs text-muted">O valor do lance/ROAS é definido no conjunto (etapa 2).</span>}
            </label>
            <div>
              <span className="label">Status inicial</span>
              <div className="seg">
                <a href="#" aria-current={d.campaign.status === "PAUSED" ? "true" : undefined} onClick={(e) => { e.preventDefault(); setC({ status: "PAUSED" }); }}>Pausada</a>
                <a href="#" aria-current={d.campaign.status === "ACTIVE" ? "true" : undefined} onClick={(e) => { e.preventDefault(); setC({ status: "ACTIVE" }); }}>Ativa</a>
              </div>
              <p className="text-xs text-muted mt-1">{d.campaign.status === "ACTIVE" ? "Começa a veicular assim que a Meta aprovar." : "Nasce pausada: você ativa quando quiser."}</p>
            </div>
          </div>

          <details>
            <summary className="text-sm text-info">Categoria especial de anúncio {d.campaign.specialCategories.length ? `(${d.campaign.specialCategories.length})` : ""}</summary>
            <div className="flex flex-wrap gap-2 mt-2">
              {SPECIAL.map(([k, l]) => (
                <label key={k} className="choice !py-1.5 text-sm">
                  <input type="checkbox" checked={d.campaign.specialCategories.includes(k)} onChange={(e) => setC({ specialCategories: e.target.checked ? [...d.campaign.specialCategories, k] : d.campaign.specialCategories.filter((x) => x !== k) })} />
                  {l}
                </label>
              ))}
            </div>
          </details>
          <StepErrors list={errors[1]} />
          <StepNav step={step} setStep={setStep} />
        </section>
      )}

      {step === 2 && (
        <section className="panel panel-pad grid gap-4">
          <h2>Conjunto de anúncios</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="field"><span className="label">Nome do conjunto</span><input className="input" value={d.adset.name} maxLength={200} onChange={(e) => setA({ name: e.target.value })} placeholder="Ex.: BR · 25-55 · Advantage+" /></label>
            <label className="field">
              <span className="label">Meta de otimização</span>
              <select className="select" value={d.adset.optimizationGoal} onChange={(e) => setA({ optimizationGoal: e.target.value })}>
                {GOALS[d.campaign.objective].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>

          {(NEEDS_PIXEL.has(d.adset.optimizationGoal) || catalog) && (
            <div className="grid md:grid-cols-2 gap-3">
              <label className="field">
                <span className="label">Pixel</span>
                <select className="select" value={d.adset.pixelId} onChange={(e) => setA({ pixelId: e.target.value })}>
                  <option value="">{loading ? "Carregando…" : look.pixels.length ? "Escolha…" : "Nenhum pixel na conta"}</option>
                  {look.pixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}{p.last_fired_time ? "" : " (sem eventos)"}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">Evento de conversão</span>
                <select className="select" value={d.adset.event} onChange={(e) => setA({ event: e.target.value })}>
                  {EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
          )}

          {catalog && (
            <label className="field">
              <span className="label">Conjunto de produtos</span>
              <select className="select" value={d.adset.productSetId} onChange={(e) => setA({ productSetId: e.target.value })}>
                <option value="">{d.campaign.catalogId ? (sets.length ? "Escolha…" : "Carregando…") : "Escolha o catálogo na etapa 1"}</option>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.product_count ?? 0} produto(s)</option>)}
              </select>
            </label>
          )}

          <div className="grid md:grid-cols-3 gap-3">
            {d.campaign.budgetLevel === "adset" && (
              <label className="field"><span className="label">Orçamento {d.campaign.budgetType === "daily" ? "diário" : "total"} ({cur})</span><MoneyInput value={d.adset.budget} onChange={(v) => setA({ budget: v })} /></label>
            )}
            {needsBidAmount(d.campaign.bidStrategy) && (
              <label className="field"><span className="label">{d.campaign.bidStrategy === "COST_CAP" ? "Custo por resultado alvo" : "Limite de lance"} ({cur})</span><MoneyInput value={d.adset.bidAmount} onChange={(v) => setA({ bidAmount: v })} /></label>
            )}
            {d.campaign.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (
              <label className="field"><span className="label">ROAS mínimo (ex.: 2,5)</span><MoneyInput value={d.adset.roasFloor} onChange={(v) => setA({ roasFloor: v })} /></label>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="field"><span className="label">Início (fuso da conta) — vazio = agora</span><input className="input" type="datetime-local" value={d.adset.startTime} onChange={(e) => setA({ startTime: e.target.value })} /></label>
            <label className="field"><span className="label">Término {d.campaign.budgetType === "lifetime" ? "" : "(opcional)"}</span><input className="input" type="datetime-local" value={d.adset.endTime} onChange={(e) => setA({ endTime: e.target.value })} /></label>
          </div>

          <fieldset className="grid gap-3 border-t border-line pt-4">
            <legend className="font-semibold">Público-alvo</legend>
            <div>
              <span className="label">Países</span>
              <div className="flex flex-wrap gap-1.5">
                {COUNTRIES.map(([k, l]) => (
                  <button key={k} type="button" className={`pill cursor-pointer ${d.adset.countries.includes(k) ? "pill-info" : ""}`} onClick={() => setA({ countries: d.adset.countries.includes(k) ? d.adset.countries.filter((x) => x !== k) : [...d.adset.countries, k] })}>{l}</button>
                ))}
                {d.adset.countries.filter((c) => !COUNTRIES.some(([k]) => k === c)).map((c) => (
                  <span key={c} className="chip">{c}<button type="button" onClick={() => setA({ countries: d.adset.countries.filter((x) => x !== c) })} aria-label={`Remover ${c}`}>×</button></span>
                ))}
                <OtherCountry onAdd={(c) => !d.adset.countries.includes(c) && setA({ countries: [...d.adset.countries, c] })} />
              </div>
            </div>
            <SearchChips<Region>
              title="Regiões / estados"
              hint="Para segmentar só alguns estados, tire o país correspondente da lista acima."
              account={d.accountId}
              op="regions"
              extra={d.adset.countries.length === 1 ? { country: d.adset.countries[0] } : {}}
              value={d.adset.regions}
              idOf={(r) => r.key}
              nameOf={(r) => `${r.name}${r.country ? ` (${r.country})` : ""}`}
              onChange={(regions) => setA({ regions })}
            />
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="field"><span className="label">Idade mínima</span><input className="input num" type="number" min={13} max={65} value={d.adset.ageMin} onChange={(e) => setA({ ageMin: Number(e.target.value) })} /></label>
              <label className="field"><span className="label">Idade máxima</span><input className="input num" type="number" min={13} max={65} value={d.adset.ageMax} onChange={(e) => setA({ ageMax: Number(e.target.value) })} /></label>
              <label className="field"><span className="label">Gênero</span>
                <select className="select" value={d.adset.genders} onChange={(e) => setA({ genders: e.target.value as any })}>
                  <option value="all">Todos</option><option value="male">Homens</option><option value="female">Mulheres</option>
                </select>
              </label>
            </div>
            <SearchChips<Named>
              title="Interesses (segmentação detalhada)"
              account={d.accountId}
              op="interests"
              value={d.adset.interests}
              idOf={(i) => i.id}
              nameOf={(i) => i.name}
              onChange={(interests) => setA({ interests })}
            />
            <div className="grid md:grid-cols-2 gap-3">
              <AudiencePick title="Públicos personalizados (incluir)" list={look.audiences} value={d.adset.audiences} onChange={(audiences) => setA({ audiences })} />
              <AudiencePick title="Excluir públicos" list={look.audiences} value={d.adset.excludedAudiences} onChange={(excludedAudiences) => setA({ excludedAudiences })} />
            </div>
            <label className="choice">
              <input type="checkbox" checked={d.adset.advantageAudience} onChange={(e) => setA({ advantageAudience: e.target.checked })} />
              <span><b>Público Advantage+</b><span className="block text-xs text-muted">A Meta pode ir além da segmentação quando achar melhor desempenho (idade e interesses viram sugestões).</span></span>
            </label>
          </fieldset>

          <fieldset className="grid gap-3 border-t border-line pt-4">
            <legend className="font-semibold">Posicionamentos</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="choice"><input type="radio" checked={d.adset.placements === "auto"} onChange={() => setA({ placements: "auto" })} /><span><b>Advantage+ (automático)</b><span className="block text-xs text-muted">Recomendado pela Meta</span></span></label>
              <label className="choice"><input type="radio" checked={d.adset.placements === "manual"} onChange={() => setA({ placements: "manual" })} /><span><b>Manual</b><span className="block text-xs text-muted">Escolha plataformas e posições</span></span></label>
            </div>
            {d.adset.placements === "manual" && (
              <div className="grid md:grid-cols-3 gap-3">
                <CheckList title="Plataformas" options={PLATFORMS} value={d.adset.platforms} onChange={(platforms) => setA({ platforms })} />
                {d.adset.platforms.includes("facebook") && <CheckList title="Facebook" options={FB_POSITIONS} value={d.adset.fbPositions} onChange={(fbPositions) => setA({ fbPositions })} />}
                {d.adset.platforms.includes("instagram") && <CheckList title="Instagram" options={IG_POSITIONS} value={d.adset.igPositions} onChange={(igPositions) => setA({ igPositions })} />}
              </div>
            )}
          </fieldset>
          <StepErrors list={errors[2]} />
          <StepNav step={step} setStep={setStep} />
        </section>
      )}

      {step === 3 && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
          <section className="panel panel-pad grid gap-4 min-w-0">
            <h2>Criativos</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="field">
                <span className="label">Página do Facebook</span>
                <select className="select" value={d.creative.pageId} onChange={(e) => {
                  const pg = pages.find((p) => p.id === e.target.value);
                  setCr({ pageId: e.target.value, instagramId: pg?.instagram_id ?? "" });
                }}>
                  <option value="">Escolha…</option>
                  {pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.ads_limit ? ` · ${p.ads_running ?? 0}/${p.ads_limit} anúncios` : ""}</option>)}
                </select>
                <span className="text-xs text-muted">
                  {pagesFromSync ? "Páginas liberadas em " : "Mostrando as Páginas das conexões. Sincronize em "}
                  <Link className="underline" href="/automacao/fanpages">FanPages</Link>{pagesFromSync ? "." : " para ver limites e escolher quais aparecem."}
                </span>
              </label>
              <label className="field">
                <span className="label">Instagram</span>
                <select className="select" value={d.creative.instagramId} onChange={(e) => setCr({ instagramId: e.target.value })}>
                  <option value="">Usar a Página (sem perfil do Instagram)</option>
                  {page?.instagram_id && <option value={page.instagram_id}>@{page.instagram_username ?? page.instagram_id} (ligado à Página)</option>}
                  {look.instagram.filter((i) => i.id !== page?.instagram_id).map((i) => <option key={i.id} value={i.id}>@{i.username ?? i.id}</option>)}
                </select>
              </label>
            </div>
            {page?.ads_limit && (page.ads_running ?? 0) >= page.ads_limit * 0.9 && (
              <p className="notice notice-warn text-sm">A Página {page.name} está perto do limite de anúncios ({page.ads_running}/{page.ads_limit}). Novos anúncios podem ficar parados.</p>
            )}

            {!catalog ? (
              <div className="grid gap-2">
                <span className="label">Imagens e vídeos ({d.creative.mediaIds.length} escolhida(s) — um anúncio para cada)</span>
                <MediaUploader compact onUploaded={(m) => { setMedia((l) => [m, ...l]); setCr({ mediaIds: [...d.creative.mediaIds, m.id] }); }} />
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[300px] overflow-y-auto pr-1">
                  {media.map((m) => {
                    const on = d.creative.mediaIds.includes(m.id);
                    return (
                      <button key={m.id} type="button" className="media-tile" aria-pressed={on} title={m.name}
                        onClick={() => setCr({ mediaIds: on ? d.creative.mediaIds.filter((x) => x !== m.id) : [...d.creative.mediaIds, m.id] })}>
                        {m.kind === "image" ? <img src={m.public_url} alt={m.name} loading="lazy" /> : <video src={m.public_url} muted preload="metadata" />}
                        <span className="media-badge">{m.kind === "image" ? "IMG" : "VÍDEO"}</span>
                        {on && <span className="media-check">{d.creative.mediaIds.indexOf(m.id) + 1}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <label className="field">
                <span className="label">Apresentação do catálogo</span>
                <select className="select" value={d.creative.catalogFormat} onChange={(e) => setCr({ catalogFormat: e.target.value })}>
                  {CATALOG_FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span className="text-xs text-muted">As imagens e vídeos vêm dos produtos do catálogo. Use {"{{product.name}}"} e {"{{product.current_price}}"} nos textos.</span>
              </label>
            )}

            <label className="field">
              <span className="label">Texto principal ({d.creative.message.length}/2200)</span>
              <textarea className="textarea" rows={5} value={d.creative.message} onChange={(e) => setCr({ message: e.target.value })} />
            </label>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="field"><span className="label">Título</span><input className="input" value={d.creative.headline} maxLength={255} onChange={(e) => setCr({ headline: e.target.value })} /></label>
              <label className="field"><span className="label">Descrição</span><input className="input" value={d.creative.description} maxLength={255} onChange={(e) => setCr({ description: e.target.value })} /></label>
              <label className="field"><span className="label">Botão (CTA)</span>
                <select className="select" value={d.creative.cta} onChange={(e) => setCr({ cta: e.target.value })}>{CTAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label className="field"><span className="label">URL de destino</span><input className="input" type="url" value={d.creative.url} onChange={(e) => setCr({ url: e.target.value.trim() })} placeholder="https://" /></label>
            </div>
            <label className="field">
              <span className="label flex items-center justify-between gap-2">Parâmetros de URL (UTMs)
                <button type="button" className="text-info text-xs" onClick={() => setCr({ urlTags: RECOMMENDED_URL_TAGS })}>Usar padrão do painel</button>
              </span>
              <input className="input mono" value={d.creative.urlTags} onChange={(e) => setCr({ urlTags: e.target.value.trim() })} />
              <span className="text-xs text-muted">O padrão do painel liga cada venda à campanha, conjunto e anúncio (mesmo formato da tela UTMs).</span>
            </label>
            <label className="field">
              <span className="label">Nome dos anúncios</span>
              <input className="input" value={d.creative.adName} onChange={(e) => setCr({ adName: e.target.value })} />
              <span className="text-xs text-muted">{"{midia}"} = nome do arquivo · {"{n}"} = número do anúncio</span>
            </label>
            <StepErrors list={errors[3]} />
            <StepNav step={step} setStep={setStep} />
          </section>

          <Preview d={d} page={page} media={media} />
        </div>
      )}

      {step === 4 && (
        <section className="grid gap-4">
          <Summary title="Campanha" onEdit={() => setStep(1)} rows={[
            ["Conta", account ? `${account.name} (${account.id})` : "—"],
            ["Nome", d.campaign.name || "—"],
            ["Tipo", catalog ? "Catálogo" : "Imagens e vídeos"],
            ["Objetivo", label(OBJECTIVES.map(([k, l]) => [k, l] as [string, string]), d.campaign.objective)],
            ["Orçamento", d.campaign.budgetLevel === "campaign" ? `Na campanha · ${d.campaign.budgetType === "daily" ? "diário" : "total"} ${money(d.campaign.budget, cur)}` : `No conjunto · ${d.campaign.budgetType === "daily" ? "diário" : "total"}`],
            ["Lance", label(BID_STRATEGIES, d.campaign.bidStrategy)],
            ["Status inicial", d.campaign.status === "ACTIVE" ? "Ativa" : "Pausada"],
            ...(catalog ? [["Catálogo", look.catalogs.find((c) => c.id === d.campaign.catalogId)?.name ?? d.campaign.catalogId] as [string, string]] : []),
          ]} />
          <Summary title="Conjunto" onEdit={() => setStep(2)} rows={[
            ["Nome", d.adset.name || "—"],
            ["Otimização", label(GOALS[d.campaign.objective], d.adset.optimizationGoal)],
            ...(d.adset.pixelId ? [["Pixel / evento", `${look.pixels.find((p) => p.id === d.adset.pixelId)?.name ?? d.adset.pixelId} · ${label(EVENTS, d.adset.event)}`] as [string, string]] : []),
            ...(d.campaign.budgetLevel === "adset" ? [["Orçamento", money(d.adset.budget, cur)] as [string, string]] : []),
            ...(needsBidAmount(d.campaign.bidStrategy) ? [["Lance", money(d.adset.bidAmount, cur)] as [string, string]] : []),
            ["Programação", `${d.adset.startTime ? d.adset.startTime.replace("T", " ") : "Agora"} → ${d.adset.endTime ? d.adset.endTime.replace("T", " ") : "sem término"}`],
            ["Locais", [...d.adset.countries, ...d.adset.regions.map((r) => r.name)].join(", ") || "—"],
            ["Público", `${d.adset.ageMin}–${d.adset.ageMax} · ${d.adset.genders === "all" ? "todos" : d.adset.genders === "male" ? "homens" : "mulheres"}${d.adset.interests.length ? ` · ${d.adset.interests.length} interesse(s)` : ""}${d.adset.audiences.length ? ` · ${d.adset.audiences.length} público(s)` : ""}${d.adset.advantageAudience ? " · Advantage+" : ""}`],
            ["Posicionamentos", d.adset.placements === "auto" ? "Advantage+ (automático)" : d.adset.platforms.map((p) => label(PLATFORMS, p)).join(", ")],
          ]} />
          <Summary title="Criativos" onEdit={() => setStep(3)} rows={[
            ["Página", page?.name ?? "—"],
            ["Instagram", d.creative.instagramId ? (look.instagram.find((i) => i.id === d.creative.instagramId)?.username ?? page?.instagram_username ?? d.creative.instagramId) : "Usar a Página"],
            [catalog ? "Apresentação" : "Anúncios", catalog ? label(CATALOG_FORMATS, d.creative.catalogFormat) : `${d.creative.mediaIds.length} (um por mídia)`],
            ["Botão / destino", `${label(CTAS, d.creative.cta)} → ${d.creative.url || "—"}`],
            ["UTMs", d.creative.urlTags || "—"],
          ]} />

          {(allErrors.length > 0 || serverErrors.length > 0) && (
            <div className="notice notice-err">
              <p className="font-semibold mb-1">Antes de publicar, resolva:</p>
              <ul className="list-disc pl-5 text-sm space-y-0.5">{[...allErrors, ...serverErrors].map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          <div className="panel panel-pad space-y-3">
            <h2>O que vai acontecer</h2>
            <ol className="text-sm text-muted list-decimal pl-5 space-y-0.5">
              <li>Criação da campanha e do conjunto na conta {account?.name}.</li>
              {!catalog && <li>Upload de {d.creative.mediaIds.length} mídia(s) para a conta (as já enviadas antes são reaproveitadas).</li>}
              <li>Criação de {catalog ? 1 : d.creative.mediaIds.length} criativo(s) e anúncio(s), com status {d.campaign.status === "ACTIVE" ? "ativo" : "pausado"}.</li>
              <li>Acompanhamento da revisão da Meta até aprovar ou apontar problema.</li>
            </ol>
            <p className="text-xs text-muted">Cada etapa aparece na tela de processamento. Se cair a conexão ou você recarregar, nada é criado em dobro.</p>
            <button type="button" className="btn btn-primary" disabled={publishing || allErrors.length > 0} onClick={publish}>
              {publishing ? "Validando e enviando…" : "Publicar na Meta"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Peças menores

function money(v: number | null, cur: string) {
  if (v === null || v === undefined || !(Number(v) > 0)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(Number(v));
}

function SaveState({ s }: { s: { state: string; at?: string; error?: string } }) {
  if (s.state === "saving") return <span>salvando…</span>;
  if (s.state === "dirty") return <span>alterações não salvas</span>;
  if (s.state === "error") return <span className="neg">não salvou: {s.error}</span>;
  return <span>rascunho salvo{s.at ? ` às ${new Date(s.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>;
}

function MoneyInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value).replace(".", ","));
  return (
    <input
      className="input num"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(/\./g, "").replace(",", "."));
        onChange(e.target.value.trim() && Number.isFinite(n) ? n : null);
      }}
    />
  );
}

function StepErrors({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <ul className="notice notice-warn text-sm list-disc pl-8 space-y-0.5">{list.map((e) => <li key={e}>{e}</li>)}</ul>
  );
}

function StepNav({ step, setStep }: { step: number; setStep: (n: number) => void }) {
  return (
    <div className="flex justify-between gap-2 pt-1">
      <button type="button" className="btn" disabled={step === 1} onClick={() => setStep(step - 1)}>← Voltar</button>
      <button type="button" className="btn btn-primary" onClick={() => { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        {step === 3 ? "Revisar" : "Continuar"} →
      </button>
    </div>
  );
}

function CheckList({ title, options, value, onChange }: { title: string; options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <span className="label">{title}</span>
      <div className="grid gap-1">
        {options.map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
            {l}
          </label>
        ))}
      </div>
    </div>
  );
}

function OtherCountry({ onAdd }: { onAdd: (c: string) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex gap-1">
      <input className="input !h-7 !w-20 text-xs uppercase" maxLength={2} placeholder="Outro" value={v} onChange={(e) => setV(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (v.length === 2) { onAdd(v); setV(""); } } }} aria-label="Código do país (2 letras)" />
      {v.length === 2 && <button type="button" className="btn btn-sm !h-7" onClick={() => { onAdd(v); setV(""); }}>+</button>}
    </span>
  );
}

function SearchChips<T>({ title, hint, account, op, extra = {}, value, idOf, nameOf, onChange }: {
  title: string; hint?: string; account: string; op: string; extra?: Record<string, string>;
  value: T[]; idOf: (t: T) => string; nameOf: (t: T) => string; onChange: (v: T[]) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<T[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const extraKey = JSON.stringify(extra);
  useEffect(() => {
    if (q.trim().length < 2 || !account) { setRes([]); return; }
    const t = setTimeout(() => {
      api<T[]>(op, account, { q, ...JSON.parse(extraKey) }).then((r) => { setRes(r); setErr(null); }).catch((e) => setErr(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [q, account, op, extraKey]);
  return (
    <div className="relative">
      <span className="label">{title}</span>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((v) => <span key={idOf(v)} className="chip">{nameOf(v)}<button type="button" onClick={() => onChange(value.filter((x) => idOf(x) !== idOf(v)))} aria-label={`Remover ${nameOf(v)}`}>×</button></span>)}
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={account ? "Digite para pesquisar…" : "Escolha a conta primeiro"} disabled={!account} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
      {err && <span className="text-xs neg block">{err}</span>}
      {res.length > 0 && (
        <ul className="panel absolute z-20 mt-1 w-full max-h-60 overflow-y-auto p-1">
          {res.filter((r) => !value.some((v) => idOf(v) === idOf(r))).map((r) => (
            <li key={idOf(r)}>
              <button type="button" className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-surface-2 text-sm" onClick={() => { onChange([...value, r]); setQ(""); setRes([]); }}>{nameOf(r)}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AudiencePick({ title, list, value, onChange }: { title: string; list: { id: string; name: string; approximate_count_lower_bound?: number }[]; value: Named[]; onChange: (v: Named[]) => void }) {
  return (
    <label className="field">
      <span className="label">{title}</span>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((v) => <span key={v.id} className="chip">{v.name}<button type="button" onClick={() => onChange(value.filter((x) => x.id !== v.id))} aria-label={`Remover ${v.name}`}>×</button></span>)}
      </div>
      <select className="select" value="" onChange={(e) => { const a = list.find((x) => x.id === e.target.value); if (a) onChange([...value, { id: a.id, name: a.name }]); }}>
        <option value="">{list.length ? "Adicionar…" : "Nenhum público na conta"}</option>
        {list.filter((a) => !value.some((v) => v.id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.approximate_count_lower_bound ? ` · ~${a.approximate_count_lower_bound.toLocaleString("pt-BR")}` : ""}</option>)}
      </select>
    </label>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: [string, string][]; onEdit: () => void }) {
  return (
    <section className="panel panel-pad">
      <div className="flex items-center justify-between mb-2"><h2>{title}</h2><button type="button" className="btn btn-sm" onClick={onEdit}>Editar</button></div>
      <dl className="grid sm:grid-cols-[180px_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></Fragment>))}
      </dl>
    </section>
  );
}

function Preview({ d, page, media }: { d: DraftData; page?: PageLite; media: MediaLite[] }) {
  const [format, setFormat] = useState("MOBILE_FEED_STANDARD");
  const [idx, setIdx] = useState(0);
  const [meta, setMeta] = useState<{ src?: string; error?: string; loading?: boolean }>({});
  const chosen = d.creative.mediaIds.map((id) => media.find((m) => m.id === id)).filter(Boolean) as MediaLite[];
  const m = chosen[Math.min(idx, chosen.length - 1)];
  const catalog = d.creative.mode === "catalog";
  const host = (() => { try { return new URL(d.creative.url).hostname.toUpperCase(); } catch { return "SEUSITE.COM"; } })();

  async function official() {
    setMeta({ loading: true });
    const r = await fetch("/api/automacao/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: d, mediaId: m?.id, format }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e?.message ?? e) }));
    setMeta(r.src ? { src: r.src } : { error: r.error ?? "Falha na prévia" });
  }

  return (
    <aside className="panel panel-pad space-y-3 lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-2">
        <h2>Pré-visualização</h2>
        {chosen.length > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <button type="button" className="btn btn-sm" onClick={() => setIdx((i) => (i - 1 + chosen.length) % chosen.length)} aria-label="Anterior">‹</button>
            {Math.min(idx, chosen.length - 1) + 1}/{chosen.length}
            <button type="button" className="btn btn-sm" onClick={() => setIdx((i) => (i + 1) % chosen.length)} aria-label="Próximo">›</button>
          </div>
        )}
      </div>
      <div className="ad-preview mx-auto">
        <div className="ap-head">
          {page?.picture_url ? <img className="ap-avatar" src={page.picture_url} alt="" /> : <span className="ap-avatar" />}
          <div><b>{page?.name ?? "Sua Página"}</b><div style={{ fontSize: 12, color: "#65676b" }}>Patrocinado</div></div>
        </div>
        <div className="ap-text">{d.creative.message || "Texto principal do anúncio…"}</div>
        <div className="ap-media">
          {catalog ? <span>Produtos do catálogo</span> : m ? (m.kind === "image" ? <img src={m.public_url} alt="" /> : <video src={m.public_url} muted controls />) : <span>Escolha uma mídia</span>}
        </div>
        <div className="ap-foot">
          <div className="min-w-0">
            <div style={{ fontSize: 12, color: "#65676b" }}>{host}</div>
            <div style={{ fontWeight: 600 }} className="truncate">{d.creative.headline || (catalog ? "{{product.name}}" : "Título")}</div>
            {d.creative.description && <div style={{ fontSize: 13, color: "#65676b" }} className="truncate">{d.creative.description}</div>}
          </div>
          {d.creative.cta !== "NO_BUTTON" && <span className="ap-cta">{label(CTAS, d.creative.cta)}</span>}
        </div>
      </div>
      <p className="text-xs text-muted">Simulação do feed. Para ver exatamente como a Meta vai mostrar:</p>
      <div className="flex gap-2">
        <select className="select !h-[34px] text-sm" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Formato da prévia">
          <option value="MOBILE_FEED_STANDARD">Feed Facebook (celular)</option>
          <option value="DESKTOP_FEED_STANDARD">Feed Facebook (computador)</option>
          <option value="INSTAGRAM_STANDARD">Feed Instagram</option>
          <option value="INSTAGRAM_STORY">Stories Instagram</option>
          <option value="INSTAGRAM_REELS">Reels Instagram</option>
        </select>
        <button type="button" className="btn btn-sm !h-[34px]" onClick={official} disabled={meta.loading || !d.accountId || !d.creative.pageId || (!catalog && !m)}>
          {meta.loading ? "Gerando…" : "Prévia da Meta"}
        </button>
      </div>
      {meta.error && <p className="text-xs neg">{meta.error}</p>}
      {meta.src && <iframe src={meta.src} title="Prévia oficial da Meta" className="w-full rounded-lg bg-white" style={{ height: 560, border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups" />}
    </aside>
  );
}
