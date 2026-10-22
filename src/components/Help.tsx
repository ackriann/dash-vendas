"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Ícone “?” que abre um pop-up com a explicação, para não poluir a tela. */
export default function Help({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        type="button"
        className={label ? "help-link" : "help-btn"}
        onClick={(e) => {
          // Dentro do título de uma lista: não abre/fecha a lista
          e.preventDefault();
          e.stopPropagation();
          ref.current?.showModal();
        }}
        aria-label={`Ajuda: ${title}`}
        title="Como fazer"
      >
        {label ? <><span className="help-dot" aria-hidden>?</span>{label}</> : "?"}
      </button>
      {mounted &&
        createPortal(
          // Fora da lista (no body), para os cliques no pop-up não abrirem/fecharem a lista
          <dialog ref={ref} className="modal" onClick={(e) => e.target === ref.current && ref.current?.close()}>
            <div className="modal-head">
              <h3>{title}</h3>
              <button type="button" className="toast-close" onClick={() => ref.current?.close()} aria-label="Fechar">×</button>
            </div>
            <div className="modal-body">{children}</div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
