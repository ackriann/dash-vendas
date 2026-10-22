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
                  App <b className="text-ink">{p.app_name ?? "—"}</b> ({p.app_id}){!p.app_secret && " · sem chave"} · {TYPE_LABEL[p.token_type ?? ""] ?? p.token_type ?? "token"} · token …{p.token.slice(-6)}
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
                <form action={checkProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pendingText="Verificando…">{p.token_type === "USER" && p.app_secret ? "Verificar e renovar" : "Verificar"}</SubmitButton></form>
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
          <p className="sub">Cole o token de acesso — o painel descobre o app e as contas de anúncio sozinho.</p>
        </div>
        {loginReady && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <a className="btn btn-primary" href="/api/auth/facebook">Entrar com Facebook</a>
              <span className="text-xs text-muted">usa o app {env.metaAppId}</span>
            </div>
            <p className="label !mb-0 border-t border-line pt-4">Ou cole o token</p>
          </>
        )}
        <form action={addProfile} className="space-y-3">
          <label className="field"><span className="label">Token de acesso</span><textarea className="textarea mono" name="token" placeholder="EAA…" required /></label>
          <label className="field"><span className="label">Nome do perfil (opcional)</span><input className="input" name="name" placeholder="Usa o nome do Facebook" /></label>
          <details className="border border-line rounded-xl p-3">
            <summary className="text-sm">
              <b>App ID e chave secreta</b> <span className="text-muted">(opcional — com eles o token de usuário vira de 60 dias e o painel renova sozinho)</span>
            </summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <label className="field"><span className="label">App ID</span><input className="input num" name="app_id" inputMode="numeric" autoComplete="off" placeholder="123456789012345" /></label>
              <label className="field"><span className="label">Chave secreta do app</span><input className="input mono" name="app_secret" type="password" autoComplete="off" /></label>
            </div>
          </details>
          <SubmitButton className="btn btn-primary" pendingText="Validando…">Conectar perfil</SubmitButton>
        </form>
      </section>

      <section className="panel panel-pad space-y-4">
        <h2>Como gerar o token</h2>
        <p className="text-sm text-muted">
          Não precisa de app aprovado pela Meta. A revisão só é exigida para usar o app com pessoas de fora dele; para o seu perfil e as suas contas, um
          app em <b>modo de desenvolvimento</b> já tem todas as permissões.
        </p>
        <div className="space-y-2">
          <h3>Opção 1 — Token que não vence (recomendado)</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>Se ainda não tem um app: <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a> → <b>Criar app</b> → tipo <b>Empresa</b>, ligado ao seu Gerenciador de Negócios. Pode deixar em desenvolvimento.</li>
            <li>Gerenciador de Negócios → <b>Configurações do negócio → Usuários → Usuários do sistema</b> → Adicionar (função Administrador).</li>
            <li><b>Atribuir ativos</b>: as contas de anúncio (controle total) e as páginas.</li>
            <li><b>Gerar novo token</b> → escolha o app → validade <b>Nunca</b> → marque as permissões abaixo → copie e cole aqui. Só o token já basta.</li>
          </ol>
        </div>
        <div className="space-y-2">
          <h3>Opção 2 — Token do seu perfil</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
            <li>Abra o <a className="underline" href={explorer} target="_blank" rel="noreferrer">Explorador da Graph API</a>, escolha o <b>seu app</b> e “Token do usuário”.</li>
            <li>Adicione as permissões abaixo, clique em <b>Generate Access Token</b> e autorize as contas e páginas.</li>
            <li>Esse token vence em poucas horas. Para virar de 60 dias e o painel renovar sozinho, preencha também o <b>App ID</b> e a <b>chave secreta</b> do mesmo app (Configurações do app → Básico).</li>
          </ol>
        </div>
        <details>
          <summary className="sub underline">Login com Facebook (opcional)</summary>
          <p className="text-sm text-muted mt-2">
            Para o botão “Entrar com Facebook”: no app, adicione o produto <b>Login do Facebook</b> e cadastre em <b>URIs de redirecionamento OAuth válidos</b> o endereço
            abaixo. No servidor, preencha META_APP_ID e META_APP_SECRET com esse app.
          </p>
          <div className="flex gap-2 items-start mt-2">
            <code className="codebox flex-1">{redirectUri}</code>
            <CopyButton text={redirectUri} />
          </div>
        </details>
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
