import Link from "next/link";
import { env } from "@/lib/env";
import { fmtDateTime, ymdInTz } from "@/lib/dates";
import { fmtNum } from "@/lib/money";
import {
  getPage, listAdsPosts, listComments, listPosts, listScheduledPosts, type FbPage, type PageComment, type PagePost,
} from "@/lib/meta";
import { pageAuth } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import {
  deleteCommentAction, deletePostAction, hideCommentAction, publishPostAction, replyCommentAction, updatePageImages, updatePageInfo,
} from "../actions";

type SP = Promise<{ tab?: string; post?: string; ok?: string; erro?: string }>;

const TABS: [string, string][] = [
  ["posts", "Publicações"],
  ["anuncios", "Posts de anúncios"],
  ["agendados", "Agendados"],
  ["editar", "Editar página"],
];

export default async function PaginaDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "posts";
  const tz = env.timezone;

  let page: FbPage | null = null;
  let error: string | null = null;
  let posts: PagePost[] = [];
  let comments: PageComment[] = [];
  try {
    const auth = await pageAuth(id);
    page = await getPage(auth, id);
    if (tab === "posts") posts = await listPosts(auth, id);
    if (tab === "anuncios") posts = await listAdsPosts(auth, id);
    if (tab === "agendados") posts = await listScheduledPosts(auth, id);
    if (sp.post) comments = await listComments(auth, sp.post);
  } catch (e: any) {
    error = e?.message ?? "Erro ao carregar a página";
  }

  const here = (over: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams();
    const all = { tab, post: sp.post, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/paginas/${id}?${p}`;
  };
  const back = here();

  if (!page) {
    return (
      <div className="space-y-4">
        <Link href="/paginas" className="sub hover:underline">Páginas</Link>
        <Notice erro={error ?? "Página não encontrada"} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/paginas" className="sub hover:underline">Páginas</Link>
      <header className="panel overflow-hidden">
        <div className="h-28 md:h-40 bg-surface-2 bg-cover bg-center" style={page.cover?.source ? { backgroundImage: `url(${page.cover.source})` } : undefined} />
        <div className="px-5 pb-4 -mt-8 flex items-end gap-4 flex-wrap">
          {page.picture?.data?.url ? (
            <img src={page.picture.data.url} alt="" width={84} height={84} className="rounded-full border-4 border-surface bg-surface-2" />
          ) : (
            <div className="h-[84px] w-[84px] rounded-full border-4 border-surface bg-surface-2" />
          )}
          <div className="flex-1 min-w-0 pb-1">
            <h1 className="truncate">{page.name}</h1>
            <p className="sub">{page.category} · {fmtNum(page.followers_count ?? page.fan_count ?? 0)} seguidores{page.is_published === false ? " · não publicada" : ""}</p>
          </div>
          {page.link && <a href={page.link} target="_blank" rel="noreferrer" className="btn btn-sm">Abrir no Facebook</a>}
        </div>
      </header>

      <Notice ok={sp.ok} erro={sp.erro ?? error ?? undefined} />

      <div className="seg">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/paginas/${id}?tab=${k}`} aria-current={tab === k ? "true" : undefined}>{l}</Link>
        ))}
      </div>

      {tab === "editar" ? (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <form action={updatePageInfo} className="panel panel-pad space-y-3">
            <h2>Informações</h2>
            <input type="hidden" name="page" value={id} />
            <label className="field"><span className="label">Sobre (até 255 caracteres)</span><textarea className="textarea" name="about" maxLength={255} defaultValue={page.about ?? ""} /></label>
            <label className="field"><span className="label">Descrição</span><textarea className="textarea" name="description" defaultValue={page.description ?? ""} /></label>
            <label className="field"><span className="label">Site</span><input className="input" name="website" defaultValue={page.website ?? ""} placeholder="https://" /></label>
            <label className="field"><span className="label">Telefone</span><input className="input" name="phone" defaultValue={page.phone ?? ""} /></label>
            <SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar informações</SubmitButton>
          </form>
          <form action={updatePageImages} className="panel panel-pad space-y-3">
            <h2>Foto e capa</h2>
            <p className="sub">Cole o link público de uma imagem (JPG ou PNG).</p>
            <input type="hidden" name="page" value={id} />
            <label className="field"><span className="label">Foto de perfil</span><input className="input" name="picture" placeholder="https://…/foto.jpg" /></label>
            <label className="field"><span className="label">Capa (recomendado 1640×624)</span><input className="input" name="cover" placeholder="https://…/capa.jpg" /></label>
            <SubmitButton className="btn btn-primary" pendingText="Enviando…">Atualizar imagens</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
          <div className="space-y-3">
            {tab === "anuncios" && <p className="sub">Posts criados pelos anúncios (não aparecem no feed). É aqui que ficam os comentários dos anúncios.</p>}
            {posts.map((p) => (
              <article key={p.id} className={`panel p-4 space-y-2 ${sp.post === p.id ? "border-info" : ""}`}>
                <div className="flex gap-3">
                  {p.full_picture && <img src={p.full_picture} alt="" className="h-20 w-20 rounded-lg object-cover shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm whitespace-pre-line line-clamp-4">{p.message || <span className="text-muted">Sem texto</span>}</p>
                    <p className="text-xs text-muted mt-1">
                      {p.scheduled_publish_time
                        ? `Agendado para ${fmtDateTime(new Date(p.scheduled_publish_time * 1000).toISOString(), tz)}`
                        : fmtDateTime(p.created_time, tz)}
                      {p.comments?.summary?.total_count !== undefined && ` · ${p.comments.summary.total_count} comentário(s)`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tab !== "agendados" && <Link href={here({ post: p.id })} className="btn btn-sm">Ver comentários</Link>}
                  {p.permalink_url && <a href={p.permalink_url} target="_blank" rel="noreferrer" className="btn btn-sm">Abrir</a>}
                  {tab !== "anuncios" && (
                    <form action={deletePostAction}>
                      <input type="hidden" name="page" value={id} />
                      <input type="hidden" name="post" value={p.id} />
                      <input type="hidden" name="back" value={here({ post: undefined })} />
                      <SubmitButton className="btn btn-sm btn-danger" confirm="Excluir este post da página?">Excluir</SubmitButton>
                    </form>
                  )}
                </div>
              </article>
            ))}
            {!posts.length && !error && <p className="sub">Nada por aqui ainda.</p>}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6">
            {sp.post ? (
              <section className="panel panel-pad space-y-3">
                <div className="flex items-center justify-between">
                  <h2>Comentários</h2>
                  <Link href={here({ post: undefined })} className="btn btn-sm">Fechar</Link>
                </div>
                {comments.map((c) => (
                  <div key={c.id} className={`border-b border-[#1f3a44] pb-3 space-y-1.5 ${c.is_hidden ? "opacity-60" : ""}`}>
                    <p className="text-sm"><b>{c.from?.name ?? "Usuário"}</b> <span className="text-xs text-muted">{fmtDateTime(c.created_time, tz)}</span></p>
                    <p className="text-sm whitespace-pre-line">{c.message}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.can_hide !== false && (
                        <form action={hideCommentAction}>
                          <input type="hidden" name="page" value={id} /><input type="hidden" name="comment" value={c.id} />
                          <input type="hidden" name="hidden" value={String(!c.is_hidden)} /><input type="hidden" name="back" value={back} />
                          <SubmitButton className="btn btn-sm" pendingText="…">{c.is_hidden ? "Mostrar" : "Ocultar"}</SubmitButton>
                        </form>
                      )}
                      <form action={deleteCommentAction}>
                        <input type="hidden" name="page" value={id} /><input type="hidden" name="comment" value={c.id} /><input type="hidden" name="back" value={back} />
                        <SubmitButton className="btn btn-sm btn-danger" confirm="Excluir este comentário?">Excluir</SubmitButton>
                      </form>
                    </div>
                    <form action={replyCommentAction} className="flex gap-1.5">
                      <input type="hidden" name="page" value={id} /><input type="hidden" name="comment" value={c.id} /><input type="hidden" name="back" value={back} />
                      <input className="input !h-8 text-sm" name="message" placeholder="Responder como a página" />
                      <SubmitButton className="btn btn-sm" pendingText="…">Enviar</SubmitButton>
                    </form>
                  </div>
                ))}
                {!comments.length && <p className="sub">Sem comentários.</p>}
                <p className="text-xs text-muted">Ocultar esconde o comentário de todo mundo, menos de quem escreveu e dos amigos dele.</p>
              </section>
            ) : (
              <form action={publishPostAction} className="panel panel-pad space-y-3">
                <h2>Nova publicação</h2>
                <input type="hidden" name="page" value={id} />
                <textarea className="textarea" name="message" placeholder="Escreva o post…" />
                <label className="field"><span className="label">Link (opcional)</span><input className="input" name="link" placeholder="https://" /></label>
                <label className="field"><span className="label">Imagem por link (opcional)</span><input className="input" name="image" placeholder="https://…/imagem.jpg" /></label>
                <details>
                  <summary className="sub underline">Agendar</summary>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input className="input" type="date" name="date" min={ymdInTz(new Date(), tz)} />
                    <input className="input" type="time" name="time" defaultValue="09:00" />
                  </div>
                  <p className="text-xs text-muted mt-1">Entre 10 minutos e 30 dias a partir de agora.</p>
                </details>
                <SubmitButton className="btn btn-primary w-full" pendingText="Publicando…">Publicar</SubmitButton>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
