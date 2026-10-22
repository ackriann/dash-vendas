"use client";
import { useMemo, useState } from "react";
import CopyButton from "./CopyButton";

const FIELDS = [
  ["utm_source", "Origem (utm_source)", "instagram"],
  ["utm_medium", "Meio (utm_medium)", "bio"],
  ["utm_campaign", "Campanha (utm_campaign)", "lancamento-outubro"],
  ["utm_content", "Conteúdo (utm_content)", "link-1"],
  ["utm_term", "Termo (utm_term)", ""],
] as const;

/** Monta um link com UTMs para tráfego orgânico, bio, e-mail, influenciador… */
export default function UtmBuilder() {
  const [url, setUrl] = useState("");
  const [v, setV] = useState<Record<string, string>>({});
  const link = useMemo(() => {
    if (!url) return "";
    try {
      const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
      for (const [k] of FIELDS) {
        if (v[k]) u.searchParams.set(k, v[k]);
        else u.searchParams.delete(k);
      }
      return u.toString();
    } catch {
      return "";
    }
  }, [url, v]);

  return (
    <div className="space-y-3">
      <label className="field">
        <span className="label">Link da página</span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://minhapagina.com/oferta" />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, label, ph]) => (
          <label key={k} className="field">
            <span className="label">{label}</span>
            <input className="input" value={v[k] ?? ""} placeholder={ph} onChange={(e) => setV({ ...v, [k]: e.target.value.trim() })} />
          </label>
        ))}
      </div>
      {link ? (
        <div className="space-y-2">
          <code className="codebox">{link}</code>
          <CopyButton text={link} label="Copiar link" />
        </div>
      ) : (
        <p className="text-xs text-muted">Preencha o link para gerar.</p>
      )}
    </div>
  );
}
