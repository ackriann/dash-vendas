import "server-only";
import { rawDb } from "./db";
import { env } from "./env";

// =====================================================================
// Código único do pixel (modelo Utmify): window.painelPixelId = "px_..."
// O código diz a conta e o dash; o t.js pergunta ao painel quais pixels carregar.
// =====================================================================

export interface PixelCodeTarget {
  workspaceId: string;
  /** null = código da conta (todos os pixels) */
  pixelIds: string[] | null;
}

const cache = new Map<string, { v: PixelCodeTarget | null; at: number }>();

export async function resolvePixelCode(code: string): Promise<PixelCodeTarget | null> {
  if (!/^px_[a-z0-9]{8,32}$/i.test(code)) return null;
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: PixelCodeTarget | null = null;
  const { data: ws } = await rawDb().from("workspaces").select("id").eq("pixel_code", code).maybeSingle();
  if (ws) v = { workspaceId: ws.id, pixelIds: null };
  else {
    const { data: d } = await rawDb().from("dashboards").select("workspace_id,pixel_ids").eq("pixel_code", code).maybeSingle();
    if (d) v = { workspaceId: d.workspace_id, pixelIds: d.pixel_ids?.length ? d.pixel_ids : null };
  }
  cache.set(code, { v, at: Date.now() });
  return v;
}

/** Código para colar no &lt;head&gt; do site (mesmo formato de instalação da Utmify). */
export function pixelCodeSnippet(code: string): string {
  return `<script>
  window.painelPixelId = "${code}";
  (function () {
    var p = document.createElement("script");
    p.setAttribute("async", "");
    p.setAttribute("defer", "");
    p.setAttribute("src", "${env.appUrl}/t.js");
    document.head.appendChild(p);
  })();
</script>`;
}
