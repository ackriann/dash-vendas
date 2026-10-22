import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, safeEqual, SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!safeEqual(password, env.adminPassword)) {
    redirect(`/login?erro=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  const { token, maxAge } = await createSessionToken(env.sessionSecret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <form action={login} className="panel panel-pad w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} />
          <div>
            <h1 className="text-xl">Painel de Vendas</h1>
            <p className="sub">Entre com a senha definida no servidor.</p>
          </div>
        </div>
        {sp.erro && <p className="notice notice-err">Senha incorreta.</p>}
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="field">
          <span className="label">Senha</span>
          <input className="input" type="password" name="password" autoComplete="current-password" required autoFocus />
        </label>
        <button className="btn btn-primary w-full">Entrar</button>
      </form>
    </main>
  );
}
