import { env } from "@/lib/env";
import { daysLeft, listProfiles } from "@/lib/profiles";
import { readableLabel } from "@/lib/readable-label";
import SubmitButton from "@/components/SubmitButton";
import { addProfile, checkProfile, removeProfile, renameProfile, replaceToken } from "@/app/(painel)/perfis/actions";

export default async function IntegrationProfiles() {
  const profiles = await listProfiles();
  const loginReady = Boolean(env.metaAppId && env.metaAppSecret);

  return (
    <section id="perfil" className="rounded-2xl border border-line bg-surface p-4 sm:p-5 space-y-4 min-w-0">
      <div>
        <h2>Perfil Meta</h2>
        <p className="text-sm text-muted mt-1">Conecte o perfil uma vez. Selecione as contas ao criar campanhas.</p>
      </div>
      {profiles.map((p) => {
        const days = daysLeft(p);
        return (
          <div key={p.id} className="rounded-xl border border-line bg-[#10232b] p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap gap-2 justify-between items-center">
              <div>
                <h3 className="font-semibold">{readableLabel(p.name)}</h3>
                <p className="text-xs text-muted">Token: …{p.token.slice(-6)} · {days === null ? "sem vencimento" : days < 0 ? "vencido" : `vence em ${days} dia(s)`}</p>
              </div>
              <span className={`pill ${p.status === "ok" ? "pill-approved" : "pill-refunded"}`}>
                {p.status === "ok" ? "Conectado" : "Atenção"}
              </span>
            </div>
            {p.last_error && <p className="notice notice-err text-xs">{p.last_error}</p>}
            <form action={renameProfile} className="space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="surface" value="integracoes" />
              <label className="field">
                <span className="label">Nome do perfil</span>
                <input className="input" name="name" defaultValue={p.name} required autoComplete="off"/>
              </label>
              <SubmitButton className="btn btn-sm" pendingText="Salvando…">Salvar nome</SubmitButton>
            </form>
            <form action={replaceToken} className="space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="surface" value="integracoes" />
              <label className="field">
                <span className="label">Trocar token de acesso</span>
                <textarea className="textarea mono !min-h-[78px]" name="token" placeholder="Cole o novo token EAA…" required autoComplete="off" />
              </label>
              <details className="text-sm text-muted">
                <summary className="cursor-pointer">Alterar App ID ou chave secreta (opcional)</summary>
                <div className="grid gap-2 mt-2">
                  <label className="field"><span className="label">App ID (vazio = manter)</span><input className="input" name="app_id" inputMode="numeric" autoComplete="off" /></label>
                  <label className="field"><span className="label">Chave secreta (vazio = manter)</span><input className="input" name="app_secret" type="password" autoComplete="new-password" /></label>
                </div>
              </details>
              <SubmitButton className="btn btn-sm btn-primary" pendingText="Validando…">Salvar token</SubmitButton>
            </form>
            <div className="flex flex-wrap gap-2 items-center border-t border-line pt-3">
              <form action={checkProfile}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="surface" value="integracoes" />
                <SubmitButton className="btn btn-sm" pendingText="Verificando…">Verificar perfil</SubmitButton>
              </form>
              {loginReady && <a className="btn btn-sm" href={`/api/auth/facebook?perfil=${p.id}`}>Reconectar com Facebook</a>}
              <form action={removeProfile} className="ml-auto">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="surface" value="integracoes" />
                <SubmitButton className="btn btn-sm btn-danger"
                  confirm={`Remover o perfil ${readableLabel(p.name)}? Suas contas deixarão de ter acesso no painel.`}>Remover</SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-line bg-[#10232b] p-3 sm:p-4 space-y-3">
        <h3>{profiles.length ? "Vincular outro perfil" : "Vincular perfil"}</h3>
        {loginReady && <a className="btn btn-sm btn-primary" href="/api/auth/facebook">Entrar com Facebook</a>}
        <form action={addProfile} className="space-y-2">
          <input type="hidden" name="surface" value="integracoes" />
          <label className="field"><span className="label">Token de acesso</span>
            <textarea className="textarea mono !min-h-[78px]" name="token" placeholder="Token EAA…" required autoComplete="off" /></label>
          <label className="field"><span className="label">Nome (opcional)</span>
            <input className="input" name="name" placeholder="Nome do perfil Meta" autoComplete="off" /></label>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">App ID e chave secreta (opcional)</summary>
            <div className="grid gap-2 mt-2">
              <label className="field"><span className="label">App ID</span>
                <input className="input" name="app_id" inputMode="numeric" autoComplete="off" /></label>
              <label className="field"><span className="label">Chave secreta</span>
                <input className="input" name="app_secret" type="password" autoComplete="new-password" /></label>
            </div>
          </details>
          <SubmitButton className="btn btn-primary" pendingText="Conectando…">Vincular perfil</SubmitButton>
        </form>
        <p className="text-xs text-muted">A escolha de contas e a estrutura dos anúncios ficam em Campanhas → Criar campanha.</p>
      </div>
    </section>
  );
}
