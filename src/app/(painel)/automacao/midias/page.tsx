import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { listAccounts } from "@/lib/profiles";
import { listMedia, type MediaAsset } from "@/lib/automacao/media";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { deleteMediaAction } from "../actions";
import Uploader from "./Uploader";

const size = (b: number | null) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default async function Midias({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; tipo?: string }> }) {
  const sp = await searchParams;
  let media: MediaAsset[] = [];
  let error: string | null = null;
  try {
    media = await listMedia();
  } catch (e: any) {
    error = `Rode a migração 005_automacao.sql no Supabase: ${e?.message}`;
  }
  const accounts = await listAccounts().catch(() => []);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const list = sp.tipo === "video" || sp.tipo === "image" ? media.filter((m) => m.kind === sp.tipo) : media;
  const tz = env.timezone;

  return (
    <div className="space-y-5">
      <header>
        <h1>Imagens e vídeos</h1>
        <p className="sub">Biblioteca usada nos anúncios e nos catálogos. Cada mídia é enviada para a conta de anúncio só uma vez e reaproveitada depois.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? error ?? undefined} />
      <section className="panel panel-pad"><Uploader /></section>

      <div className="seg">
        <a href="/automacao/midias" aria-current={!sp.tipo ? "true" : undefined}>Todas ({media.length})</a>
        <a href="/automacao/midias?tipo=image" aria-current={sp.tipo === "image" ? "true" : undefined}>Imagens</a>
        <a href="/automacao/midias?tipo=video" aria-current={sp.tipo === "video" ? "true" : undefined}>Vídeos</a>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {list.map((m) => {
          const sent = Object.keys(m.meta_ids ?? {});
          return (
            <article key={m.id} className="panel overflow-hidden">
              <div className="aspect-square bg-[#0b171c]">
                {m.kind === "image" ? (
                  <img src={m.public_url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <video src={m.public_url} className="w-full h-full object-cover" muted preload="metadata" controls />
                )}
              </div>
              <div className="p-3 space-y-1">
                <p className="text-sm font-semibold truncate" title={m.name}>{m.name}</p>
                <p className="text-xs text-muted">{m.kind === "image" ? "Imagem" : "Vídeo"} · {size(m.size_bytes)} · {fmtDateTime(m.created_at, tz)}</p>
                <p className="text-xs text-muted truncate" title={sent.map(accName).join(", ")}>
                  {sent.length ? `Na Meta: ${sent.map(accName).join(", ")}` : "Ainda não enviada à Meta"}
                </p>
                <form action={deleteMediaAction} className="pt-1">
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={`Excluir ${m.name} da biblioteca? Anúncios já publicados não mudam.`}>Excluir</SubmitButton>
                </form>
              </div>
            </article>
          );
        })}
        {!list.length && !error && <p className="sub col-span-full">Nenhuma mídia ainda. Envie acima.</p>}
      </section>
    </div>
  );
}
