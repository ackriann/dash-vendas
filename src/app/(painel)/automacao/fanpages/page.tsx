import Link from "next/link";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import Help from "@/components/Help";
import { TASK_LABEL } from "@/lib/automacao/types";
import { removePageAction, togglePageCreatorAction } from "../actions";


interface PageRow {
  page_id: string;
  profile_id: string | null;
  name: string;
  picture_url: string | null;
  category: string | null;
  tasks: string[];
  instagram_id: string | null;
  instagram_username: string | null;
  ad_accounts: { id: string; name: string; running: number | null; limit: number | null; error?: string }[];
  ads_running: number | null;
  ads_limit: number | null;
  enabled_in_creator: boolean;
  synced_at: string | null;
  sync_error: string | null;
}

export default async function FanPages({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const [{ data, error }, profiles] = await Promise.all([db().from("fb_pages").select("*").order("name"), listProfiles().catch(() => [])]);
  const pages = (data ?? []) as PageRow[];
  const tz = env.timezone;

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">FanPages
            <Help title="Como funciona">
              <p>As Páginas vêm das conexões Meta que você já tem em <b>Perfis Meta</b> — não precisa de novo login nem de extensão.</p>
              <ul>
                <li><b>Permissões</b>: o que o seu perfil pode fazer na Página (para anunciar precisa de “Anunciar”).</li>
                <li><b>Contas relacionadas</b>: contas de anúncio que podem usar a Página.</li>
                <li><b>Limite de anúncios</b>: informado pela Meta por Página em cada conta (anúncios ativos ou em revisão).</li>
                <li><b>No criador</b>: só as Páginas marcadas aparecem no assistente de campanhas.</li>
              </ul>
              <p>Para editar a Página, publicar posts e moderar comentários, use a tela <b>Páginas</b>.</p>
            </Help>
          </h1>
          <p className="sub">Páginas das suas conexões Meta, com permissões, contas de anúncio e limites.</p>
        </div>
        <Link className="btn btn-primary" href="/automacao/fanpages/sincronizar">Sincronizar Páginas</Link>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? (error ? `Rode a migração 005_automacao.sql: ${error.message}` : undefined)} />

      {!pages.length && !error && (
        <div className="panel panel-pad text-center space-y-3">
          <p>Nenhuma Página sincronizada ainda.</p>
          <p className="sub">{profiles.length ? "Sincronize para consultar permissões, contas relacionadas e limites de anúncio." : "Conecte primeiro um perfil em Perfis Meta."}</p>
          {profiles.length > 0 && <Link className="btn btn-primary" href="/automacao/fanpages/sincronizar">Começar</Link>}
        </div>
      )}

      <section className="grid gap-3">
        {pages.map((p) => {
          const pct = p.ads_limit ? Math.min(100, Math.round(((p.ads_running ?? 0) / p.ads_limit) * 100)) : null;
          const canAdvertise = !p.tasks.length || p.tasks.includes("ADVERTISE") || p.tasks.includes("MANAGE");
          return (
            <article key={p.page_id} className="panel p-4 space-y-3">
              <div className="flex gap-3 items-start">
                {p.picture_url ? <img src={p.picture_url} alt="" width={48} height={48} className="rounded-full shrink-0 bg-surface-2" /> : <div className="h-12 w-12 rounded-full bg-surface-2 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{p.name}</p>
                  <p className="text-xs text-muted mono">ID {p.page_id}{p.category ? ` · ${p.category}` : ""}</p>
                  <p className="text-xs text-muted">
                    {p.instagram_username ? `Instagram @${p.instagram_username}` : p.instagram_id ? `Instagram ${p.instagram_id}` : "Sem Instagram ligado"}
                    {" · "}via {profiles.find((x) => x.id === p.profile_id)?.name ?? "perfil removido"}
                    {" · "}sincronizada {p.synced_at ? fmtDateTime(p.synced_at, tz) : "—"}
                  </p>
                </div>
                <form action={togglePageCreatorAction} className="shrink-0">
                  <input type="hidden" name="page" value={p.page_id} />
                  <input type="hidden" name="enabled" value={p.enabled_in_creator ? "0" : "1"} />
                  <SubmitButton className={`pill cursor-pointer ${p.enabled_in_creator ? "pill-approved" : ""}`} pendingText="…">
                    {p.enabled_in_creator ? "No criador" : "Fora do criador"}
                  </SubmitButton>
                </form>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {p.tasks.length ? p.tasks.map((t) => <span key={t} className={`pill ${t === "ADVERTISE" ? "pill-approved" : ""}`}>{TASK_LABEL[t] ?? t}</span>) : <span className="pill">Permissões não informadas</span>}
                {!canAdvertise && <span className="pill pill-refunded">Sem permissão de anunciar</span>}
              </div>

              <div className="grid md:grid-cols-[220px_minmax(0,1fr)] gap-3">
                <div>
                  <p className="sub">Anúncios ativos / em revisão</p>
                  <p className="num text-lg font-semibold">{p.ads_running ?? "—"}{p.ads_limit ? <span className="text-muted text-sm"> de {p.ads_limit}</span> : null}</p>
                  {pct !== null && <div className="progress mt-1"><div style={{ width: `${pct}%`, background: pct >= 90 ? "var(--color-loss)" : pct >= 70 ? "var(--color-spend)" : undefined }} /></div>}
                  {p.ads_limit === null && <p className="text-xs text-muted">A Meta não informou limite para esta Página.</p>}
                </div>
                <div className="min-w-0">
                  <p className="sub">Contas de anúncio relacionadas ({p.ad_accounts.length})</p>
                  {p.ad_accounts.length ? (
                    <ul className="text-sm space-y-0.5">
                      {p.ad_accounts.map((a) => (
                        <li key={a.id} className="flex justify-between gap-2">
                          <span className="truncate">{a.name} <span className="text-xs text-muted">{a.id.replace("act_", "")}</span></span>
                          <span className="num text-muted text-xs shrink-0">{a.error ? <span className="neg" title={a.error}>erro</span> : a.limit ? `${a.running ?? 0}/${a.limit}` : a.running ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Nenhuma conta do perfil pode anunciar com esta Página.</p>}
                </div>
              </div>
              {p.sync_error && <p className="notice notice-err text-sm">{p.sync_error}</p>}
              <div className="flex flex-wrap gap-2">
                <Link className="btn btn-sm" href={`/paginas/${p.page_id}`}>Editar Página / posts</Link>
                <form action={removePageAction}>
                  <input type="hidden" name="page" value={p.page_id} />
                  <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={`Remover ${p.name} do módulo? Nada é alterado na Meta.`}>Remover</SubmitButton>
                </form>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
