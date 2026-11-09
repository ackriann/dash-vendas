"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import MediaUploader from "@/components/automacao/MediaUploader";
import {
  BID_STRATEGIES, CATALOG_DEFAULT_DESCRIPTION, CATALOG_DEFAULT_HEADLINE, CATALOG_FORMATS, CTAS, EVENTS, FB_POSITIONS, GOALS, IG_POSITIONS, NEEDS_PIXEL, OBJECTIVES, PLATFORMS,
  RECOMMENDED_URL_TAGS, STEP_LABELS, adsetGroupsFor, adsPerGroup, draftStructure, needsBidAmount, validateDraft,
  type AccountLite, type CatalogAuto, type CatalogPrefs, type DraftData, type MediaLite, type Named, type PageLite, type Region,
} from "@/lib/automacao/types";
import { createCatalogForAccountAction, publishDraftAction, saveDraftAction, saveProductImageAction } from "../actions";

type Lookups = {
  pixels: { id: string; name: string; last_fired_time?: string }[];
  catalogs: { id: string; name: string; product_count?: number }[];
  instagram: { id: string; username?: string }[];
  audiences: { id: string; name: string; approximate_count_lower_bound?: number }[];
};
const EMPTY: Lookups = { pixels: [], catalogs: [], instagram: [], audiences: [] };

