import Link from "next/link";
import { listAllPages, listProfiles, type PageWithProfile } from "@/lib/profiles";
import { fmtNum } from "@/lib/money";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { createPageAction } from "./actions";

const CATEGORIES: [string, string][] = [
  ["BRAND", "Marca"],
  ["PRODUCT_SERVICE", "Produto/serviço"],
  ["EDUCATION", "Educação"],
  ["ENTREPRENEUR", "Empreendedor"],
  ["PERSONAL_BLOG", "Blog pessoal"],
  ["COMMUNITY", "Comunidade"],
];

export default async function Paginas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; criar?: string }> }) {
  const sp = await searchParams;
  const profiles = await listProfiles().catch(() => []);
  const token = profiles.length > 0;
  let pages: PageWithProfile[] = [];
  let error: string | null = null;
  if (token) {
    const r = await listAllPages();
    pages = r.pages;
    error = r.errors.join(" · ") || null;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Páginas do Facebook</h1>
          <p className="sub">Edite as páginas que você usa nos anúncios, publique posts e modere comentários.</p>
        </div>
        <details className="relative" open={sp.criar === "1" || sp.criar === "manual"}>
          <summary className="btn btn-primary">Criar página</summary>
          <div className="panel panel-pad absolute right-0 z-30 mt-2 w-[min(92vw,420px)] space-y-3">
            {sp.criar === "manual" ? (
              <>
                <p className="text-sm">A Meta só libera criação de página pela API para apps aprovados. Crie pelo Facebook — ela aparece aqui sozinha em seguida.</p>
                <a className="btn btn-primary w-full" href="https://www.facebook.com/pages/create" target="_blank" rel="noreferrer">Abrir criação no Facebook</a>
                <Link className="btn w-full" href="/paginas">Já criei, atualizar lista</Link>
              </>
            ) : (
              <form action={createPageAction} className="space-y-3">
                {profiles.length > 1 && (
                  <label className="field"><span className="label">Perfil</span>
                    <select className="select" name="profile">{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  </label>
                )}
                {profiles.length === 1 && <input type="hidden" name="profile" value={profiles[0].id} />}
                <label className="field"><span className="label">Nome</span><input className="input" name="name" required /></label>
                <label className="field"><span className="label">Categoria</span>
                  <select className="select" name="category">{CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </label>
                <label className="field"><span className="label">Sobre (opcional)</span><textarea className="textarea" name="about" maxLength={255} /></label>
                <SubmitButton className="btn btn-primary w-full" pendingText="Criando…">Criar página</SubmitButton>
                <p className="text-xs text-muted">Se a Meta recusar pela API, o painel mostra o atalho para criar pelo Facebook.</p>
              </form>
            )}
          </div>
        </details>
      </header>

      <Notice ok={sp.ok} erro={sp.erro ?? error ?? undefined} />
      {!token && (
        <p className="notice notice-warn">Conecte um perfil em <Link href="/perfis" className="underline">Perfis Meta</Link> para ver suas páginas.</p>
      )}

      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {pages.map((p) => (
          <Link key={p.id} href={`/paginas/${p.id}`} className="panel p-4 flex gap-3 items-center hover:border-[#3b6170]">
            {p.picture?.data?.url ? (
              <img src={p.picture.data.url} alt="" width={52} height={52} className="rounded-full shrink-0 bg-surface-2" />
            ) : (
              <div className="h-[52px] w-[52px] rounded-full bg-surface-2 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold truncate">{p.name}</p>
              <p className="text-xs text-muted truncate">{p.category}</p>
              <p className="text-xs text-muted">
                {fmtNum(p.followers_count ?? p.fan_count ?? 0)} seguidores
                {p.is_published === false && <span className="text-spend"> · não publicada</span>}
              </p>
              {profiles.length > 1 && <p className="text-xs text-muted truncate">via {p.profile_name}</p>}
            </div>
          </Link>
        ))}
        {token && !pages.length && !error && <p className="sub">Nenhuma página encontrada. Crie uma ou confira se o login deu permissão às páginas.</p>}
      </section>
    </div>
  );
}
