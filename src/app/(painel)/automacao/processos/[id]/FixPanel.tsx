"use client";
import Link from "next/link";
import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import type { DraftData, PageLite } from "@/lib/automacao/types";
import { fixAndContinueAction } from "../../actions";

/**
 * Corrigir e continuar sem sair do processo: o que costuma barrar o anúncio
 * (Página, Instagram, link, textos). Salva no processo e no rascunho e segue
 * de onde parou; o criativo do anúncio que falhou é refeito.
 */
export default function FixPanel({ runId, draftId, draft, pages, error }: { runId: string; draftId?: string | null; draft: DraftData; pages: PageLite[]; error?: string | null }) {
  const [pageId, setPageId] = useState(draft.creative.pageId);
  const page = pages.find((p) => p.id === pageId);
  const igError = /instagram/i.test(error ?? "");
  return (
    <form action={fixAndContinueAction} className="panel panel-pad grid gap-3">
      <input type="hidden" name="id" value={runId} />
      <div>
        <h2>Corrigir e continuar aqui</h2>
        <p className="sub">Ajuste e clique em continuar: o que já foi criado na Meta é reaproveitado.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="field">
          <span className="label">Página do Facebook</span>
          <select className="select" name="page" value={pageId} onChange={(e) => setPageId(e.target.value)}>
            {!pages.some((p) => p.id === pageId) && <option value={pageId}>{pageId}</option>}
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Instagram</span>
          <select className="select" name="instagram" defaultValue={draft.creative.instagramId}>
            <option value="">Automático: Instagram ligado à Página ou a própria Página</option>
            {page?.instagram_id && <option value={page.instagram_id}>@{page.instagram_username ?? page.instagram_id} (ligado à Página)</option>}
            {draft.creative.instagramId && draft.creative.instagramId !== page?.instagram_id && <option value={draft.creative.instagramId}>Perfil escolhido no rascunho ({draft.creative.instagramId})</option>}
          </select>
          {igError && <span className="text-xs text-muted">No automático, o painel usa o Instagram da Página ou cria a identidade da Página no Instagram (recurso oficial da Meta).</span>}
        </label>
      </div>
      {igError && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="instagram_off" value="1" /> Não anunciar no Instagram (só Facebook)
        </label>
      )}
      <label className="field"><span className="label">URL de destino</span><input className="input" name="url" type="url" defaultValue={draft.creative.url} /></label>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="field"><span className="label">Título</span><input className="input" name="headline" maxLength={255} defaultValue={draft.creative.headline} /></label>
        <label className="field"><span className="label">Texto principal — opcional</span><textarea className="textarea" name="message" rows={2} defaultValue={draft.creative.message} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-primary" pendingText="Continuando…">Salvar e continuar</SubmitButton>
        {draftId && <Link className="btn" href={`/automacao/criar?rascunho=${draftId}`}>Outras correções no rascunho</Link>}
      </div>
    </form>
  );
}
