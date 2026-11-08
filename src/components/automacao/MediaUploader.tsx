"use client";
import { useRef, useState } from "react";
import type { MediaLite } from "@/lib/automacao/types";

type Item = { name: string; pct: number; error?: string };

/** Envia um arquivo para a biblioteca: o navegador manda direto ao armazenamento pela URL assinada. */
export async function uploadMedia(file: File, onPct?: (pct: number) => void): Promise<MediaLite> {
  const start = await fetch("/api/automacao/midias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }),
  }).then((r) => r.json());
  if (start.error) throw new Error(start.error);

  await new Promise<void>((ok, fail) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", start.uploadUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct?.(Math.round((e.loaded / e.total) * 95));
    xhr.onload = () => (xhr.status < 300 ? ok() : fail(new Error(`Falha no envio (HTTP ${xhr.status})`)));
    xhr.onerror = () => fail(new Error("Conexão caiu durante o envio."));
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });

  const done = await fetch("/api/automacao/midias", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: start.asset.id }),
  }).then((r) => r.json());
  if (done.error) throw new Error(done.error);
  return { id: done.asset.id, kind: done.asset.kind, name: done.asset.name, public_url: done.asset.public_url };
}

/**
 * Envio de imagens e vídeos para a biblioteca. O arquivo vai direto do navegador
 * para o armazenamento (URL assinada), sem passar pelo limite de tamanho do servidor.
 */
export default function MediaUploader({ onUploaded, compact = false }: { onUploaded?: (m: MediaLite) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);

  async function send(file: File, idx: number) {
    const set = (p: Partial<Item>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...p } : it)));
    try {
      const m = await uploadMedia(file, (pct) => set({ pct }));
      set({ pct: 100 });
      onUploaded?.(m);
    } catch (e: any) {
      set({ error: e?.message ?? "erro" });
    }
  }

  function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const offset = items.length;
    setItems((cur) => [...cur, ...list.map((f) => ({ name: f.name, pct: 0 }))]);
    list.forEach((f, i) => send(f, offset + i));
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        className={`w-full rounded-xl border border-dashed ${drag ? "border-info bg-surface-2" : "border-line"} ${compact ? "py-3" : "py-6"} text-sm text-muted hover:border-[#3b6170]`}
      >
        <b className="text-ink">Enviar imagens ou vídeos</b> — clique ou arraste aqui
        <span className="block text-xs">JPG, PNG, WEBP até 30 MB · MP4/MOV até 500 MB</span>
      </button>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" hidden onChange={(e) => pick(e.target.files)} />
      {items.map((it, i) => (
        <div key={i} className="text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate">{it.name}</span>
            <span className={it.error ? "neg" : it.pct === 100 ? "pos" : "text-muted"}>{it.error ? "falhou" : it.pct === 100 ? "pronto" : `${it.pct}%`}</span>
          </div>
          {it.error ? <p className="neg">{it.error}</p> : (
            <div className="h-1.5 rounded bg-surface-2 mt-1 overflow-hidden"><div className="h-full bg-profit transition-all" style={{ width: `${it.pct}%` }} /></div>
          )}
        </div>
      ))}
    </div>
  );
}
