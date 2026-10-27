"use client";
import { useRef, useState } from "react";

// Filtra os itens com data-search dentro de children. Só esconde (não remove),
// então checkboxes marcados e escondidos continuam indo no formulário.
export default function ListSearch({ placeholder = "Pesquisar…", children }: { placeholder?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  function filter(q: string) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    let n = 0;
    box.current?.querySelectorAll<HTMLElement>("[data-search]").forEach((el) => {
      const text = norm(el.dataset.search ?? "");
      const ok = terms.every((t) => text.includes(t));
      el.hidden = !ok;
      if (ok) n++;
    });
    setShown(terms.length ? n : null);
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        className="input"
        placeholder={placeholder}
        onChange={(e) => filter(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      />
      {shown !== null && <p className="text-xs text-muted">{shown ? `${shown} resultado(s)` : "Nenhuma conta encontrada."}</p>}
      <div ref={box}>{children}</div>
    </div>
  );
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
