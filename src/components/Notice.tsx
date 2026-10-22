"use client";
import { useEffect, useState } from "react";

/**
 * Aviso em pop-up (canto da tela) no tom do painel.
 * Sucesso some sozinho; erro fica até fechar. Limpa ?ok= / ?erro= da URL.
 */
export default function Notice({ ok, erro }: { ok?: string; erro?: string }) {
  const msg = erro ?? ok;
  const [open, setOpen] = useState(!!msg);

  useEffect(() => {
    setOpen(!!msg);
    if (!msg) return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("ok") || u.searchParams.has("erro")) {
        u.searchParams.delete("ok");
        u.searchParams.delete("erro");
        window.history.replaceState(window.history.state, "", u.pathname + (u.search ? u.search : "") + u.hash);
      }
    } catch {
      /* ignora */
    }
    if (!erro) {
      const t = setTimeout(() => setOpen(false), 6000);
      return () => clearTimeout(t);
    }
  }, [msg, erro]);

  if (!msg || !open) return null;
  return (
    <div className={`toast ${erro ? "toast-err" : "toast-ok"}`} role={erro ? "alert" : "status"}>
      <span className="toast-icon" aria-hidden>{erro ? "!" : "✓"}</span>
      <div className="flex-1 min-w-0">
        <p className="toast-title">{erro ? "Não deu certo" : "Pronto"}</p>
        <p className="toast-msg">{msg}</p>
      </div>
      <button type="button" className="toast-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
    </div>
  );
}
