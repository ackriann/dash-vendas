// Sessão por conta: cookie assinado com HMAC-SHA256 que guarda o id da conta.
// Funciona tanto no proxy quanto em rotas/ações do servidor (Web Crypto).

export const SESSION_COOKIE = "painel_session";
const MAX_AGE_DAYS = 30;

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Cookie de sessão: v2.<conta>.<expira>.<assinatura> */
export async function createSessionToken(secret: string, workspaceId: string): Promise<{ token: string; maxAge: number }> {
  const maxAge = MAX_AGE_DAYS * 24 * 3600;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `v2.${workspaceId}.${exp}`;
  return { token: `${payload}.${await hmac(secret, payload)}`, maxAge };
}

/** Devolve o id da conta logada, ou null se o cookie for inválido/expirado. */
export async function verifySessionToken(token: string | undefined, secret: string): Promise<string | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [v, ws, expStr, sig] = parts;
  const exp = Number(expStr);
  if (v !== "v2" || !/^[0-9a-f-]{36}$/.test(ws) || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  return safeEqual(sig, await hmac(secret, `${v}.${ws}.${expStr}`)) ? ws : null;
}
