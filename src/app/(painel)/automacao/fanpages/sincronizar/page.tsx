import Link from "next/link";
import { db } from "@/lib/db";
import { listPages, type FbPage } from "@/lib/meta";
import { listProfiles, profileAuth } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import ListSearch from "@/components/ListSearch";
import { startPageSyncAction } from "../../actions";

const STEPS = ["Conexão", "Consulta das Páginas", "Seleção", "Informações e limites", "Sincronização", "Confirmação"];

function Stepper({ at }: { at: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className={`pill ${i + 1 < at ? "pill-approved" : i + 1 === at ? "pill-info" : ""}`}>{i + 1}. {s}</li>
      ))}
    </ol>
  );
}

export default async function SincronizarPaginas({ searchParams }: { searchParams: Promise<{ perfil?: string; etapa?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const profiles = await listProfiles().catch(() => []);
  const profile = profiles.find((p) => p.id === sp.perfil) ?? (profiles.length === 1 ? profiles[0] : null);

  let pages: FbPage[] = [];
  let fetchError: string | null = null;
  if (profile) {
    try {
      pages = await listPages(await profileAuth(profile.id));
    } catch (e: any) {
      fetchError = e?.message ?? "erro ao consultar";
    }
  }
  const { data: known } = await db().from("fb_pages").select("page_id");
  const synced = new Set((known ?? []).map((k: any) => k.page_id));
  const nonce = crypto.randomUUID();

  return (
    <div className="space-y-5">
      <p className="text-sm"><Link className="text-muted hover:text-ink" href="/automacao/fanpages">← FanPages</Link></p>
      <header className="space-y-2">
        <h1>Sincronizar Páginas</h1>
        <Stepper at={profile ? 3 : 1} />
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <section className="panel panel-pad space-y-3">
        <h2>1. Conexão Meta</h2>
        {!profiles.length ? (
          <p className="notice notice-warn">Nenhuma conexão. Conecte um perfil em <Link className="underline" href="/perfis">Perfis Meta</Link>.</p>
        ) : (
          <form method="get" className="flex flex-wrap gap-2 items-end">
            <label className="field min-w-64 flex-1">
              <span className="label">Usar a conexão já existente</span>
              <select className="select" name="perfil" defaultValue={profile?.id ?? ""}>
                {!profile && <option value="">Escolha…</option>}
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.status === "error" ? " (token com erro)" : ""}</option>
                ))}
              </select>
            </label>
            <button className="btn">Consultar Páginas</button>
          </form>
        )}
        {profile && !profile.scopes.includes("pages_show_list") && profile.scopes.length > 0 && (
          <p className="notice notice-warn text-sm">Este perfil não tem <code>pages_show_list</code>. <a className="underline" href={`/api/auth/facebook?perfil=${profile.id}&voltar=/automacao/fanpages/sincronizar`}>Reautorizar com Facebook</a>.</p>
        )}
      </section>

      {profile && (
        <section className="panel panel-pad space-y-3">
          <h2>2–3. Páginas disponíveis em {profile.name}</h2>
          {fetchError ? (
            <p className="notice notice-err">{fetchError}</p>
          ) : !pages.length ? (
            <p className="sub">A conexão não retornou Páginas. Confira se o token tem acesso a elas (Usuário do sistema → atribuir Páginas).</p>
          ) : (
            <form action={startPageSyncAction} className="space-y-3">
              <input type="hidden" name="profile" value={profile.id} />
              <input type="hidden" name="nonce" value={nonce} />
              <ListSearch placeholder="Pesquisar Página por nome ou ID…">
                <div className="grid sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                  {pages.map((p) => (
                    <label key={p.id} className="choice" data-search={`${p.name} ${p.id}`}>
                      <input type="checkbox" name="page" value={p.id} defaultChecked />
                      <input type="hidden" name={`name_${p.id}`} value={p.name} />
                      {p.picture?.data?.url ? <img src={p.picture.data.url} alt="" width={32} height={32} className="rounded-full" /> : null}
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">{p.name}</span>
                        <span className="block text-xs text-muted mono">{p.id}{synced.has(p.id) ? " · já sincronizada" : ""}</span>
                        {!!p.tasks?.length && !p.tasks.includes("ADVERTISE") && <span className="block text-xs text-spend">sem permissão de anunciar</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </ListSearch>
              <p className="text-xs text-muted">Na próxima etapa o painel consulta, para cada Página, as permissões, o Instagram ligado, as contas de anúncio relacionadas e os limites de anúncio — com o progresso de cada uma.</p>
              <SubmitButton className="btn btn-primary" pendingText="Iniciando…">Sincronizar selecionadas</SubmitButton>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
