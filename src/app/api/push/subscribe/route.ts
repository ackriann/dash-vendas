import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sub = await req.json().catch(() => null);
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return Response.json({ error: "inscrição inválida" }, { status: 400 });
  }
  const { error } = await db().from("push_subscriptions").upsert({
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await db().from("push_subscriptions").delete().eq("endpoint", endpoint);
  return Response.json({ ok: true });
}
