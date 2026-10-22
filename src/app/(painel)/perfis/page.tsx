import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { META_SCOPES, oauthRedirectUri } from "@/lib/meta";
import { accountStatusLabel } from "@/lib/ads";
import { daysLeft, listAccounts, listProfiles, type AccountRow } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import Help from "@/components/Help";
import Acc from "@/components/Acc";
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

  const tutorial = (
    <Help title="Como gerar o token" label="Como gerar o token">
      <p>Não precisa de app aprovado pela Meta: para o seu perfil e as suas contas, um app em <b>modo de desenvolvimento</b> já tem todas as permissões.</p>
      <p><b>Opção 1 — Token que não vence (recomendado)</b></p>
      <ol>
        <li>Se ainda não tem um app: <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a> → <b>Criar app</b> → tipo <b>Empresa</b>, ligado ao seu Gerenciador de Negócios.</li>
        <li>Gerenciador de Negócios → <b>Configurações do negócio → Usuários do sistema</b> → Adicionar (Administrador).</li>
        <li><b>Atribuir ativos</b>: contas de anúncio (controle total) e páginas.</li>
        <li><b>Gerar novo token</b> → escolha o app → validade <b>Nunca</b> → marque as permissões → copie e cole aqui.</li>
      </ol>
      <p><b>Opção 2 — Token do seu perfil</b></p>
      <ol>
        <li>Abra o <a className="underline" href={explorer} target="_blank" rel="noreferrer">Explorador da Graph API</a>, escolha o seu app e “Token do usuário”.</li>
        <li>Adicione as permissões, clique em <b>Generate Access Token</b> e autorize.</li>
        <li>Vence em poucas horas: preencha também <b>App ID</b> e <b>chave secreta</b> para virar de 60 dias e o painel renovar sozinho.</li>
      </ol>
      <p><b>Permissões</b> (ads_read é o mínimo; ads_management libera pausar e mudar orçamento; pages_* libera a tela Páginas):</p>
      <code className="codebox">{scopes}</code>
      <div className="mt-2"><CopyButton text={scopes} label="Copiar permissões" /></div>
      <p><b>Login com Facebook (opcional):</b> no app, adicione <b>Login do Facebook</b> e cadastre em URIs de redirecionamento OAuth:</p>
      <code className="codebox">{redirectUri}</code>
    </Help>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1>Perfis Meta</h1>
          <p className="sub">Clique no perfil para ver as contas de anúncio.</p>
        </div>
        {tutorial}
      </header>
      <Notice ok={sp.ok} erro={sp.erro ?? loadError ?? undefined} />

      <section>
        {profiles.map((p) => {
          const left = daysLeft(p);
          const list = byProfile.get(p.id) ?? [];
          const on = list.filter((a) => a.enabled).length;
          const missing = META_SCOPES.filter((s) => !p.scopes.includes(s));
          const expiring = left !== null && left < 7;
          return (
            <Acc
              key={p.id}
              title={p.name}
              sub={`${on}/${list.length} contas ativas · ${left === null ? "token sem vencimento" : left < 0 ? "token vencido" : `token vence em ${left} dia(s)`}`}
              open={profiles.length === 1 || p.status !== "ok"}
              right={
                <span className={`pill ${p.status !== "ok" ? "pill-refunded" : expiring ? "pill-pending" : "pill-approved"}`}>
                  {p.status !== "ok" ? "Com erro" : expiring ? "Renovar" : "Conectado"}
                </span>
              }
            >
              {p.last_error && <div className="notice notice-err text-sm">{p.last_error}</div>}

              <form action={saveAccounts} className="space-y-3">
                <input type="hidden" name="id" value={p.id} />
                <p className="label !mb-0">Contas de anúncio — marque as que entram no painel</p>
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

              <Acc title="Detalhes do token" sub={`${TYPE_LABEL[p.token_type ?? ""] ?? p.token_type ?? "token"} · app ${p.app_name ?? p.app_id}`}>
                <ul className="text-sm space-y-1 text-muted">
                  <li>App: <b className="text-ink">{p.app_name ?? "—"}</b> ({p.app_id}){p.app_secret ? " · com chave secreta" : " · sem chave secreta"}</li>
                  <li>Token …{p.token.slice(-6)} · {left === null ? "não vence" : `vence ${fmtDateTime(p.expires_at, env.timezone)}`}</li>
                  {p.checked_at && <li>Verificado {fmtDateTime(p.checked_at, env.timezone)}</li>}
                  {missing.length > 0 && <li>Sem permissão: {missing.join(", ")}</li>}
                </ul>
                <div className="flex gap-2 flex-wrap">
                  <form action={checkProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pendingText="Verificando…">{p.token_type === "USER" && p.app_secret ? "Verificar e renovar" : "Verificar"}</SubmitButton></form>
                  <form action={syncProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pendingText="Buscando…">Buscar contas</SubmitButton></form>
                  {loginReady && <a className="btn btn-sm" href={`/api/auth/facebook?perfil=${p.id}`}>Reconectar com Facebook</a>}
                </div>
              </Acc>

              <Acc title="Trocar token ou nome">
                <form action={renameProfile} className="flex gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input className="input" name="name" defaultValue={p.name} aria-label="Nome do perfil" />
                  <SubmitButton className="btn" pendingText="…">Renomear</SubmitButton>
                </form>
                <form action={replaceToken} className="grid sm:grid-cols-2 gap-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field sm:col-span-2"><span className="label">Novo token</span><textarea className="textarea mono" name="token" placeholder="EAA…" required /></label>
                  <label className="field"><span className="label">App ID (vazio = manter)</span><input className="input num" name="app_id" inputMode="numeric" autoComplete="off" /></label>
                  <label className="field"><span className="label">Chave secreta (vazio = manter)</span><input className="input mono" name="app_secret" type="password" autoComplete="off" /></label>
                  <div><SubmitButton className="btn" pendingText="Validando…">Salvar novo token</SubmitButton></div>
                </form>
              </Acc>

              <div className="flex justify-end">
                <form action={removeProfile}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o perfil ${p.name}? As contas dele saem do painel.`}>Remover perfil</SubmitButton></form>
              </div>
            </Acc>
          );
        })}

        <Acc title={profiles.length ? "Adicionar outro perfil" : "Conectar perfil"} sub="Cole o token — o painel descobre o app e as contas sozinho" open={!profiles.length}>
          {loginReady && (
            <div className="flex items-center gap-3 flex-wrap border-b border-line pb-4">
              <a className="btn btn-primary" href="/api/auth/facebook">Entrar com Facebook</a>
              <span className="text-xs text-muted">ou cole o token abaixo</span>
            </div>
          )}
          <form action={addProfile} className="space-y-3">
            <label className="field">
              <span className="label flex items-center gap-2">Token de acesso {tutorial}</span>
              <textarea className="textarea mono" name="token" placeholder="EAA…" required />
            </label>
            <label className="field"><span className="label">Nome do perfil (opcional)</span><input className="input" name="name" placeholder="Usa o nome do Facebook" /></label>
            <Acc title="App ID e chave secreta (opcional)" sub="Com eles o token de usuário vira de 60 dias e o painel renova sozinho">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="field"><span className="label">App ID</span><input className="input num" name="app_id" inputMode="numeric" autoComplete="off" placeholder="123456789012345" /></label>
                <label className="field"><span className="label">Chave secreta do app</span><input className="input mono" name="app_secret" type="password" autoComplete="off" /></label>
              </div>
            </Acc>
            <SubmitButton className="btn btn-primary" pendingText="Validando…">Conectar perfil</SubmitButton>
          </form>
        </Acc>
      </section>
    </div>
  );
}
