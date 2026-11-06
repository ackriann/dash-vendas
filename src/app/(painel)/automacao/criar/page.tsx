import Link from "next/link";
import { db } from "@/lib/db";
import { listAccounts, listAllPages, listProfiles } from "@/lib/profiles";
import { getDraft, listDrafts } from "@/lib/automacao/engine";
import { listMedia } from "@/lib/automacao/media";
import type { AccountLite, MediaLite, PageLite } from "@/lib/automacao/types";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { duplicateDraftAction, newDraftAction } from "../actions";
import Wizard from "./Wizard";

type SP = Promise<{ rascunho?: string; ok?: string; erro?: string }>;

export default async function Criar({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [profiles, accountsRaw] = await Promise.all([listProfiles().catch(() => []), listAccounts().catch(() => [])]);
  const accounts: AccountLite[] = accountsRaw
    .map((a) => ({
      id: a.id, name: a.name, currency: a.currency, enabled: a.enabled, account_status: a.account_status,
      profile_name: profiles.find((p) => p.id === a.profile_id)?.name ?? "",
    }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));

  if (!sp.rascunho) {
    const drafts = (await listDrafts(10).catch(() => [])).filter((d) => d.status === "draft" || d.status === "failed");
    return (
      <div className="space-y-5">
        <header>
          <h1>Criar campanha</h1>
          <p className="sub">Campanha → conjunto → criativos → revisão. Tudo fica salvo como rascunho enquanto você monta.</p>
        </header>
        <Notice ok={sp.ok} erro={sp.erro} />
        {!accounts.length ? (
          <p className="notice notice-warn">Nenhuma conta de anúncio nas conexões. Conecte em <Link className="underline" href="/perfis">Perfis Meta</Link>.</p>
        ) : (
          <form action={newDraftAction} className="panel panel-pad flex flex-wrap gap-3 items-end max-w-2xl">
            <label className="field flex-1 min-w-64">
              <span className="label">Conta de anúncio</span>
              <select className="select" name="account" defaultValue={accounts[0]?.id}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.profile_name}{a.enabled ? "" : " (fora do painel)"}</option>)}
              </select>
            </label>
            <SubmitButton className="btn btn-primary" pendingText="Abrindo…">Começar</SubmitButton>
          </form>
        )}
        {drafts.length > 0 && (
          <section className="space-y-2">
            <h2>Continuar um rascunho</h2>
            <div className="grid gap-2">
              {drafts.map((d) => (
                <div key={d.id} className="panel px-4 py-3 flex items-center gap-3">
                  <Link href={`/automacao/criar?rascunho=${d.id}`} className="flex-1 min-w-0 hover:underline font-semibold truncate">{d.name}</Link>
                  <span className={`pill ${d.status === "failed" ? "pill-refunded" : ""}`}>{d.status === "failed" ? "Falhou" : `Etapa ${d.step}`}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const draft = await getDraft(sp.rascunho);
  if (!draft) {
    return <p className="notice notice-err">Rascunho não encontrado. <Link className="underline" href="/automacao/criar">Começar outro</Link></p>;
  }
  if (draft.status === "published" || draft.status === "queued") {
    return (
      <div className="space-y-4">
        <h1>{draft.name}</h1>
        <p className="notice notice-ok">
          Este rascunho já foi {draft.status === "queued" ? "enviado para publicação" : "publicado"}. Para criar outra campanha parecida, duplique.
        </p>
        <div className="flex gap-2">
          {draft.run_id && <Link className="btn btn-primary" href={`/automacao/processos/${draft.run_id}`}>Ver processo</Link>}
          <form action={duplicateDraftAction}><input type="hidden" name="id" value={draft.id} /><SubmitButton className="btn" pendingText="…">Duplicar rascunho</SubmitButton></form>
        </div>
      </div>
    );
  }

  // Páginas: as sincronizadas e liberadas no criador; sem sincronização, as das conexões
  const { data: synced } = await db().from("fb_pages").select("*").eq("enabled_in_creator", true).order("name");
  let pages: PageLite[] = (synced ?? []).map((p: any) => ({
    id: p.page_id, name: p.name, picture_url: p.picture_url, instagram_id: p.instagram_id, instagram_username: p.instagram_username,
    ads_running: p.ads_running, ads_limit: p.ads_limit,
  }));
  const pagesFromSync = pages.length > 0;
  if (!pagesFromSync) {
    const live = await listAllPages().catch(() => ({ pages: [], errors: [] }));
    pages = live.pages.map((p) => ({ id: p.id, name: p.name, picture_url: p.picture?.data?.url ?? null, instagram_id: null, instagram_username: null, ads_running: null, ads_limit: null }));
  }
  const media: MediaLite[] = (await listMedia().catch(() => [])).map((m) => ({ id: m.id, kind: m.kind, name: m.name, public_url: m.public_url }));

  return (
    <div className="space-y-4">
      <Notice ok={sp.ok} erro={sp.erro} />
      {draft.status === "failed" && (
        <p className="notice notice-warn">
          A última publicação falhou. Corrija aqui e publique de novo: o que já foi criado na Meta é reaproveitado.{" "}
          {draft.run_id && <Link className="underline" href={`/automacao/processos/${draft.run_id}`}>Ver o que falhou</Link>}
        </p>
      )}
      <Wizard
        draftId={draft.id}
        initial={draft.data}
        initialStep={draft.step}
        accounts={accounts}
        pages={pages}
        pagesFromSync={pagesFromSync}
        media={media}
      />
    </div>
  );
}
