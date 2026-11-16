"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Modal de tela ampla: reaproveita os formulários e as validações existentes,
 * sem criar um segundo fluxo de publicação.
 */
export default function CampaignModal({
  title, closeHref, children,
}: { title: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const closeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(closeHref);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onEscape);
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-[3px] flex items-center justify-center p-2 sm:p-5"
      onMouseDown={(event) => { if (event.currentTarget === event.target) router.push(closeHref); }}>
      <section role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-[1420px] max-h-[96dvh] flex flex-col overflow-hidden rounded-2xl border border-line bg-[#0d2029] shadow-2xl">
        <header className="px-4 sm:px-6 py-3 border-b border-line flex items-center gap-3 justify-between bg-[#102a35]">
          <div className="min-w-0">
            <p className="text-xs text-muted">Campanhas · Dash Vendas</p>
            <h2 className="font-semibold text-base sm:text-lg">{title}</h2>
          </div>
          <Link ref={closeRef} href={closeHref} className="btn btn-sm"
            aria-label="Fechar janela e voltar às campanhas">Fechar ×</Link>
        </header>
        <div className="overflow-y-auto overscroll-contain flex-1 p-4 sm:p-6">
          {children}
        </div>
      </section>
    </div>
  );
}
