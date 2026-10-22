import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { env } from "./env";

let configured = false;
function setup(): boolean {
  if (configured) return true;
  if (!env.vapidPublic || !env.vapidPrivate) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  sound?: "sale" | "alert";
}

/** Envia para todos os aparelhos inscritos. Remove inscrições expiradas. */
export async function pushAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!setup()) return { sent: 0, failed: 0 };
  const { data } = await db().from("push_subscriptions").select("*");
  let sent = 0;
  let failed = 0;
  await Promise.all(
    (data ?? []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        sent++;
      } catch (e: any) {
        failed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await db().from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }),
  );
  return { sent, failed };
}
