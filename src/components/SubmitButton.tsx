"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

/** Botão de envio com estado de “aguarde” e confirmação em pop-up no tom do painel. */
export default function SubmitButton({
  children,
  pendingText,
  confirm,
  className = "btn",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  confirm?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const btn = useRef<HTMLButtonElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const danger = /remov|exclu|apag|desconect|delet/i.test(confirm ?? "") || className.includes("btn-danger");
  return (
    <>
      <button
        ref={btn}
        className={className}
        disabled={pending}
        name={name}
        value={value}
        onClick={(e) => {
          if (confirm && dlg.current && !dlg.current.dataset.ok) {
            e.preventDefault();
            dlg.current.showModal();
          }
        }}
      >
        {pending ? pendingText ?? "Aguarde…" : children}
      </button>
      {confirm && mounted && createPortal(
        <dialog ref={dlg} className="modal modal-sm" onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
          <div className="modal-body">
            <p className="text-[0.95rem]">{confirm}</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancelar</button>
              <button
                type="button"
                className={danger ? "btn btn-danger-solid" : "btn btn-primary"}
                onClick={() => {
                  const d = dlg.current!;
                  d.close();
                  d.dataset.ok = "1";
                  btn.current?.form?.requestSubmit(btn.current);
                  delete d.dataset.ok;
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
