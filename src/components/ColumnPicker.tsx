"use client";
import { useEffect, useState } from "react";

/**
 * Escolha de colunas da tabela. As células têm data-c="chave"; as colunas
 * desmarcadas somem via CSS. A escolha fica salva neste navegador.
 */
export default function ColumnPicker({
  storageKey,
  columns,
}: {
  storageKey: string;
  columns: { key: string; label: string; def?: boolean }[];
}) {
  const defaults = columns.filter((c) => c.def).map((c) => c.key);
  const [shown, setShown] = useState<string[]>(defaults);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved)) setShown(saved);
    } catch {
      /* sem armazenamento: fica o padrão */
    }
  }, [storageKey]);

  const save = (next: string[]) => {
    setShown(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignora */
    }
  };
  const toggle = (k: string) => save(shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k]);
  const hidden = columns.filter((c) => !shown.includes(c.key));

  return (
    <>
      <style>{hidden.map((c) => `[data-c="${c.key}"]{display:none}`).join("")}</style>
      <details className="relative">
        <summary className="btn btn-sm">Colunas ({shown.length})</summary>
        <div className="panel absolute right-0 z-30 mt-2 p-3 w-64 max-h-[60vh] overflow-y-auto space-y-1">
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
              <input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
            </label>
          ))}
          <div className="flex gap-2 pt-2 border-t border-line mt-2">
            <button type="button" className="btn btn-sm" onClick={() => save(columns.map((c) => c.key))}>Todas</button>
            <button type="button" className="btn btn-sm" onClick={() => save(defaults)}>Padrão</button>
          </div>
        </div>
      </details>
    </>
  );
}
