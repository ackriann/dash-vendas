// Padrão de UTMs recomendado para os anúncios (mesmo formato usado pela Utmify):
// utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}

export const RECOMMENDED_UTM =
  "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

export interface Utms {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

/** Pega o ID numérico depois do último "|" (ex.: "Campanha X|1202..." -> "1202..."). */
export function idFromUtm(v?: string | null): string | null {
  if (!v) return null;
  const decoded = safeDecode(v);
  const parts = decoded.split("|");
  const last = parts[parts.length - 1]?.trim();
  return last && /^\d{6,}$/.test(last) ? last : null;
}

export function nameFromUtm(v?: string | null): string | null {
  if (!v) return null;
  const decoded = safeDecode(v);
  const i = decoded.lastIndexOf("|");
  return (i > 0 ? decoded.slice(0, i) : decoded).trim() || null;
}

export function metaIdsFromUtms(u: Utms) {
  return {
    campaign_id: idFromUtm(u.utm_campaign),
    adset_id: idFromUtm(u.utm_medium),
    ad_id: idFromUtm(u.utm_content),
  };
}

export function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
}

/** Lê UTMs de uma query string qualquer (ex.: sck/src da Hotmart ou um link completo). */
export function utmsFromQuery(qs: string | null | undefined): Utms {
  if (!qs) return {};
  try {
    const s = qs.includes("?") ? qs.slice(qs.indexOf("?") + 1) : qs;
    const p = new URLSearchParams(s);
    const out: Utms = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
      const v = p.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Código do pixel para colar no site (mesmo formato de instalação da Utmify). */
export function pixelSnippet(appUrl: string, pixelIds: string[]): string {
  return `<script>
  window.painelPixelId = "${pixelIds.join(",")}";
  (function () {
    var p = document.createElement("script");
    p.setAttribute("async", "");
    p.setAttribute("defer", "");
    p.setAttribute("src", "${appUrl}/t.js");
    document.head.appendChild(p);
  })();
</script>`;
}
