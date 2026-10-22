import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { META_SCOPES, oauthRedirectUri } from "@/lib/meta";
import { accountStatusLabel } from "@/lib/ads";
import { daysLeft, listAccounts, listProfiles, type AccountRow } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import { addProfile, checkProfile, removeProfile, renameProfile, replaceToken, saveAccounts, syncProfile } from "./actions";

const TYPE_LABEL: Record<string, string> = { USER: "Usuário", SYSTEM_USER: "Usuário do sistema" };

export default async function Perfis({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  let loadError: string | null = null;
  const [profiles, accounts] = await Promise.all([listProfiles(), listAccounts()]).catch((e) => {
    loadError = `${e?.message ?? e}. Rode supabase/migrations/002_perfis_regras.sql no SQL Editor do Supabase.`;
    return [[], []] as [[], AccountRow[]];
  });
  const byProfile = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    if (!byProfile.has(a.profile_id)) byProfile.set(a.profile_id, []);
    byProfile.get(a.profile_id)!.push(a);
  }
  const scopes = META_SCOPES.join(",");
  const explorer = "https://developers.facebook.com/tools/explorer/";
  const loginReady = !!(env.metaAppId && env.metaAppSecret);
  const redirectUri = oauthRedirectUri();

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1>Perfis Meta</h1>
        <p className="sub">Conecte quantos perfis quiser com o token e o app de cada um. As contas de anúncio ativadas aqui entram no Resumo, Campanhas e Regras.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? loadError ?? undefined} />

      {profiles.map((p) => {
        const left = daysLeft(p);
        const list = byProfile.get(p.id) ?? [];
        const missing = META_SCOPES.filter((s) => !p.scopes.includes(s));
        return (
          <section key={p.id} className="panel panel-pad space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="truncate">{p.name}</h2>
                  <span className={`pill ${p.status === "ok" ? "pill-approved" : "pill-refunded"}`}>{p.status === "ok" ? "Conectado" : "Com erro"}</span>
                </div>
                <p className="sub">
                  App <b className="text-ink">{p.app_name ?? "—"}</b> ({p.app_id}) · {TYPE_LABEL[p.token_type ?? ""] ?? p.token_type ?? "token"} · token …{p.token.slice(-6)}
                </p>
                <p className={`text-xs ${left !== null && left < 7 ? "text-spend" : "text-muted"}`}>
                  {left === null ? "Token sem vencimento" : left < 0 ? "Token vencido" : `Token vence em ${left} dia(s) · ${fmtDateTime(p.expires_at, env.timezone)}`}
                  {p.checked_at && ` · verificado ${fmtDateTime(p.checked_at, env.timezone)}`}
                </p>
                {p.last_error && <p className="text-xs neg mt-1">{p.last_error}</p>}
                {missing.length > 0 && <p className="text-xs text-muted mt-1">Sem permissão: {missing.join(", ")}</p>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <a className="btn btn-sm" href={`/api/auth/facebook?perfil=${p.id}`}>Reconectar com Facebook</a>
                <form action={checkProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pendingText="Verificando…">{p.token_type === "USER" ? "Verificar e renovar" : "Verificar"}</SubmitButton></form>
                <form action={syncProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pendingText="Buscando…">Buscar contas</SubmitButton></form>
                <form action={removeProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o perfil ${p.name}? As contas dele saem do painel.`}>Remover</SubmitButton></form>
              </div>
            </div>

            <form action={saveAccounts} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="flex items-center justify-between gap-2">
                <h3>Contas de anúncio ({list.filter((a) => a.enabled).length}/{list.length} ativas)</h3>
              </div>
              <ul className="divide-y divide-[#1f3a44] border border-line rounded-xl max-h-80 overflow-y-auto">
                {list.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                      <input type="checkbox" name="account" value={a.id} defaultChecked={a.enabled} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{a.name}</span>
                        <span className="text-xs text-muted">{a.id.replace("act_", "")} · {a.currency} · {accountStatusLabel(a.account_status)}</span>
                      </span>
                    </label>
                  </li>
                ))}
                {!list.length && <li className="px-3 py-3 sub">Nenhuma conta de anúncio neste perfil. Clique em Buscar contas.</li>}
              </ul>
              {list.length > 0 && <SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar contas</SubmitButton>}
            </form>

            <details>
              <summary className="sub underline">Trocar token, app ou nome</summary>
              <div className="mt-3 space-y-4">
                <form action={renameProfile} className="flex gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input className="input" name="name" defaultValue={p.name} aria-label="Nome do perfil" />
                  <SubmitButton className="btn" pendingText="…">Renomear</SubmitButton>
                </form>
                <form action={replaceToken} className="grid sm:grid-cols-2 gap-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field"><span className="label">App ID (vazio = manter {p.app_id})</span><input className="input num" name="app_id" inputMode="numeric" autoComplete="off" /></label>
                  <label className="field"><span className="label">Chave secreta (vazio = manter)</span><input className="input mono" name="app_secret" type="password" autoComplete="off" /></label>
                  <label className="field sm:col-span-2"><span className="label">Novo token</span><textarea className="textarea mono" name="token" placeholder="EAA…" required /></label>
                  <div><SubmitButton className="btn" pendingText="Validando…">Salvar novo token</SubmitButton></div>
                </form>
              </div>
            </details>
          </section>
        );
      })}

      <section className="panel panel-pad space-y-4">
        <div>
          <h2>{profiles.length ? "Adicionar outro perfil" : "Conectar perfil"}</h2>
          <p className="sub">Entre com o Facebook ou cole o token + app. Nos dois casos o token de usuário comum é trocado pelo de 60 dias e renovado sozinho.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {loginReady ? (
            <a className="btn btn-primary" href="/api/auth/facebook">Entrar com Facebook</a>
          ) : (
            <p className="notice notice-warn text-sm">Para o botão “Entrar com Facebook”, preencha META_APP_ID e META_APP_SECRET no servidor. Enquanto isso, use o token + app abaixo.</p>
          )}
          {loginReady && <span className="text-xs text-muted">usa o app {env.metaAppId}</span>}
        </div>
        <p className="label !mb-0 border-t border-line pt-4">Ou conecte por token + app</p>
        <form action={addProfile} className="grid sm:grid-cols-2 gap-3">
          <label className="field"><span className="label">App ID</span><input className="input num" name="app_id" inputMode="numeric" required autoComplete="off" placeholder="123456789012345" /></label>
          <label className="field"><span className="label">Chave secreta do app</span><input className="input mono" name="app_secret" type="password" required autoComplete="off" /></label>
          <label className="field sm:col-span-2"><span className="label">Token de acesso</span><textarea className="textarea mono" name="token" placeholder="EAA…" required /></label>
          <label className="field"><span className="label">Nome do perfil (opcional)</span><input className="input" name="name" placeholder="Usa o nome do Facebook" /></label>
          <div className="flex items-end"><SubmitButton className="btn btn-primary" pendingText="Validando…">Conectar perfil</SubmitButton></div>
        </form>
      </section>

      <section className="panel panel-pad space-y-4">
        <h2>Como pegar o App ID, a chave e o token</h2>
        <div className="space-y-2">
          <h3>1. App</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>Em <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a> → <b>Criar app</b> → tipo <b>Empresa</b> (ou use um app que você já tem).</li>
            <li>Adicione o caso de uso de <b>Marketing API</b> (anúncios) e, se for gerenciar páginas, o de <b>Páginas</b>.</li>
            <li>Em <b>Configurações do app → Básico</b>, copie o <b>ID do app</b> e clique em Mostrar na <b>Chave secreta do app</b>.</li>
            <li>Em modo de desenvolvimento o app já funciona para você (administrador). Para usar o perfil de outra pessoa, adicione-a em <b>Funções do app</b>.</li>
            <li>Para o login com Facebook: adicione o produto <b>Login do Facebook</b> e, em <b>URIs de redirecionamento OAuth válidos</b>, cadastre o endereço abaixo (em todo app que for usar no botão Reconectar).</li>
          </ol>
          <div className="flex gap-2 items-start">
            <code className="codebox flex-1">{redirectUri}</code>
            <CopyButton text={redirectUri} />
          </div>
        </div>
        <div className="space-y-2">
          <h3>2a. Token de usuário (vence em 60 dias, o painel renova)</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>Abra o <a className="underline" href={explorer} target="_blank" rel="noreferrer">Explorador da Graph API</a>, escolha o <b>seu app</b> em “Aplicativo da Meta” e “Token do usuário”.</li>
            <li>Em Permissões, adicione as permissões abaixo e clique em <b>Generate Access Token</b>, autorizando as contas e páginas.</li>
            <li>Copie o token e cole aqui junto com o App ID e a chave do <b>mesmo app</b>.</li>
          </ol>
        </div>
        <div className="space-y-2">
          <h3>2b. Token de usuário do sistema (não vence — recomendado)</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>Gerenciador de Negócios → <b>Configurações do negócio → Usuários do sistema</b> → Adicionar (função Administrador).</li>
            <li><b>Atribuir ativos</b>: contas de anúncio (controle total) e páginas.</li>
            <li>Em <b>Contas → Apps</b>, o app precisa estar no mesmo negócio. Depois clique em <b>Gerar novo token</b>, escolha o app, validade <b>Nunca</b> e marque as permissões.</li>
          </ol>
        </div>
        <div className="space-y-2">
          <p className="text-sm">Permissões:</p>
          <code className="codebox">{scopes}</code>
          <CopyButton text={scopes} label="Copiar permissões" />
          <p className="text-xs text-muted">ads_read é o mínimo (gasto e métricas). ads_management libera pausar, ativar, duplicar e mudar orçamento; as de pages_* liberam a tela Páginas.</p>
        </div>
      </section>
    </div>
  );
}
