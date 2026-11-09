import Link from "next/link";
import { BRASILIA_TIME_ZONE, fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { graph } from "@/lib/meta";
import { listProfiles, profileAuth } from "@/lib/profiles";
import { listProductSets, listProducts, type ProductItem } from "@/lib/automacao/meta-ads";
import { listMedia } from "@/lib/automacao/media";
import type { ScheduleRow } from "@/lib/automacao/engine";
import type { MediaLite } from "@/lib/automacao/types";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import Acc from "@/components/Acc";
import ListSearch from "@/components/ListSearch";
import MediaChecklist from "@/components/automacao/MediaChecklist";
import TzOffset from "@/components/automacao/TzOffset";
import {
  addProductAction, deleteScheduleAction, runScheduleNowAction, saveScheduleAction, toggleScheduleAction, updateProductMediaAction,
} from "../../actions";

type SP = Promise<{ perfil?: string; aba?: string; produto?: string; ok?: string; erro?: string }>;

const TABS: [string, string][] = [["produtos", "Produtos"], ["automacoes", "Atualizações programadas"], ["historico", "Histórico"]];

const REVIEW: Record<string, [string, string]> = {
  approved: ["Aprovado", "pill-approved"],
  pending: ["Em revisão", "pill-pending"],
  outdated: ["Desatualizado", "pill-pending"],
  rejected: ["Reprovado", "pill-refunded"],
};

const SYNC: Record<string, [string, string]> = {
  waiting: ["Aguardando sincronização", "pill-pending"],
  synced: ["Sincronizado", "pill-approved"],
  rejected: ["Reprovado pela Meta", "pill-refunded"],
  error: ["Erro", "pill-refunded"],
};

interface LogRow {
  id: number;
  run_id: string | null;
  schedule_id: string | null;
  product_name: string | null;
  retailer_id: string | null;
  previous_media: any;
  current_media: any;
  meta_response: any;
  sync_status: string;
  error: string | null;
  created_at: string;
}

function thumb(m: any): string | null {
  if (!m) return null;
  return m.image_url ?? m.images?.[0] ?? null;
}

export default async function Catalogo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.aba) ? sp.aba! : "produtos";
  const profiles = await listProfiles().catch(() => []);
  const profile = profiles.find((p) => p.id === sp.perfil) ?? profiles[0];
  const tz = BRASILIA_TIME_ZONE;
  const base = `/automacao/catalogos/${id}?perfil=${profile?.id ?? ""}`;

  let catalog: { id: string; name: string; product_count?: number } | null = null;
  let products: ProductItem[] = [];
  let sets: { id: string; name: string; product_count?: number }[] = [];
  let error: string | null = null;
  if (profile) {
    try {
      const auth = await profileAuth(profile.id);
      [catalog, products, sets] = await Promise.all([
        graph(id, { params: { fields: "id,name,product_count" }, auth }),
        listProducts(auth, id, 3),
        listProductSets(auth, id).catch(() => []),
      ]);
    } catch (e: any) {
      error = e?.message ?? "erro ao consultar o catálogo";
    }
  }
  const media: MediaLite[] = (await listMedia().catch(() => [])).map((m) => ({ id: m.id, kind: m.kind, name: m.name, public_url: m.public_url }));
  const nonce = crypto.randomUUID();
  const selected = products.find((p) => p.id === sp.produto) ?? null;

  const [{ data: schedData }, { data: logData }] = await Promise.all([
    db().from("catalog_schedules").select("*").eq("catalog_id", id).order("created_at", { ascending: false }),
    db().from("catalog_update_logs").select("*").eq("catalog_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const schedules = (schedData ?? []) as ScheduleRow[];
  const logs = (logData ?? []) as LogRow[];
  const pName = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid;

  return (
    <div className="space-y-5">
      <p className="text-sm"><Link className="text-muted hover:text-ink" href={`/automacao/catalogos?perfil=${profile?.id ?? ""}`}>← Catálogos</Link></p>
      <header>
        <h1>{catalog?.name ?? "Catálogo"}</h1>
        <p className="sub mono">{id} · {catalog?.product_count ?? products.length} produto(s) · via {profile?.name ?? "—"}</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? error ?? undefined} />

      <div className="seg">
        {TABS.map(([k, label]) => <Link key={k} href={`${base}&aba=${k}`} aria-current={tab === k ? "true" : undefined}>{label}</Link>)}
      </div>

      {tab === "produtos" && (
        <>
          {selected && profile && (
            <section className="panel panel-pad space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate">Mídias de {selected.name}</h2>
                <Link className="btn btn-sm" href={base}>Fechar</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {[selected.image_url, ...(selected.additional_image_urls ?? [])].filter(Boolean).map((u, i) => (
                  <figure key={i} className="w-24">
                    <img src={u!} alt="" className="w-24 h-24 object-cover rounded-lg bg-surface-2" />
                    <figcaption className="text-xs text-muted">{i === 0 ? "Principal" : `Adicional ${i}`}</figcaption>
                  </figure>
                ))}
              </div>
              <form action={updateProductMediaAction} className="space-y-3">
                <input type="hidden" name="profile" value={profile.id} />
                <input type="hidden" name="catalog" value={id} />
                <input type="hidden" name="product" value={selected.id} />
                <input type="hidden" name="nonce" value={nonce} />
                <p className="text-sm">Escolha as novas mídias. A 1ª imagem vira a principal, as outras viram adicionais; vídeos entram como vídeos do produto.</p>
                <MediaChecklist media={media} />
                <SubmitButton className="btn btn-primary" pendingText="Enviando…">Atualizar mídias do produto</SubmitButton>
                <p className="text-xs text-muted">A Meta revisa o produto de novo depois da alteração. O resultado aparece no Histórico.</p>
              </form>
            </section>
          )}

          <section className="panel overflow-x-auto">
            <table className="tbl min-w-[720px]">
              <thead><tr><th /><th>Produto</th><th>Preço</th><th>Disponibilidade</th><th>Revisão da Meta</th><th /></tr></thead>
              <tbody>
                {products.map((p) => {
                  const [label, cls] = REVIEW[p.review_status ?? ""] ?? [p.review_status || "—", ""];
                  return (
                    <tr key={p.id}>
                      <td className="w-14">{p.image_url ? <img src={p.image_url} alt="" className="w-11 h-11 object-cover rounded-md bg-surface-2" /> : null}</td>
                      <td className="max-w-[280px]">
                        <span className="block truncate font-semibold" title={p.name}>{p.name}</span>
                        <span className="text-xs text-muted mono">{p.retailer_id}</span>
                      </td>
                      <td className="num text-sm">{p.price ?? "—"}</td>
                      <td className="text-sm text-muted">{p.availability ?? "—"}</td>
                      <td>
                        <span className={`pill ${cls}`}>{label}</span>
                        {!!p.review_rejection_reasons?.length && <span className="block text-xs neg">{p.review_rejection_reasons.join(", ")}</span>}
                      </td>
                      <td className="r"><Link className="btn btn-sm" href={`${base}&produto=${p.id}`}>Mídias</Link></td>
                    </tr>
                  );
                })}
                {!products.length && <tr><td colSpan={6} className="text-center text-muted py-8">{error ? "Não deu para ler os produtos." : "Catálogo vazio."}</td></tr>}
              </tbody>
            </table>
          </section>

          {profile && (
            <Acc title="Adicionar produto" sub="Envia para a Meta pelo lote de itens (items_batch) e acompanha a revisão">
              <form action={addProductAction} className="grid md:grid-cols-2 gap-3">
                <input type="hidden" name="profile" value={profile.id} />
                <input type="hidden" name="catalog" value={id} />
                <input type="hidden" name="nonce" value={nonce} />
                <label className="field"><span className="label">ID do produto (SKU)</span><input className="input" name="retailer_id" required maxLength={100} /></label>
                <label className="field"><span className="label">Nome</span><input className="input" name="name" required maxLength={200} /></label>
                <label className="field"><span className="label">Preço</span><input className="input num" name="price" inputMode="decimal" required placeholder="97,00" /></label>
                <label className="field"><span className="label">Moeda</span><input className="input" name="currency" defaultValue="BRL" maxLength={3} /></label>
                <label className="field md:col-span-2"><span className="label">Link do produto</span><input className="input" name="url" type="url" required placeholder="https://" /></label>
                <label className="field"><span className="label">Marca (opcional)</span><input className="input" name="brand" /></label>
                <label className="field"><span className="label">Disponibilidade</span>
                  <select className="select" name="availability"><option value="in stock">Em estoque</option><option value="out of stock">Esgotado</option><option value="preorder">Pré-venda</option></select>
                </label>
                <label className="field md:col-span-2"><span className="label">Descrição</span><textarea className="textarea" name="description" maxLength={5000} /></label>
                <div className="md:col-span-2 space-y-2">
                  <span className="label">Mídias (1ª imagem = principal)</span>
                  <MediaChecklist media={media} />
                </div>
                <div className="md:col-span-2"><SubmitButton className="btn btn-primary" pendingText="Enviando…">Adicionar ao catálogo</SubmitButton></div>
              </form>
            </Acc>
          )}

          {sets.length > 0 && (
            <section className="panel panel-pad space-y-2">
              <h2>Conjuntos de produtos</h2>
              <p className="sub">Para anunciar este catálogo, crie uma campanha no modo <b>Catálogo</b>: escolha o catálogo na etapa Campanha, o conjunto de produtos na etapa Conjunto e a forma de apresentação (carrossel, slideshow ou imagem única) nos Criativos.</p>
              <ul className="text-sm">{sets.map((s) => <li key={s.id}>{s.name} <span className="text-muted text-xs">· {s.product_count ?? 0} produto(s) · {s.id}</span></li>)}</ul>
            </section>
          )}
        </>
      )}

      {tab === "automacoes" && profile && (
        <>
          <section className="grid gap-2">
            {schedules.map((s) => (
              <Acc
                key={s.id}
                title={s.name}
                sub={`${s.update_type === "rotate_image" ? `Rodízio de imagem a cada ${s.interval_minutes} min` : "Definir mídias (uma vez)"} · ${s.product_ids.length} produto(s) · ${s.media_ids.length} mídia(s)`}
                right={<span className={`pill ${s.active ? "pill-approved" : ""}`}>{s.active ? "Ativa" : "Pausada"}</span>}
              >
                <div className="grid sm:grid-cols-3 gap-3 text-sm">
                  <p><span className="sub block">Início</span>{fmtDateTime(s.start_at, tz)}</p>
                  <p><span className="sub block">Próxima execução</span>{s.active ? fmtDateTime(s.next_run_at, tz) : "—"}</p>
                  <p><span className="sub block">Última</span>{s.last_run_at ? fmtDateTime(s.last_run_at, tz) : "—"}{s.last_result ? ` · ${s.last_result}` : ""}</p>
                </div>
                <p className="text-sm text-muted">Produtos: {s.product_ids.map(pName).join(", ")}</p>
                <div className="flex flex-wrap gap-2">
                  <form action={toggleScheduleAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                    <input type="hidden" name="next" value={s.next_run_at} />
                    <input type="hidden" name="back" value={`${base}&aba=automacoes`} />
                    <SubmitButton className="btn btn-sm" pendingText="…">{s.active ? "Pausar" : "Ativar"}</SubmitButton>
                  </form>
                  {s.active && (
                    <form action={runScheduleNowAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="back" value={`${base}&aba=historico`} />
                      <SubmitButton className="btn btn-sm" pendingText="…">Executar agora</SubmitButton>
                    </form>
                  )}
                  <form action={deleteScheduleAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="back" value={`${base}&aba=automacoes`} />
                    <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={`Excluir a automação "${s.name}"?`}>Excluir</SubmitButton>
                  </form>
                </div>
              </Acc>
            ))}
            {!schedules.length && <p className="sub">Nenhuma atualização programada para este catálogo.</p>}
          </section>

          <section className="panel panel-pad space-y-3">
            <h2>Nova atualização programada</h2>
            <p className="notice notice-warn text-sm">
              Cada alteração é enviada pela API oficial e passa de novo pela revisão da Meta — o anúncio mostra o produto como está no catálogo,
              para todos. Se a Meta reprovar um produto, a automação é pausada sozinha. Ela roda pelo <Link className="underline" href="/regras">Agendador</Link> (mesma URL das regras).
            </p>
            <form action={saveScheduleAction} className="grid md:grid-cols-2 gap-3">
              <input type="hidden" name="profile" value={profile.id} />
              <input type="hidden" name="catalog" value={id} />
              <input type="hidden" name="catalog_name" value={catalog?.name ?? ""} />
              <TzOffset />
              <label className="field"><span className="label">Nome</span><input className="input" name="name" required maxLength={80} /></label>
              <label className="field"><span className="label">Tipo de atualização</span>
                <select className="select" name="update_type">
                  <option value="rotate_image">Rodízio da imagem principal (a cada intervalo)</option>
                  <option value="set_media">Definir imagens e vídeos (uma vez, no início)</option>
                </select>
              </label>
              <label className="field"><span className="label">Intervalo (minutos, mín. 15)</span><input className="input num" name="interval" type="number" min={15} step={5} defaultValue={60} /></label>
              <label className="field"><span className="label">Horário de início</span><input className="input" name="start_at" type="datetime-local" /></label>
              <label className="field"><span className="label">Status</span>
                <select className="select" name="active"><option value="1">Ativa</option><option value="0">Pausada</option></select>
              </label>
              <div className="md:col-span-2 space-y-2">
                <span className="label">Produtos</span>
                <ListSearch placeholder="Pesquisar produto…">
                  <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {products.map((p) => (
                      <label key={p.id} className="choice !py-2" data-search={`${p.name} ${p.retailer_id}`}>
                        <input type="checkbox" name="product" value={p.id} />
                        <span className="min-w-0 text-sm"><span className="block truncate">{p.name}</span><span className="text-xs text-muted mono">{p.retailer_id}</span></span>
                      </label>
                    ))}
                  </div>
                </ListSearch>
              </div>
              <div className="md:col-span-2 space-y-2">
                <span className="label">Mídias, na ordem do rodízio</span>
                <MediaChecklist media={media} />
              </div>
              <div className="md:col-span-2"><SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar automação</SubmitButton></div>
            </form>
          </section>
        </>
      )}

      {tab === "historico" && (
        <section className="panel overflow-x-auto">
          <table className="tbl min-w-[860px]">
            <thead><tr><th>Data</th><th>Produto</th><th>Mídia anterior</th><th>Mídia atual</th><th>Status</th><th>Resposta da Meta</th></tr></thead>
            <tbody>
              {logs.map((l) => {
                const [label, cls] = SYNC[l.sync_status] ?? [l.sync_status, ""];
                const prev = thumb(l.previous_media);
                const cur = thumb(l.current_media);
                return (
                  <tr key={l.id}>
                    <td className="text-sm whitespace-nowrap">{fmtDateTime(l.created_at, tz)}{l.schedule_id && <span className="block text-xs text-muted">automação</span>}</td>
                    <td className="max-w-[220px]"><span className="block truncate">{l.product_name ?? l.retailer_id}</span><span className="text-xs text-muted mono">{l.retailer_id}</span></td>
                    <td>{prev ? <a href={prev} target="_blank" rel="noreferrer"><img src={prev} alt="anterior" className="w-11 h-11 object-cover rounded-md" /></a> : <span className="text-muted">—</span>}</td>
                    <td>{cur ? <a href={cur} target="_blank" rel="noreferrer"><img src={cur} alt="atual" className="w-11 h-11 object-cover rounded-md" /></a> : <span className="text-muted">—</span>}{l.current_media?.videos?.length ? <span className="block text-xs text-muted">+{l.current_media.videos.length} vídeo(s)</span> : null}</td>
                    <td><span className={`pill ${cls}`}>{label}</span>{l.error && <span className="block text-xs neg max-w-[220px]">{l.error}</span>}</td>
                    <td className="text-xs">
                      {l.meta_response ? (
                        <details><summary className="text-info">ver</summary><code className="codebox mt-1 max-w-[280px]">{JSON.stringify(l.meta_response, null, 1)}</code></details>
                      ) : "—"}
                      {l.run_id && <Link className="block text-info hover:underline" href={`/automacao/processos/${l.run_id}`}>processo</Link>}
                    </td>
                  </tr>
                );
              })}
              {!logs.length && <tr><td colSpan={6} className="text-center text-muted py-8">Nenhuma alteração registrada.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
