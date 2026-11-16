import Link from "next/link";
import { getSetting } from "@/lib/db";
import { listAccounts, listProfiles } from "@/lib/profiles";
import { creatorPages, getDraft, listDrafts } from "@/lib/automacao/engine";
import { listMedia } from "@/lib/automacao/media";
import type { AccountLite, CatalogPrefs, MediaLite } from "@/lib/automacao/types";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import { duplicateDraftAction } from "../actions";
import Wizard from "./Wizard";
import AccountLaunchForm from "@/components/automacao/AccountLaunchForm";

type SP = Promise<{ rascunho?: string; ok?: string; erro?: string }>;

export default async function Criar({ searchParams, embedded = false, embeddedSurface }: {
  searchParams: SP;
  embedded?: boolean;
  embeddedSurface?: "resumo" | "campanhas";
}) {
  const sp = await searchParams;
  const surface = embedded ? embeddedSurface ?? "campanhas" : null;
  const createHref = (draftId?: string) =>
    surface === "resumo"
      ? `/?painel=criar${draftId ? `&rascunho=${draftId}` : ""}`
      : surface === "campanhas"
        ? `/campanhas?painel=criar${draftId ? `&rascunho=${draftId}` : ""}`
        : `/automacao/criar${draftId ? `?rascunho=${draftId}` : ""}`;
  const statusHref = (runId?: string) =>
    surface === "resumo"
      ? `/?painel=status${runId ? `&processo=${runId}` : ""}`
      : surface === "campanhas"
        ? `/campanhas?painel=status${runId ? `&processo=${runId}` : ""}`
        : runId ? `/automacao/processos/${runId}` : "/automacao/processos";
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
          <AccountLaunchForm accounts={accounts} embedded={embedded} embeddedSurface={embeddedSurface} />
        )}
        {drafts.length > 0 && (
          <section className="space-y-2">
            <h2>Continuar um rascunho</h2>
            <div className="grid gap-2">
              {drafts.map((d) => (
                <div key={d.id} className="panel px-4 py-3 flex items-center gap-3">
                  <Link href={createHref(d.id)} className="flex-1 min-w-0 hover:underline font-semibold truncate">{d.name}</Link>
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
    return <p className="notice notice-err">Rascunho não encontrado. <Link className="underline" href={createHref()}>Começar outro</Link></p>;
  }
  if (draft.status === "published" || draft.status === "queued") {
    return (
      <div className="space-y-4">
        <h1>{draft.name}</h1>
        <p className="notice notice-ok">
          Este rascunho já foi {draft.status === "queued" ? "enviado para publicação" : "publicado"}. Para criar outra campanha parecida, duplique.
        </p>
        <div className="flex gap-2">
          {draft.run_id && <Link className="btn btn-primary" href={statusHref(draft.run_id)}>Ver processo</Link>}
          {draft.data.extraAccountIds.length > 0 && <Link className="btn" href={statusHref()}>Processos de todas as contas</Link>}
          <form action={duplicateDraftAction}>{embedded && <input type="hidden" name="surface" value={surface ?? "campanhas"} />}<input type="hidden" name="id" value={draft.id} /><SubmitButton className="btn" pendingText="…">Duplicar rascunho</SubmitButton></form>
        </div>
      </div>
    );
  }

  const { pages, fromSync: pagesFromSync } = await creatorPages();
  const catalogPrefs = await getSetting<CatalogPrefs>("catalog_prefs", {});
  const media: MediaLite[] = (await listMedia().catch(() => [])).map((m) => ({ id: m.id, kind: m.kind, name: m.name, public_url: m.public_url }));

  return (
    <div className="space-y-4">
      <Notice ok={sp.ok} erro={sp.erro} />
      {draft.status === "failed" && (
        <p className="notice notice-warn">
          A última publicação falhou. Corrija aqui e publique de novo: o que já foi criado na Meta é reaproveitado.{" "}
          {draft.run_id && <Link className="underline" href={statusHref(draft.run_id)}>Ver o que falhou</Link>}
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
        catalogPrefs={catalogPrefs}
        embedded={embedded}
        embeddedSurface={embeddedSurface}
      />
    </div>
  );
}
