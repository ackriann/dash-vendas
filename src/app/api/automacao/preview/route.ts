import { authForAccount } from "@/lib/profiles";
import { generatePreview } from "@/lib/automacao/meta-ads";
import { ensureOnAccount, getMedia } from "@/lib/automacao/media";
import { buildCreativeSpec } from "@/lib/automacao/executors";
import { normalizeDraft } from "@/lib/automacao/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORMATS = new Set(["MOBILE_FEED_STANDARD", "DESKTOP_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY", "FACEBOOK_STORY_MOBILE", "INSTAGRAM_REELS"]);

/**
 * Prévia oficial da Meta para o criativo do rascunho. Envia a mídia para a conta
 * (fica guardada e é reaproveitada na publicação) e devolve o endereço do iframe.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const d = normalizeDraft(b.draft);
    const format = FORMATS.has(b.format) ? b.format : "MOBILE_FEED_STANDARD";
    if (!d.accountId || !d.creative.pageId) return Response.json({ error: "Escolha a conta e a Página antes da prévia." }, { status: 400 });
    const auth = await authForAccount(d.accountId);
    let media = null;
    if (d.creative.mode === "media") {
      const asset = await getMedia(String(b.mediaId ?? d.creative.mediaIds[0] ?? ""));
      if (!asset) return Response.json({ error: "Escolha uma mídia para a prévia." }, { status: 400 });
      const r = await ensureOnAccount(auth, d.accountId, asset);
      if (r.state === "processing") return Response.json({ error: "A Meta ainda está processando o vídeo. Tente a prévia em alguns segundos." }, { status: 409 });
      media = { kind: asset.kind, ...r };
    }
    const body = await generatePreview(auth, d.accountId, buildCreativeSpec(d, media), format);
    const src = /src="([^"]+)"/.exec(body)?.[1]?.replace(/&amp;/g, "&") ?? "";
    if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com\//.test(src)) return Response.json({ error: "A Meta não devolveu a prévia." }, { status: 502 });
    return Response.json({ src });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Erro na prévia" }, { status: 502 });
  }
}
