import Link from "next/link";
import type { MediaLite } from "@/lib/automacao/types";

/** Grade de mídias da biblioteca com caixas de seleção (para formulários do servidor). */
export default function MediaChecklist({ media, name = "media", selected = [], only }: { media: MediaLite[]; name?: string; selected?: string[]; only?: "image" | "video" }) {
  const list = only ? media.filter((m) => m.kind === only) : media;
  if (!list.length) {
    return <p className="text-sm text-muted">Nenhuma {only === "video" ? "vídeo" : only === "image" ? "imagem" : "mídia"} na biblioteca. <Link className="underline" href="/automacao/midias">Enviar mídias</Link></p>;
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2 max-h-[320px] overflow-y-auto pr-1">
      {list.map((m) => (
        <label key={m.id} className="media-tile" title={m.name}>
          <input type="checkbox" className="sr-only" name={name} value={m.id} defaultChecked={selected.includes(m.id)} />
          {m.kind === "image" ? <img src={m.public_url} alt={m.name} loading="lazy" /> : <video src={m.public_url} muted preload="metadata" />}
          <span className="media-badge">{m.kind === "image" ? "IMG" : "VÍDEO"}</span>
        </label>
      ))}
    </div>
  );
}
