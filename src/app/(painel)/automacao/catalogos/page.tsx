import Link from "next/link";
import { listProfiles, profileAuth } from "@/lib/profiles";
import { listBusinessCatalogs, listBusinesses, type Catalog } from "@/lib/automacao/meta-ads";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { createCatalogAction } from "../actions";

export default async function Catalogos({ searchParams }: { searchParams: Promise<{ perfil?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const profiles = await listProfiles().catch(() => []);
  const profile = profiles.find((p) => p.id === sp.perfil) ?? profiles[0] ?? null;

  let businesses: { id: string; name: string; catalogs: Catalog[] }[] = [];
  let error: string | null = null;
  if (profile) {
    try {
      const auth = await profileAuth(profile.id);
      const list = await listBusinesses(auth);
      businesses = await Promise.all(list.map(async (b) => ({ ...b, catalogs: await listBusinessCatalogs(auth, b.id) })));
    } catch (e: any) {
      error = e?.message ?? "erro ao consultar";
    }
  }
  const hasCatalogScope = !profile?.scopes.length || profile.scopes.includes("catalog_management");

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Catálogos</h1>
          <p className="sub">Catálogos dos seus Business Managers: produtos, mídias, status de sincronização e atualizações programadas.</p>
        </div>
        {profiles.length > 1 && (
          <form method="get" className="flex gap-2">
            <select className="select !w-auto" name="perfil" defaultValue={profile?.id} aria-label="Conexão Meta">
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn">Trocar</button>
          </form>
        )}
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      {!profile && <p className="notice notice-warn">Conecte um perfil em <Link className="underline" href="/perfis">Perfis Meta</Link>.</p>}
      {profile && !hasCatalogScope && (
        <div className="notice notice-warn flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-60">O perfil <b>{profile.name}</b> ainda não tem a permissão <code>catalog_management</code>. Dá para ver os catálogos, mas criar e alterar produtos exige essa permissão.</span>
          <a className="btn btn-sm" href={`/api/auth/facebook?perfil=${profile.id}&extra=catalog_management&voltar=/automacao/catalogos`}>Autorizar catálogos</a>
        </div>
      )}
      {error && <p className="notice notice-err">{error}</p>}

      {profile && !error && (
        <>
          {businesses.map((b) => (
            <section key={b.id} className="space-y-2">
              <h2>{b.name} <span className="text-xs text-muted mono">BM {b.id}</span></h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {b.catalogs.map((c) => (
                  <Link key={c.id} href={`/automacao/catalogos/${c.id}?perfil=${profile.id}`} className="panel p-4 hover:border-[#3b6170]">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted mono">{c.id}</p>
                    <p className="text-sm text-muted">{c.product_count ?? 0} produto(s){c.vertical ? ` · ${c.vertical}` : ""}</p>
                  </Link>
                ))}
                {!b.catalogs.length && <p className="sub">Nenhum catálogo neste BM.</p>}
              </div>
            </section>
          ))}
          {!businesses.length && <p className="sub">A conexão não tem acesso a nenhum Business Manager (é preciso <code>business_management</code>).</p>}

          {businesses.length > 0 && (
            <section className="panel panel-pad space-y-3 max-w-xl">
              <h2>Criar catálogo</h2>
              <form action={createCatalogAction} className="grid gap-3">
                <input type="hidden" name="profile" value={profile.id} />
                <label className="field"><span className="label">Business Manager</span>
                  <select className="select" name="business">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                </label>
                <label className="field"><span className="label">Nome do catálogo</span><input className="input" name="name" required maxLength={100} /></label>
                <SubmitButton className="btn btn-primary" pendingText="Criando…">Criar catálogo</SubmitButton>
                <p className="text-xs text-muted">A Meta só permite se o perfil for administrador do BM e tiver <code>catalog_management</code>.</p>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
