import Link from "next/link";
import { redirect } from "next/navigation";
import { checkInviteCode, createWorkspace } from "@/lib/workspaces";
import { startSession } from "@/lib/session";

async function signUp(formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) ?? "");
  const fail = (msg: string): never => redirect(`/cadastro?erro=${encodeURIComponent(msg)}&email=${encodeURIComponent(get("email"))}&nome=${encodeURIComponent(get("name"))}`);
  if (!(await checkInviteCode(get("invite")))) fail("Código de convite inválido.");
  if (get("password") !== get("password2")) fail("As senhas não conferem.");
  const r = await createWorkspace({ email: get("email"), name: get("name"), password: get("password") });
  if (!r.id) fail(r.error ?? "Não foi possível criar a conta.");
  await startSession(r.id!);
  redirect("/perfis");
}

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ erro?: string; email?: string; nome?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <form action={signUp} className="panel panel-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} />
          <div>
            <h1 className="text-xl">Criar conta</h1>
            <p className="sub">Uma conta nova é um painel separado: Meta, checkouts, pixel e vendas próprios.</p>
          </div>
        </div>
        {sp.erro && <p className="notice notice-err">{sp.erro}</p>}
        <label className="field">
          <span className="label">Nome da conta</span>
          <input className="input" name="name" defaultValue={sp.nome ?? ""} placeholder="Ex.: Produto B" maxLength={60} />
        </label>
        <label className="field">
          <span className="label">E-mail</span>
          <input className="input" type="email" name="email" defaultValue={sp.email ?? ""} autoComplete="email" required />
        </label>
        <label className="field">
          <span className="label">Senha (mínimo 8 caracteres)</span>
          <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required />
        </label>
        <label className="field">
          <span className="label">Repita a senha</span>
          <input className="input" type="password" name="password2" autoComplete="new-password" minLength={8} required />
        </label>
        <label className="field">
          <span className="label">Código de convite</span>
          <input className="input mono" name="invite" autoComplete="off" required />
        </label>
        <button className="btn btn-primary w-full">Criar conta</button>
        <p className="text-sm text-muted text-center">
          Já tem conta? <Link className="underline" href="/login">Entrar</Link>
        </p>
      </form>
    </main>
  );
}