type Status = "none" | "ok" | "share" | "own" | "error";
type AccountCheck = {
  accountId: string; name: string; currency: string | null; business: { id: string; name: string } | null;
  pixel: { status: Status; id: string; note: string }; catalog: { status: Status; note: string }; audiences: { status: Status; note: string };
  errors: string[];
};
type Checks = { loading: boolean; error?: string; main?: { businessId: string | null; businessName: string | null }; list: AccountCheck[] };

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
  draftId, initial, initialStep, accounts, pages, pagesFromSync, media: initialMedia, catalogPrefs = {},
}: {
  draftId: string;
  initial: DraftData;
  initialStep: number;
  accounts: AccountLite[];
  pages: PageLite[];
  pagesFromSync: boolean;
  media: MediaLite[];
  catalogPrefs?: CatalogPrefs;
}) {
  const router = useRouter();
  const [d, setD] = useState<DraftData>(initial);
  const [step, setStep] = useState(Math.min(4, Math.max(1, initialStep || 1)));
  const [selectedGroupId, setSelectedGroupId] = useState(initial.adsetGroups?.[0]?.id ?? "1");
  const [save, setSave] = useState<{ state: "saved" | "dirty" | "saving" | "error"; at?: string; error?: string }>({ state: "saved" });
  const [look, setLook] = useState<Lookups>(EMPTY);
  const [lookErr, setLookErr] = useState<string | null>(null);
  const [catalogBusinesses, setCatalogBusinesses] = useState<{ id: string; name: string; relation: "partner" | "owner" }[]>([]);
  const [catalogBusinessError, setCatalogBusinessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sets, setSets] = useState<{ id: string; name: string; product_count?: number }[] | null>([]);
  const [media, setMedia] = useState(initialMedia);
  const [publishing, setPublishing] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const first = useRef(true);
  const [checks, setChecks] = useState<Checks>({ loading: false, list: [] });

  const errors = useMemo(() => validateDraft(d), [d]);
  const account = accounts.find((a) => a.id === d.accountId);
  const cur = account?.currency ?? "BRL";
  const page = pages.find((p) => p.id === d.creative.pageId);
  const catalog = d.creative.mode === "catalog";
  const autoCat = catalog && d.catalog.source === "auto";

  const groups = adsetGroupsFor(d);
  const activeGroup = groups.find((g) => g.id === selectedGroupId) ?? groups[0];
  const activeAdset = activeGroup.settings;
  const structure = draftStructure(d);
  const setC = (p: Partial<DraftData["campaign"]>) => setD((x) => ({ ...x, campaign: { ...x.campaign, ...p } }));
  const setA = (p: Partial<DraftData["adset"]>) => setD((x) => {
    const list = adsetGroupsFor(x).map((g) => g.id === activeGroup.id ? { ...g, settings: { ...g.settings, ...p } } : g);
    return { ...x, adset: list[0].settings, adsetGroups: x.adsetGroups?.length ? list : [] };
  });
  const addAdset = () => {
    if (groups.length >= 30) return;
    const n = Math.max(...groups.map((g) => Number(g.id) || 0)) + 1;
    const id = String(n);
    setD((x) => ({ ...x, adsetGroups: [
      ...adsetGroupsFor(x),
      { id, settings: { ...activeAdset, name: `${activeAdset.name} · ${n}` }, mediaIds: [...activeGroup.mediaIds] },
    ] }));
    setSelectedGroupId(id);
  };
  const removeAdset = () => {
    if (groups.length === 1) return;
    const remaining = groups.filter((g) => g.id !== activeGroup.id);
    setD((x) => ({ ...x, adset: remaining[0].settings, adsetGroups: remaining }));
    setSelectedGroupId(remaining[0].id);
  };
  const assignMediaToGroup = (groupId: string, ids: string[]) => setD((x) => {
    const list = adsetGroupsFor(x).map((g) => g.id === groupId ? { ...g, mediaIds: ids } : g);
    return { ...x, adsetGroups: list };
  });
  const setGroupMedia = (ids: string[]) => assignMediaToGroup(activeGroup.id, ids);
  const setCr = (p: Partial<DraftData["creative"]>) => setD((x) => ({ ...x, creative: { ...x.creative, ...p } }));
  const setK = (p: Partial<CatalogAuto>) => setD((x) => ({ ...x, catalog: { ...x.catalog, ...p } }));

  // Imagem padrão do produto (catálogo automático): a Meta pede pelo menos 500×500
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const chosenMedia = d.creative.mediaIds.map((id) => media.find((m) => m.id === id)).filter(Boolean) as MediaLite[];
  const productImage = media.find((m) => m.id === d.catalog.productImageId && m.kind === "image");
  const productImages = autoCat
    ? [productImage, ...chosenMedia.filter((m) => m.kind === "image"), ...Object.values(d.catalog.images ?? {}).map((id) => media.find((m) => m.id === id))].filter(Boolean) as MediaLite[]
    : [];
  useEffect(() => {
    for (const m of productImages) {
      if (dims[m.id]) continue;
      const img = new Image();
      img.onload = () => setDims((x) => ({ ...x, [m.id]: { w: img.naturalWidth, h: img.naturalHeight } }));
      img.src = m.public_url;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productImages.map((m) => m.id).join()]);
  const coverErrors = autoCat
    ? productImages.filter((m) => dims[m.id] && (dims[m.id].w < 500 || dims[m.id].h < 500)).map((m) => `A imagem ${m.name} tem ${dims[m.id].w}×${dims[m.id].h}; o catálogo pede pelo menos 500×500.`)
    : [];
  function chooseProductImage(id: string) {
    setK({ productImageId: id });
    saveProductImageAction(id).catch(() => {});
  }

  // Uma imagem já selecionada como criativo também serve como capa do
  // catálogo; não obrigue a escolhê-la uma segunda vez.
  // Não substitua uma capa que o usuário já definiu manualmente.
  useEffect(() => {
    if (!autoCat || productImage) return;
    const selectedImage = chosenMedia.find((m) => m.kind === "image");
    if (selectedImage) setK({ productImageId: selectedImage.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCat, d.catalog.productImageId, d.creative.mediaIds, media]);

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

  // BMs que o perfil realmente gerencia e que têm esta conta como cliente/parceira.
  useEffect(() => {
    if (!d.accountId) { setCatalogBusinesses([]); return; }
    let active = true;
    setCatalogBusinesses([]);
    setCatalogBusinessError(null);
    api<{ id: string; name: string; relation: "partner" | "owner" }[]>("catalog_businesses", d.accountId)
      .then((b) => { if (active) setCatalogBusinesses(b); })
      .catch((e) => { if (active) setCatalogBusinessError(String(e?.message ?? e)); });
    return () => { active = false; };
  }, [d.accountId]);

  useEffect(() => {
    if (!d.accountId || !d.campaign.catalogId) { setSets([]); return; }
    setSets(null);
    api<NonNullable<typeof sets>>("productsets", d.accountId, { catalog: d.campaign.catalogId }).then(setSets).catch(() => setSets([]));
  }, [d.accountId, d.campaign.catalogId]);

  // Conferência das contas extras (BM, pixel, catálogo, públicos, moeda)
  const checkKey = JSON.stringify([d.accountId, d.extraAccountIds, d.adset.pixelId, d.creative.mode, d.catalog.source, d.campaign.catalogId, d.adset.audiences.map((a) => a.id), d.adset.excludedAudiences.map((a) => a.id), d.adsetGroups]);
  useEffect(() => {
    if (!d.accountId || !d.extraAccountIds.length) { setChecks({ loading: false, list: [] }); return; }
    let alive = true;
    setChecks((c) => ({ ...c, loading: true, error: undefined }));
    const t = setTimeout(() => {
      fetch("/api/automacao/contas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: d }) })
        .then((r) => r.json())
        .then((j) => alive && setChecks(j.error ? { loading: false, error: j.error, list: [] } : { loading: false, main: j.data.main, list: j.data.checks }))
        .catch((e) => alive && setChecks({ loading: false, error: String(e?.message ?? e), list: [] }));
    }, 700);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  // Pixel padrão: o único da conta
  useEffect(() => {
    if (look.pixels.length !== 1) return;
    const pixelId = look.pixels[0].id;
    setD((x) => {
      const groups = adsetGroupsFor(x);
      if (groups.every((g) => g.settings.pixelId)) return x;
      const updated = groups.map((g) => ({
        ...g, settings: g.settings.pixelId ? g.settings : { ...g.settings, pixelId },
      }));
      return { ...x, adset: updated[0].settings, adsetGroups: x.adsetGroups?.length ? updated : [] };
    });
  }, [look.pixels]);

  function changeObjective(o: DraftData["campaign"]["objective"]) {
    const goals = GOALS[o];
    setD((x) => {
      const groups = adsetGroupsFor(x).map((g) => ({
        ...g,
        settings: goals.some(([goal]) => goal === g.settings.optimizationGoal)
          ? g.settings : { ...g.settings, optimizationGoal: goals[0][0] },
      }));
      return {
        ...x, campaign: { ...x.campaign, objective: o },
        adset: groups[0].settings,
        adsetGroups: x.adsetGroups?.length ? groups : [],
      };
    });
  }

  function setMode(mode: "media" | "catalog") {
    setCr({ mode });
    if (mode === "catalog") {
      changeObjective("OUTCOME_SALES");
      // Preferências da última campanha de catálogo
      const { catalogFormat, delayMinutes: _old, ...prefs } = catalogPrefs;
      setD((x) => (x.catalog.price === null
        ? { ...x, catalog: { ...x.catalog, ...prefs }, creative: { ...x.creative, catalogFormat: catalogFormat ?? x.creative.catalogFormat } }
        : !x.catalog.productImageId && prefs.productImageId ? { ...x, catalog: { ...x.catalog, productImageId: prefs.productImageId } } : x));
    }
  }

  async function publish() {
    setPublishing(true);
    setServerErrors([]);
    const r: { runId?: string; runIds?: string[]; errors?: string[] } = await publishDraftAction(draftId, d).catch((e) => ({ errors: [String(e?.message ?? e)] }));
    if (r.runId) {
      router.push((r.runIds?.length ?? 1) > 1 ? "/automacao/processos" : `/automacao/processos/${r.runId}`);
      return;
    }
    setServerErrors(r.errors ?? ["Falha ao publicar."]);
    setPublishing(false);
  }

  const stepErrors = (n: 1 | 2 | 3) => (n === 3 ? [...errors[3], ...coverErrors] : errors[n]);
  const stepState = (n: 1 | 2 | 3) => (stepErrors(n).length ? "err" : "ok");
  const checkErrors = checks.list.flatMap((c) => c.errors.map((e) => `${c.name}: ${e}`));
  const step3Errors = [...errors[3], ...coverErrors];
  const allErrors = [...errors[1], ...errors[2], ...step3Errors, ...checkErrors];

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
          const sub = n === 4 ? (allErrors.length ? `${allErrors.length} pendência(s)` : "Pronto") : stepErrors(n).length ? `${stepErrors(n).length} pendência(s)` : "Completo";
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
              <span className="label">Conta de anúncio {d.extraAccountIds.length ? "principal" : "conectada"}</span>
              <select className="select" value={d.accountId} onChange={(e) => setD((x) => ({ ...x, accountId: e.target.value, extraAccountIds: x.extraAccountIds.filter((a) => a !== e.target.value), adset: { ...x.adset, pixelId: "", audiences: [], excludedAudiences: [], productSetId: "" },
                    adsetGroups: x.adsetGroups?.map((g) => ({
                      ...g, settings: { ...g.settings, pixelId: "", audiences: [], excludedAudiences: [], productSetId: "" },
                    })) ?? [], catalog: { ...x.catalog, businessId: "" }, campaign: { ...x.campaign, catalogId: "" } }))}>
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

          <ExtraAccounts
            accounts={accounts}
            main={account}
            value={d.extraAccountIds}
            onChange={(extraAccountIds) => setD((x) => ({ ...x, extraAccountIds }))}
          />
          {d.extraAccountIds.length > 0 && <AccountChecks checks={checks} main={account} d={d} pixelName={look.pixels.find((p) => p.id === d.adset.pixelId)?.name} catalogName={autoCat ? "Automático" : look.catalogs.find((c) => c.id === d.campaign.catalogId)?.name} />}

          <div>
            <span className="label">Tipo de anúncio</span>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="choice"><input type="radio" checked={!catalog} onChange={() => setMode("media")} /><span><b>Imagens e vídeos</b><span className="block text-xs text-muted">Um anúncio para cada mídia escolhida</span></span></label>
              <label className="choice"><input type="radio" checked={catalog} onChange={() => setMode("catalog")} /><span><b>Catálogo</b><span className="block text-xs text-muted">Anúncio dinâmico com os produtos do catálogo</span></span></label>
            </div>
          </div>

          {catalog && (
            <div className="grid gap-2">
              {autoCat ? (
                <div className="grid gap-3">
                  <p className="notice notice-ok text-sm">
                    <b>Catálogo automático.</b> O painel usa uma BM parceira do perfil conectado, e não automaticamente a BM proprietária da conta.
                    Na publicação, reutiliza ou cria o catálogo e seus produtos na BM selecionada.
                  </p>
                  <label className="field">
                    <span className="label">BM para criar ou reutilizar o catálogo</span>
                    <select className="select" value={d.catalog.businessId || ""} onChange={(e) => setK({ businessId: e.target.value })}>
                      <option value="">Automático — única BM parceira com acesso</option>
                      {catalogBusinesses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} · {b.id} ({b.relation === "partner" ? "parceira" : "proprietária"})
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted">
                      Se mais de uma BM parceira aparecer, selecione a correta. É necessário ser administrador da BM para criar o catálogo.
                    </span>
                  </label>
                  {catalogBusinessError && <p className="notice notice-warn text-sm">Não foi possível conferir as BMs: {catalogBusinessError}</p>}
                  {catalogBusinesses.length === 0 && !catalogBusinessError && d.accountId && <p className="text-xs text-muted">Verificando BMs disponíveis…</p>}
                </div>
              ) : (
              <div className="field">
              <span className="label">Catálogo vinculado</span>
              <select className="select" aria-label="Catálogo vinculado" value={d.campaign.catalogId} onChange={(e) => { setC({ catalogId: e.target.value }); setA({ productSetId: "" }); }}>
                <option value="">{loading ? "Carregando…" : look.catalogs.length ? "Escolha…" : "Nenhum catálogo no BM da conta — crie abaixo"}</option>
                {look.catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.product_count ?? 0} produto(s)</option>)}
              </select>
              <NewCatalog
                accountId={d.accountId}
                onCreated={(c) => {
                  setLook((l) => ({ ...l, catalogs: [{ id: c.id, name: c.name, product_count: 0 }, ...l.catalogs] }));
                  setC({ catalogId: c.id });
                  setA({ productSetId: "" });
                }}
              />
              <span className="text-xs text-muted">Gerencie produtos e mídias em <Link className="underline" href="/automacao/catalogos">Catálogos</Link>.</span>
            </div>
              )}
              <details open={!autoCat}>
                <summary className="text-sm text-info">Avançado: usar um catálogo que já existe</summary>
                <div className="grid sm:grid-cols-2 gap-2 mt-2">
                  <label className="choice"><input type="radio" checked={autoCat} onChange={() => setK({ source: "auto" })} /><span><b>Automático</b> <span className="text-xs text-muted">(recomendado)</span><span className="block text-xs text-muted">O painel cria catálogo, produtos e conjunto</span></span></label>
                  <label className="choice"><input type="radio" checked={!autoCat} onChange={() => setK({ source: "existing" })} /><span><b>Catálogo existente</b><span className="block text-xs text-muted">Você escolhe o catálogo e o conjunto de produtos</span></span></label>
                </div>
              </details>
            </div>
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
          <h2>Conjuntos de anúncios</h2>
          <div className="rounded-xl border border-line p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">Estrutura: 1 campanha · {structure.adsets} conjunto(s) · {structure.ads} anúncio(s)</p>
                <p className="text-xs text-muted">Cada conjunto possui orçamento, público, posicionamentos e criativos próprios. Nada é multiplicado sem sua configuração.</p>
              </div>
              <button type="button" className="btn btn-sm btn-primary" disabled={groups.length >= 30} onClick={addAdset}>+ Adicionar conjunto</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groups.map((g, i) => (
                <button key={g.id} type="button" className={`btn btn-sm ${activeGroup.id === g.id ? "btn-primary" : ""}`}
                  onClick={() => setSelectedGroupId(g.id)}>
                  {i + 1}. {g.settings.name || "Sem nome"} · {adsPerGroup(d, g)} anúncio(s)
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Editando: {activeGroup.settings.name || "novo conjunto"}</span>
              {groups.length > 1 && <button type="button" className="btn btn-sm btn-danger" onClick={removeAdset}>Remover este conjunto</button>}
            </div>
            {(!catalog || autoCat) && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Criativos deste conjunto ({activeGroup.mediaIds.length})</p>
                <p className="text-xs text-muted">Selecione os arquivos na etapa Criativos. Depois marque quais serão publicados neste conjunto. O mesmo arquivo pode ser usado em vários conjuntos.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => setGroupMedia([...d.creative.mediaIds])}>Selecionar todos</button>
                  <button type="button" className="btn btn-sm" onClick={() => setGroupMedia([])}>Limpar seleção</button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {chosenMedia.map((m) => (
                    <label key={m.id} className="flex gap-2 items-center border border-line rounded-lg p-2 text-sm">
                      <input type="checkbox" checked={activeGroup.mediaIds.includes(m.id)}
                        onChange={(e) => setGroupMedia(e.target.checked ? [...activeGroup.mediaIds, m.id] : activeGroup.mediaIds.filter((id) => id !== m.id))} />
                      <span className="truncate">{m.name}</span>
                    </label>
                  ))}
                </div>
                {!chosenMedia.length && <p className="text-xs text-muted">Ainda não há mídias selecionadas. Vá à etapa Criativos e depois retorne aqui.</p>}
              </div>
            )}
            {autoCat && d.catalog.adsMode === "per_creative" && activeGroup.mediaIds.length > 1 && (
              <p className="notice notice-warn text-sm">Teste de catálogo individual: cada anúncio terá seu próprio conjunto de produtos, mesmo compartilhando este conjunto de anúncios. A API da Meta validará todas as associações antes de criar os anúncios; algumas contas podem rejeitar o formato. Publique inicialmente como Pausada.</p>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="field"><span className="label">Nome do conjunto</span><input className="input" value={activeAdset.name} maxLength={200} onChange={(e) => setA({ name: e.target.value })} placeholder="Ex.: BR · 25-55 · Advantage+" /></label>
            <label className="field">
              <span className="label">Meta de otimização</span>
              <select className="select" value={activeAdset.optimizationGoal} onChange={(e) => setA({ optimizationGoal: e.target.value })}>
                {GOALS[d.campaign.objective].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>

          {(NEEDS_PIXEL.has(activeAdset.optimizationGoal) || catalog) && (
            <div className="grid md:grid-cols-2 gap-3">
              <label className="field">
                <span className="label">Pixel</span>
                <select className="select" value={activeAdset.pixelId} onChange={(e) => setA({ pixelId: e.target.value })}>
                  <option value="">{loading ? "Carregando…" : look.pixels.length ? "Escolha…" : "Nenhum pixel na conta"}</option>
                  {look.pixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}{p.last_fired_time ? "" : " (sem eventos)"}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">Evento de conversão</span>
                <select className="select" value={activeAdset.event} onChange={(e) => setA({ event: e.target.value })}>
                  {EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
          )}

          {autoCat && <p className="text-xs text-muted">Catálogo automático: o conjunto de produtos é criado na publicação, só com os produtos desta campanha.</p>}
          {catalog && !autoCat && (
            <label className="field">
              <span className="label">Conjunto de produtos</span>
              <select className="select" value={activeAdset.productSetId} onChange={(e) => setA({ productSetId: e.target.value })}>
                <option value="">{!d.campaign.catalogId ? "Escolha o catálogo na etapa 1" : sets === null ? "Carregando…" : sets.length ? "Escolha…" : "Nenhum conjunto de produtos — adicione produtos ao catálogo"}</option>
                {(sets ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.product_count ?? 0} produto(s)</option>)}
              </select>
            </label>
          )}

          <div className="grid md:grid-cols-3 gap-3">
            {d.campaign.budgetLevel === "adset" && (
              <label className="field"><span className="label">Orçamento {d.campaign.budgetType === "daily" ? "diário" : "total"} ({cur})</span><MoneyInput value={activeAdset.budget} onChange={(v) => setA({ budget: v })} /></label>
            )}
            {needsBidAmount(d.campaign.bidStrategy) && (
              <label className="field"><span className="label">{d.campaign.bidStrategy === "COST_CAP" ? "Custo por resultado alvo" : "Limite de lance"} ({cur})</span><MoneyInput value={activeAdset.bidAmount} onChange={(v) => setA({ bidAmount: v })} /></label>
            )}
            {d.campaign.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (
              <label className="field"><span className="label">ROAS mínimo (ex.: 2,5)</span><MoneyInput value={activeAdset.roasFloor} onChange={(v) => setA({ roasFloor: v })} /></label>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="field"><span className="label">Início (fuso da conta) — vazio = agora</span><input className="input" type="datetime-local" value={activeAdset.startTime} onChange={(e) => setA({ startTime: e.target.value })} /></label>
            <label className="field"><span className="label">Término {d.campaign.budgetType === "lifetime" ? "" : "(opcional)"}</span><input className="input" type="datetime-local" value={activeAdset.endTime} onChange={(e) => setA({ endTime: e.target.value })} /></label>
          </div>

          <fieldset className="grid gap-3 border-t border-line pt-4">
            <legend className="font-semibold">Público-alvo</legend>
            <div>
              <span className="label">Países</span>
              <div className="flex flex-wrap gap-1.5">
                {COUNTRIES.map(([k, l]) => (
                  <button key={k} type="button" className={`pill cursor-pointer ${activeAdset.countries.includes(k) ? "pill-info" : ""}`} onClick={() => setA({ countries: activeAdset.countries.includes(k) ? activeAdset.countries.filter((x) => x !== k) : [...activeAdset.countries, k] })}>{l}</button>
                ))}
                {activeAdset.countries.filter((c) => !COUNTRIES.some(([k]) => k === c)).map((c) => (
                  <span key={c} className="chip">{c}<button type="button" onClick={() => setA({ countries: activeAdset.countries.filter((x) => x !== c) })} aria-label={`Remover ${c}`}>×</button></span>
                ))}
                <OtherCountry onAdd={(c) => !activeAdset.countries.includes(c) && setA({ countries: [...activeAdset.countries, c] })} />
              </div>
            </div>
            <SearchChips<Region>
              title="Regiões / estados"
              hint="Para segmentar só alguns estados, tire o país correspondente da lista acima."
              account={d.accountId}
              op="regions"
              extra={activeAdset.countries.length === 1 ? { country: activeAdset.countries[0] } : {}}
              value={activeAdset.regions}
              idOf={(r) => r.key}
              nameOf={(r) => `${r.name}${r.country ? ` (${r.country})` : ""}`}
              onChange={(regions) => setA({ regions })}
            />
            <label className="choice">
              <input type="checkbox" checked={activeAdset.advantageAudience} onChange={(e) => setA({ advantageAudience: e.target.checked })} />
              <span><b>Público Advantage+</b><span className="block text-xs text-muted">Como no Gerenciador: a Meta pode ir além da segmentação. Idade, gênero, interesses e públicos viram sugestões; só os controles abaixo são obrigatórios.</span></span>
            </label>
            {activeAdset.advantageAudience && (
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="field">
                  <span className="label">Controle: idade mínima (18 a 25)</span>
                  <input className="input num" type="number" min={18} max={25} value={activeAdset.ageMinControl} onChange={(e) => setA({ ageMinControl: Number(e.target.value) })} />
                </label>
                <p className="sm:col-span-2 text-xs text-muted self-end">Regra da Meta no Público Advantage+: o mínimo obrigatório vai até 25 e o máximo é sempre 65+. Para mirar 45+, use a sugestão de idade abaixo.</p>
              </div>
            )}
            {activeAdset.advantageAudience && <span className="label !mb-0">Sugestão de público (opcional)</span>}
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="field"><span className="label">{activeAdset.advantageAudience ? "Sugestão: idade de" : "Idade mínima"}</span><input className="input num" type="number" min={activeAdset.advantageAudience ? 18 : 13} max={65} value={activeAdset.ageMin} onChange={(e) => setA({ ageMin: Number(e.target.value) })} /></label>
              <label className="field"><span className="label">{activeAdset.advantageAudience ? "Sugestão: idade até" : "Idade máxima"}</span><input className="input num" type="number" min={13} max={65} value={activeAdset.ageMax} onChange={(e) => setA({ ageMax: Number(e.target.value) })} /></label>
              <label className="field"><span className="label">Gênero</span>
                <select className="select" value={activeAdset.genders} onChange={(e) => setA({ genders: e.target.value as any })}>
                  <option value="all">Todos</option><option value="male">Homens</option><option value="female">Mulheres</option>
                </select>
              </label>
            </div>
            <SearchChips<Named>
              title="Interesses (segmentação detalhada)"
              account={d.accountId}
              op="interests"
              value={activeAdset.interests}
              idOf={(i) => i.id}
              nameOf={(i) => i.name}
              onChange={(interests) => setA({ interests })}
            />
            <div className="grid md:grid-cols-2 gap-3">
              <AudiencePick title="Públicos personalizados (incluir)" list={look.audiences} value={activeAdset.audiences} onChange={(audiences) => setA({ audiences })} />
              <AudiencePick title="Excluir públicos" list={look.audiences} value={activeAdset.excludedAudiences} onChange={(excludedAudiences) => setA({ excludedAudiences })} />
            </div>
          </fieldset>

          <fieldset className="grid gap-3 border-t border-line pt-4">
            <legend className="font-semibold">Posicionamentos</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="choice"><input type="radio" checked={activeAdset.placements === "auto"} onChange={() => setA({ placements: "auto" })} /><span><b>Advantage+ (automático)</b><span className="block text-xs text-muted">Recomendado pela Meta</span></span></label>
              <label className="choice"><input type="radio" checked={activeAdset.placements === "manual"} onChange={() => setA({ placements: "manual" })} /><span><b>Manual</b><span className="block text-xs text-muted">Escolha plataformas e posições</span></span></label>
            </div>
            {activeAdset.placements === "manual" && (
              <div className="grid md:grid-cols-3 gap-3">
                <CheckList title="Plataformas" options={PLATFORMS} value={activeAdset.platforms} onChange={(platforms) => setA({ platforms })} />
                {activeAdset.platforms.includes("facebook") && <CheckList title="Facebook" options={FB_POSITIONS} value={activeAdset.fbPositions} onChange={(fbPositions) => setA({ fbPositions })} />}
                {activeAdset.platforms.includes("instagram") && <CheckList title="Instagram" options={IG_POSITIONS} value={activeAdset.igPositions} onChange={(igPositions) => setA({ igPositions })} />}
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
                  <option value="">Automático: Instagram ligado à Página ou a própria Página</option>
                  {page?.instagram_id && <option value={page.instagram_id}>@{page.instagram_username ?? page.instagram_id} (ligado à Página)</option>}
                  {look.instagram.filter((i) => i.id !== page?.instagram_id).map((i) => <option key={i.id} value={i.id}>@{i.username ?? i.id}</option>)}
                </select>
              </label>
            </div>
            {page?.ads_limit && (page.ads_running ?? 0) >= page.ads_limit * 0.9 && (
              <p className="notice notice-warn text-sm">A Página {page.name} está perto do limite de anúncios ({page.ads_running}/{page.ads_limit}). Novos anúncios podem ficar parados.</p>
            )}

            {(!catalog || autoCat) && (
              <div className="grid gap-2">
                <span className="label">
                  {autoCat ? `Vídeos dos produtos (${d.creative.mediaIds.length} escolhido(s))` : `Imagens e vídeos (${d.creative.mediaIds.length} escolhida(s) — um anúncio para cada)`}
                </span>
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
            )}
            {(!catalog || autoCat) && chosenMedia.length > 0 && (d.adsetGroups?.length ?? 0) > 0 && (
              <div className="border border-line rounded-xl p-3 space-y-3">
                <div>
                  <p className="font-semibold">Distribuir criativos entre os conjuntos</p>
                  <p className="text-xs text-muted">Marque exatamente quais anúncios vão em cada conjunto. Ex.: 3 conjuntos com 4 criativos cada. Um arquivo pode ser reutilizado em mais de um conjunto.</p>
                </div>
                {groups.map((g, index) => (
                  <div key={g.id} className="border-t border-line pt-3 space-y-2">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <span className="font-semibold text-sm">{index + 1}. {g.settings.name || "Conjunto sem nome"} — {g.mediaIds.length} selecionado(s)</span>
                      <div className="flex gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => assignMediaToGroup(g.id, [...d.creative.mediaIds])}>Todos</button>
                        <button type="button" className="btn btn-sm" onClick={() => assignMediaToGroup(g.id, [])}>Nenhum</button>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {chosenMedia.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={g.mediaIds.includes(m.id)}
                            onChange={(e) => assignMediaToGroup(g.id, e.target.checked ? [...g.mediaIds, m.id] : g.mediaIds.filter((id) => id !== m.id))} />
                          <span className="truncate">{m.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {autoCat && (
              <CatalogSetup
                d={d}
                chosen={chosenMedia}
                media={media}
                productImage={productImage}
                onProductImage={chooseProductImage}
                onUploaded={(m) => setMedia((l) => [m, ...l])}
                dims={dims}
                cur={cur}
                setK={setK}
                setCr={setCr}
              />
            )}
            {catalog && !autoCat && (
              <label className="field">
                <span className="label">Apresentação do catálogo</span>
                <select className="select" value={d.creative.catalogFormat} onChange={(e) => setCr({ catalogFormat: e.target.value })}>
                  {CATALOG_FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span className="text-xs text-muted">As imagens e vídeos vêm dos produtos do catálogo. Use {"{{product.name}}"} e {"{{product.current_price}}"} nos textos.</span>
              </label>
            )}
            {catalog && !autoCat && <PreferVideo d={d} setK={setK} />}

            <label className="field">
              <span className="label">Texto principal — opcional ({d.creative.message.length}/2200)</span>
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
            {catalog && (
              <p className="text-xs text-muted">
                Nome e preço são dados obrigatórios do catálogo, mas não serão inseridos automaticamente no título ou na descrição do anúncio.
                Se você deixar esses textos vazios, o painel usará “{CATALOG_DEFAULT_HEADLINE}” e “{CATALOG_DEFAULT_DESCRIPTION}”.
                A Meta ainda pode apresentar dados do produto em cartões, etiquetas e posicionamentos próprios.
              </p>
            )}
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
            <StepErrors list={step3Errors} />
            <StepNav step={step} setStep={setStep} />
          </section>

          <Preview d={d} page={page} media={media} />
        </div>
      )}

      {step === 4 && (
        <section className="grid gap-4">
          <Summary title="Campanha" onEdit={() => setStep(1)} rows={[
            ["Conta", account ? `${account.name} (${account.id})` : "—"],
            ...(d.extraAccountIds.length ? [["Também em", d.extraAccountIds.map((id) => accounts.find((a) => a.id === id)?.name ?? id).join(", ")] as [string, string]] : []),
            ["Nome", d.campaign.name || "—"],
            ["Tipo", catalog ? "Catálogo" : "Imagens e vídeos"],
            ["Objetivo", label(OBJECTIVES.map(([k, l]) => [k, l] as [string, string]), d.campaign.objective)],
            ["Orçamento", d.campaign.budgetLevel === "campaign" ? `Na campanha · ${d.campaign.budgetType === "daily" ? "diário" : "total"} ${money(d.campaign.budget, cur)}` : `No conjunto · ${d.campaign.budgetType === "daily" ? "diário" : "total"}`],
            ["Lance", label(BID_STRATEGIES, d.campaign.bidStrategy)],
            ["Status inicial", d.campaign.status === "ACTIVE" ? "Ativa" : "Pausada"],
            ...(catalog ? [["Catálogo", autoCat
              ? `Automático · ${catalogBusinesses.find((b) => b.id === d.catalog.businessId)?.name || (d.catalog.businessId ? d.catalog.businessId : "BM parceira acessível")}`
              : look.catalogs.find((c) => c.id === d.campaign.catalogId)?.name ?? d.campaign.catalogId] as [string, string]] : []),
          ]} />
          {d.extraAccountIds.length > 0 && (
            <section className="panel panel-pad">
              <AccountChecks checks={checks} main={account} d={d} pixelName={look.pixels.find((p) => p.id === d.adset.pixelId)?.name} catalogName={autoCat ? "Automático" : look.catalogs.find((c) => c.id === d.campaign.catalogId)?.name} />
            </section>
          )}
          <Summary title="Conjunto" onEdit={() => setStep(2)} rows={[
            ["Estrutura", `1 campanha · ${structure.adsets} conjunto(s) · ${structure.ads} anúncio(s)`],
            ["Conjuntos", groups.map((g) => `${g.settings.name || "Sem nome"} (${adsPerGroup(d, g)} anúncio(s)${d.campaign.budgetLevel === "adset" ? `, ${money(g.settings.budget, cur)}` : ""})`).join(" · ")],
            ...(d.campaign.budgetLevel === "adset" ? [["Orçamento somado dos conjuntos", money(groups.reduce((sum, g) => sum + Number(g.settings.budget || 0), 0), cur)] as [string, string]] : []),
            ["Nome", d.adset.name || "—"],
            ["Otimização", label(GOALS[d.campaign.objective], d.adset.optimizationGoal)],
            ...(d.adset.pixelId ? [["Pixel / evento", `${look.pixels.find((p) => p.id === d.adset.pixelId)?.name ?? d.adset.pixelId} · ${label(EVENTS, d.adset.event)}`] as [string, string]] : []),
            ...(d.campaign.budgetLevel === "adset" ? [["Orçamento", money(d.adset.budget, cur)] as [string, string]] : []),
            ...(needsBidAmount(d.campaign.bidStrategy) ? [["Lance", money(d.adset.bidAmount, cur)] as [string, string]] : []),
            ["Programação", `${d.adset.startTime ? d.adset.startTime.replace("T", " ") : "Agora"} → ${d.adset.endTime ? d.adset.endTime.replace("T", " ") : "sem término"}`],
            ["Locais", [...d.adset.countries, ...d.adset.regions.map((r) => r.name)].join(", ") || "—"],
            ["Público", `${d.adset.advantageAudience ? `mín. ${d.adset.ageMinControl} · sugestão ` : ""}${d.adset.ageMin}–${d.adset.ageMax} · ${d.adset.genders === "all" ? "todos" : d.adset.genders === "male" ? "homens" : "mulheres"}${d.adset.interests.length ? ` · ${d.adset.interests.length} interesse(s)` : ""}${d.adset.audiences.length ? ` · ${d.adset.audiences.length} público(s)` : ""}${d.adset.advantageAudience ? " · Advantage+" : ""}`],
            ["Posicionamentos", d.adset.placements === "auto" ? "Advantage+ (automático)" : d.adset.platforms.map((p) => label(PLATFORMS, p)).join(", ")],
          ]} />
          <Summary title="Criativos" onEdit={() => setStep(3)} rows={[
            ["Página", page?.name ?? "—"],
            ["Instagram", d.creative.instagramId ? (look.instagram.find((i) => i.id === d.creative.instagramId)?.username ?? page?.instagram_username ?? d.creative.instagramId) : "Automático (Instagram da Página)"],
            [catalog ? "Apresentação" : "Anúncios", catalog ? `${label(CATALOG_FORMATS, d.creative.catalogFormat)}${d.catalog.preferVideo ? " · priorizando vídeo" : ""}` : `${d.creative.mediaIds.length} (um por mídia)`],
            ...(autoCat ? [
              ["Produtos", `${d.creative.mediaIds.length * d.catalog.productsPerCreative} (${d.catalog.productsPerCreative} por criativo) · ${money(d.catalog.price, cur)}`] as [string, string],
              ["Anúncios", `${structure.ads} anúncio(s) em ${structure.adsets} conjunto(s)`] as [string, string],
              ["Vídeos", d.catalog.delayMinutes > 0 ? `Atualização agendada em ${d.catalog.delayMinutes} minuto(s) após a criação dos anúncios` : "Na criação dos produtos"] as [string, string],
            ] : []),
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
              <li>Criação de 1 campanha, {structure.adsets} conjunto(s) e {structure.ads} anúncio(s) na conta {account?.name}{d.extraAccountIds.length ? ` e em mais ${d.extraAccountIds.length} conta(s) — um processo por conta` : ""}.</li>
              {autoCat && <li>Catálogo do Business Manager da conta (reaproveitado, ou criado uma única vez).</li>}
              {autoCat && <li>Criação de {d.creative.mediaIds.length * d.catalog.productsPerCreative} produto(s) em lote e do conjunto de produtos da campanha.</li>}
              {autoCat && d.catalog.delayMinutes > 0 && chosenMedia.some((m) => m.kind === "video") && <li>Agendamento da inclusão dos vídeos nos produtos após {d.catalog.delayMinutes} minuto(s), com processamento e revisão aplicáveis pela Meta.</li>}
              {!catalog && <li>Upload de {d.creative.mediaIds.length} mídia(s) para a conta (as já enviadas antes são reaproveitadas).</li>}
              <li>Criação de {structure.ads} criativo(s) e anúncio(s), com status {d.campaign.status === "ACTIVE" ? "ativo" : "pausado"}.</li>
              <li>Acompanhamento da revisão da Meta até aprovar ou apontar problema.</li>
            </ol>
            <p className="text-xs text-muted">Cada etapa aparece na tela de processamento. Se cair a conexão ou você recarregar, nada é criado em dobro.</p>
            <button type="button" className="btn btn-primary" disabled={publishing || allErrors.length > 0 || checks.loading} onClick={publish}>
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

function ExtraAccounts({ accounts, main, value, onChange }: { accounts: AccountLite[]; main?: AccountLite; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(value.length > 0);
  const [q, setQ] = useState("");
  const others = accounts.filter((a) => a.id !== main?.id);
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const shown = others.filter((a) => terms.every((t) => norm(`${a.name} ${a.id} ${a.profile_name}`).includes(t)));
  const chosen = value.map((id) => accounts.find((a) => a.id === id)).filter(Boolean) as AccountLite[];
  const otherCurrency = main ? chosen.filter((a) => a.currency !== main.currency) : [];
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  if (!open) {
    return others.length ? (
      <button type="button" className="text-sm text-info text-left" onClick={() => setOpen(true)}>+ Publicar também em outras contas de anúncio</button>
    ) : null;
  }
  return (
    <div className="grid gap-2">
      <span className="label !mb-0 flex items-center justify-between gap-2">
        Publicar também em outras contas ({value.length} marcada(s))
        {value.length > 0 && <button type="button" className="text-info text-xs" onClick={() => onChange([])}>Limpar</button>}
      </span>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((a) => <span key={a.id} className="chip">{a.name}<button type="button" onClick={() => toggle(a.id)} aria-label={`Remover ${a.name}`}>×</button></span>)}
        </div>
      )}
      <input type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar conta por nome, ID ou perfil…" />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{shown.length} conta(s){q ? " encontrada(s)" : ""}</span>
        {shown.length > 0 && (
          <button type="button" className="text-info" onClick={() => onChange([...new Set([...value, ...shown.map((a) => a.id)])])}>Marcar {q ? "as encontradas" : "todas"}</button>
        )}
      </div>
      <ul className="divide-y divide-[#1f3a44] border border-line rounded-xl max-h-64 overflow-y-auto">
        {shown.map((a) => (
          <li key={a.id}>
            <label className="flex items-center gap-3 px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={value.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm">{a.name}</span>
                <span className="text-xs text-muted">{a.id.replace("act_", "")} · {a.currency} · {a.profile_name}{a.account_status && a.account_status !== 1 ? " · não ativa" : ""}</span>
              </span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-3 text-sm text-muted">Nenhuma conta encontrada.</li>}
      </ul>
      {otherCurrency.length > 0 && (
        <p className="notice notice-warn text-sm">Moeda diferente da conta principal ({main?.currency}): {otherCurrency.map((a) => `${a.name} (${a.currency})`).join(", ")}. Remova essas contas: o orçamento seria lido em outra moeda e a publicação é bloqueada.</p>
      )}
      <span className="text-xs text-muted">A mesma campanha é criada em cada conta marcada, com o mesmo orçamento, público e criativos. O mesmo pixel é usado em todas as contas onde ele for encontrado, mesmo em BMs diferentes.</span>
    </div>
  );
}

const TONE: Record<Status, string> = { none: "text-muted", ok: "pos", share: "text-info", own: "text-spend", error: "neg" };

function AccountChecks({ checks, main, d, pixelName, catalogName }: { checks: Checks; main?: AccountLite; d: DraftData; pixelName?: string; catalogName?: string }) {
  const showCatalog = d.creative.mode === "catalog";
  const showAud = d.adset.audiences.length + d.adset.excludedAudiences.length > 0;
  const bad = checks.list.filter((c) => c.errors.length).length;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="label !mb-0">Conferência das contas</span>
        <span className="text-xs text-muted">
          {checks.loading ? "conferindo na Meta…" : checks.error ? "" : bad ? `${bad} conta(s) com pendência` : checks.list.length ? "todas prontas" : ""}
        </span>
      </div>
      {checks.error && <p className="notice notice-err text-sm">Não deu para conferir as contas: {checks.error}</p>}
      <div className="overflow-x-auto border border-line rounded-xl">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 font-medium">BM</th>
              <th className="px-3 py-2 font-medium">Pixel</th>
              {showCatalog && <th className="px-3 py-2 font-medium">Catálogo</th>}
              {showAud && <th className="px-3 py-2 font-medium">Públicos</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f3a44]">
            <tr>
              <td className="px-3 py-2"><b>{main?.name ?? "—"}</b> <span className="text-xs text-muted">principal · {main?.currency}</span></td>
              <td className="px-3 py-2">{checks.main?.businessName ?? (checks.loading ? "…" : "sem BM")}</td>
              <td className="px-3 py-2">{d.adset.pixelId ? pixelName ?? d.adset.pixelId : <span className="text-muted">escolha na etapa 2</span>}</td>
              {showCatalog && <td className="px-3 py-2">{catalogName ?? <span className="text-muted">escolha acima</span>}</td>}
              {showAud && <td className="px-3 py-2 text-muted">{d.adset.audiences.length + d.adset.excludedAudiences.length} público(s)</td>}
            </tr>
            {d.extraAccountIds.map((id) => {
              const c = checks.list.find((x) => x.accountId === id);
              const sameBm = c?.business && checks.main?.businessId === c.business.id;
              return (
                <Fragment key={id}>
                  <tr>
                    <td className="px-3 py-2">{c?.name ?? id} <span className="text-xs text-muted">{c?.currency ?? ""}</span></td>
                    <td className="px-3 py-2">
                      {!c ? "…" : c.business ? <>{c.business.name} {sameBm ? <span className="text-xs pos">mesmo BM</span> : <span className="text-xs text-spend">outro BM</span>}</> : <span className="text-spend">sem BM</span>}
                    </td>
                    <td className={`px-3 py-2 ${c ? TONE[c.pixel.status] : ""}`}>{c?.pixel.note ?? "…"}</td>
                    {showCatalog && <td className={`px-3 py-2 ${c ? TONE[c.catalog.status] : ""}`}>{c?.catalog.note || "…"}</td>}
                    {showAud && <td className={`px-3 py-2 ${c ? TONE[c.audiences.status] : ""}`}>{c?.audiences.note || "…"}</td>}
                  </tr>
                  {c && c.errors.length > 0 && (
                    <tr><td colSpan={5} className="px-3 pb-2 pt-0"><ul className="text-xs neg list-disc pl-4">{c.errors.map((e) => <li key={e}>{e}</li>)}</ul></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="text-xs text-muted">
        O mesmo pixel é usado em todas as contas cujo BM enxerga o pixel (mesmo BM ou pixel compartilhado com o BM delas); ele é ligado à conta automaticamente ao publicar. O catálogo do BM vale para todas as contas dele.
      </span>
    </div>
  );
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function NewCatalog({ accountId, onCreated }: { accountId: string; onCreated: (c: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; profileId?: string } | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    const r = await createCatalogForAccountAction(accountId, name).catch((e) => ({ error: String(e?.message ?? e) }) as { error: string; id?: undefined });
    setBusy(false);
    if (!r.id) { setErr(r.error ?? "Falha ao criar o catálogo."); return; }
    setMade({ id: r.id, profileId: (r as any).profileId });
    onCreated({ id: r.id, name: name.trim() });
    setOpen(false);
    setName("");
  }

  return (
    <div className="grid gap-1.5">
      {made && (
        <p className="notice notice-ok text-sm">
          Catálogo criado e selecionado. Ele começa vazio:{" "}
          <Link className="underline" target="_blank" href={`/automacao/catalogos/${made.id}${made.profileId ? `?perfil=${made.profileId}` : ""}`}>adicione os produtos</Link>{" "}
          (abre em outra aba) e depois volte aqui.
        </p>
      )}
      {!open ? (
        <button type="button" className="text-sm text-info text-left" disabled={!accountId} onClick={() => setOpen(true)}>+ Criar catálogo novo</button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-48" value={name} maxLength={100} autoFocus placeholder="Nome do catálogo" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (name.trim() && !busy) create(); } }} />
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>{busy ? "Criando…" : "Criar"}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setErr(null); }}>Cancelar</button>
        </div>
      )}
      {err && <span className="text-xs neg">{err}</span>}
      <span className="text-xs text-muted">O catálogo é criado no Business Manager dono da conta de anúncio.</span>
    </div>
  );
}

function PreferVideo({ d, setK }: { d: DraftData; setK: (p: Partial<CatalogAuto>) => void }) {
  return (
    <label className="choice">
      <input type="checkbox" checked={d.catalog.preferVideo} onChange={(e) => setK({ preferVideo: e.target.checked })} />
      <span>
        <b>Priorizar vídeo do catálogo</b>
        <span className="block text-xs text-muted">Mídia dinâmica da Meta: quando o produto tem vídeo, o anúncio mostra o vídeo no lugar da imagem.</span>
      </span>
    </label>
  );
}

function CatalogSetup({ d, chosen, media, productImage, onProductImage, onUploaded, dims, cur, setK, setCr }: {
  d: DraftData; chosen: MediaLite[]; media: MediaLite[]; productImage?: MediaLite; onProductImage: (id: string) => void; onUploaded: (m: MediaLite) => void;
  dims: Record<string, { w: number; h: number }>; cur: string; setK: (p: Partial<CatalogAuto>) => void; setCr: (p: Partial<DraftData["creative"]>) => void;
}) {
  const images = media.filter((m) => m.kind === "image");
  const [picking, setPicking] = useState(!productImage);
  // Quando a capa é escolhida automaticamente, recolha o seletor manual.
  useEffect(() => {
    if (productImage) setPicking(false);
  }, [productImage?.id]);
  const size = productImage && dims[productImage.id];
  return (
    <div className="grid gap-3 border border-line rounded-xl p-3">
      <span className="label !mb-0">Catálogo</span>

      <div className="grid gap-2">
        <span className="text-sm font-semibold">Imagem do produto <span className="text-xs text-muted font-normal">(fica salva como padrão)</span></span>
        {productImage && !picking ? (
          <div className="flex items-center gap-3">
            <img src={productImage.public_url} alt="" className="w-16 h-16 rounded-lg object-cover bg-surface-2" />
            <span className="flex-1 min-w-0 text-sm">
              <span className="block truncate">{productImage.name}</span>
              <span className="text-xs text-muted">{size ? `${size.w}×${size.h} · ` : ""}vai em todos os produtos; os vídeos escolhidos entram junto</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>Trocar</button>
          </div>
        ) : (
          <div className="grid gap-2">
            <MediaUploader compact onUploaded={(m) => { onUploaded(m); if (m.kind === "image") { onProductImage(m.id); setPicking(false); } }} />
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[220px] overflow-y-auto pr-1">
              {images.map((m) => (
                <button key={m.id} type="button" className="media-tile" aria-pressed={m.id === d.catalog.productImageId} title={m.name}
                  onClick={() => { onProductImage(m.id); setPicking(false); }}>
                  <img src={m.public_url} alt={m.name} loading="lazy" />
                </button>
              ))}
            </div>
            {!images.length && <span className="text-xs text-muted">Envie a imagem do seu produto acima.</span>}
          </div>
        )}
      </div>

      {chosen.some((m) => m.kind === "video") ? (
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold">Imagem de cada criativo <span className="text-xs text-muted font-normal">(capa inicial do produto)</span></span>
          <ul className="grid gap-1.5">
            {chosen.filter((m) => m.kind === "video").map((v) => {
              const own = images.find((i) => i.id === d.catalog.images?.[v.id]);
              const shown = own ?? productImage;
              return (
                <li key={v.id} className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-md overflow-hidden bg-surface-2 shrink-0">{shown && <img src={shown.public_url} alt="" className="w-full h-full object-cover" />}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{v.name}</span>
                  <select className="select !h-8 !w-48 text-xs" value={own?.id ?? ""} aria-label={`Imagem do produto de ${v.name}`}
                    onChange={(e) => {
                      const next = { ...(d.catalog.images ?? {}) };
                      if (e.target.value) next[v.id] = e.target.value;
                      else delete next[v.id];
                      setK({ images: next });
                    }}>
                    <option value="">Imagem padrão</option>
                    {images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted">Escolha os criativos acima: cada um vira {d.catalog.productsPerCreative > 1 ? `${d.catalog.productsPerCreative} produtos` : "um produto"}.</p>
      )}

      <div>
        <span className="label">Distribuição dos anúncios</span>
        <p className="text-xs text-muted">A quantidade de conjuntos é configurada na etapa Conjuntos. Um anúncio por criativo não significa um conjunto por anúncio.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="choice">
            <input type="radio" checked={d.catalog.adsMode !== "per_creative"} onChange={() => setK({ adsMode: "single" })} />
            <span><b>Um anúncio</b><span className="block text-xs text-muted">Todos os produtos no mesmo anúncio de catálogo</span></span>
          </label>
          <label className="choice">
            <input type="radio" checked={d.catalog.adsMode === "per_creative"} onChange={() => setK({ adsMode: "per_creative" })} />
            <span><b>Um anúncio por criativo</b>{chosen.length > 1 ? ` (${chosen.length})` : ""}<span className="block text-xs text-muted">Um conjunto de produtos exclusivo para cada anúncio, sem criar conjuntos de anúncios extras. A disponibilidade depende da validação da Meta.</span></span>
          </label>
        </div>
      </div>

      <PreferVideo d={d} setK={setK} />
      {d.catalog.adsMode === "per_creative" && adsetGroupsFor(d).some((g) => g.mediaIds.length > 1) && (
        <p className="notice notice-warn text-sm">
          Modo catálogo com vídeos exclusivos: o painel cria um conjunto de produtos por criativo
          e verifica a compatibilidade com a API da Meta, sem criar anúncios na validação.
          Se a Meta não aceitar subconjuntos diferentes em um único conjunto de anúncios, a publicação falhará
          com a mensagem real — sem misturar os vídeos. Para testar, defina a campanha como Pausada.
        </p>
      )}

      {chosen.some((m) => m.kind === "video") && (
        <label className="field">
          <span className="label">Adicionar vídeos após (minutos)</span>
          <input
            className="input num"
            type="number"
            min={0}
            max={1440}
            step={1}
            value={d.catalog.delayMinutes}
            onChange={(e) => setK({ delayMinutes: Math.min(1440, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
          />
          <span className="text-xs text-muted">
            0 = enviar junto com o catálogo. Acima de 0 = agendar a associação dos vídeos aos mesmos produtos,
            sem recriar os anúncios. A Meta pode processar e revisar as novas mídias.
            É necessário manter o agendador do painel ativo.
          </span>
        </label>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="field">
          <span className="label">Produtos por criativo</span>
          <input className="input num" type="number" min={1} max={10} value={d.catalog.productsPerCreative}
            onChange={(e) => setK({ productsPerCreative: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
        </label>
        <label className="field">
          <span className="label">Preço dos produtos ({cur}) <span className="text-xs text-muted">(obrigatório)</span></span>
          <MoneyInput value={d.catalog.price} onChange={(v) => setK({ price: v })} />
        </label>
      </div>

      <details>
        <summary className="text-sm text-info">Configurações avançadas</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="field"><span className="label">Marca (vazio = nome da Página)</span><input className="input" value={d.catalog.brand} maxLength={100} onChange={(e) => setK({ brand: e.target.value })} /></label>
          <label className="field">
            <span className="label">Apresentação</span>
            <select className="select" value={d.creative.catalogFormat} onChange={(e) => setCr({ catalogFormat: e.target.value })}>
              {CATALOG_FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <span className="text-xs text-muted block mt-1">Nome do produto = título do anúncio (ou nome da campanha); link = URL de destino. Fica salvo para as próximas campanhas.</span>
      </details>
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
            <div style={{ fontWeight: 600 }} className="truncate">{d.creative.headline || (catalog ? CATALOG_DEFAULT_HEADLINE : "Título")}</div>
            {(d.creative.description || catalog) && <div style={{ fontSize: 13, color: "#65676b" }} className="truncate">{d.creative.description || CATALOG_DEFAULT_DESCRIPTION}</div>}
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
        <button type="button" className="btn btn-sm !h-[34px]" onClick={official} disabled={meta.loading || !d.accountId || !d.creative.pageId || (!catalog && !m) || (catalog && d.catalog.source === "auto")}>
          {meta.loading ? "Gerando…" : "Prévia da Meta"}
        </button>
      </div>
      {meta.error && <p className="text-xs neg">{meta.error}</p>}
      {meta.src && <iframe src={meta.src} title="Prévia oficial da Meta" className="w-full rounded-lg bg-white" style={{ height: 560, border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups" />}
    </aside>
  );
}
