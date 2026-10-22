import { pushAll } from "@/lib/push";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST() {
  if (!env.vapidPublic || !env.vapidPrivate) {
    return Response.json({ error: "Configure as chaves VAPID no .env (npm run vapid)." }, { status: 400 });
  }
  const r = await pushAll({ title: "Venda aprovada! 💸", body: "Valor: R$ 197,00 · Teste de notificação", url: "/vendas", sound: "sale" });
  return Response.json(r);
}
