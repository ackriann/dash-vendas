import Link from "next/link";
import { redirect } from "next/navigation";
import { startSession } from "@/lib/session";
import { login } from "@/lib/workspaces";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const id = await login(email, password);
  if (!id) {
    redirect(`/login?erro=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  await startSession(id);
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <form action={signIn} className="panel panel-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} />
          <div>
            <h1 className="text-xl">Painel de Vendas</h1>
            <p className="sub">Entre com o e-mail e a senha da sua conta.</p>
          </div>
        </div>
        {sp.erro && <p className="notice notice-err">E-mail ou senha incorretos.</p>}
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="field">
          <span className="label">E-mail</span>
          <input className="input" type="email" name="email" autoComplete="email" required autoFocus />
        </label>
        <label className="field">
          <span className="label">Senha</span>
          <input className="input" type="password" name="password" autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary w-full">Entrar</button>
        <p className="text-sm text-muted text-center">
          Tem um código de convite? <Link className="underline" href="/cadastro">Criar conta</Link>
        </p>
      </form>
    </main>
  );
}
