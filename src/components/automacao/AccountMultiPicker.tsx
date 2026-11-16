"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccountLite } from "@/lib/automacao/types";
import { readableLabel, searchLabel } from "@/lib/readable-label";

export function isReadyAccount(a: AccountLite): boolean {
  return a.enabled && (!a.account_status || a.account_status === 1);
}

export function defaultCampaignAccounts(accounts: AccountLite[]): string[] {
  const ready = accounts.filter(isReadyAccount);
  return (ready.length ? ready : accounts.slice(0, 1)).map((a) => a.id);
}

/** Seletor múltiplo com busca por nome, ID e perfil.
 * Utiliza checkboxes nativos e botões para preservar a navegação pelo teclado.
 */
export default function AccountMultiPicker({
  accounts, selectedIds, primaryId, onChange, onPrimaryChange, label = "Contas de anúncio",
}: {
  accounts: AccountLite[];
  selectedIds: string[];
  primaryId: string;
  onChange: (ids: string[]) => void;
  onPrimaryChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "other">("all");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedAccounts = accounts.filter((a) => selectedSet.has(a.id));
  const readyCount = accounts.filter(isReadyAccount).length;
  const outsideCount = selectedAccounts.filter((a) => !isReadyAccount(a)).length;

  const shown = useMemo(() => {
    const terms = searchLabel(query).trim().split(/\s+/).filter(Boolean);
    return accounts.filter((a) => {
      if (filter === "ready" && !isReadyAccount(a)) return false;
      if (filter === "other" && isReadyAccount(a)) return false;
      const haystack = searchLabel(`${a.name} ${a.id} ${a.id.replace(/^act_/, "")} ${a.profile_name}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [accounts, filter, query]);

  useEffect(() => {
    if (!expanded) return;
    search.current?.focus();
    const onOutside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [expanded]);

  function setSelection(ids: string[]) {
    const valid = accounts.filter((a) => ids.includes(a.id)).map((a) => a.id);
    // O formulário pai mantém a conta principal coerente quando a seleção muda.
    // Não invocar onPrimaryChange aqui: essa ação é exclusiva do botão
    // "Tornar principal" e poderia reintroduzir uma conta que foi desmarcada.
    onChange(valid);
  }

  function toggle(id: string) {
    setSelection(selectedSet.has(id) ? selectedIds.filter((current) => current !== id) : [...selectedIds, id]);
  }

  const total = selectedAccounts.length;
  const primary = accounts.find((a) => a.id === primaryId);
  return (
    <div ref={wrap} className="relative min-w-0 space-y-2" onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) { event.stopPropagation(); setExpanded(false); }
    }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label id={id + "-label"} className="label !mb-0">{label}</label>
        <span className="text-xs text-muted" aria-live="polite">{total} de {accounts.length} selecionada(s)</span>
      </div>

      <button type="button" aria-haspopup="dialog" aria-expanded={expanded}
        aria-controls={id + "-options"} aria-labelledby={id + "-label"}
        className="w-full text-left rounded-xl border border-line bg-[#0b202a] hover:border-[#5c97ad] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7cc8e6] px-4 py-3 flex items-center justify-between gap-3"
        onClick={() => setExpanded((v) => !v)}>
        <span className="min-w-0">
          <span className="block font-semibold text-sm">
            {total ? `${total} conta(s) selecionada(s)` : "Selecione pelo menos uma conta"}
          </span>
          <span className="block truncate text-xs text-muted mt-0.5">
            {primary ? `Principal: ${readableLabel(primary.name)} · ${primary.id.replace(/^act_/, "")}` : "Pesquisar por nome, ID ou perfil Meta"}
          </span>
        </span>
        <span className="text-muted text-sm" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
      </button>

      {selectedAccounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Contas escolhidas">
          {selectedAccounts.slice(0, 3).map((a) => (
            <span key={a.id} className="chip max-w-[220px]">
              <span className="truncate">{readableLabel(a.name)}</span>
              {primaryId === a.id && <span className="text-[10px] text-info">principal</span>}
              <button type="button" onClick={() => toggle(a.id)} aria-label={`Remover ${readableLabel(a.name)}`}>×</button>
            </span>
          ))}
          {selectedAccounts.length > 3 && <span className="pill">+{selectedAccounts.length - 3} contas</span>}
        </div>
      )}

      {expanded && (
        <div id={id + "-options"} role="dialog" aria-label="Selecionar contas de anúncios"
          className="relative z-20 w-full rounded-xl border border-[#456675] bg-[#0c1c25] shadow-xl p-3 space-y-3">
          <label className="field">
            <span className="sr-only">Pesquisar conta por nome, ID ou perfil</span>
            <input ref={search} type="search" className="input w-full"
              placeholder="Buscar pelo nome, ID ou perfil…" value={query} onChange={(e) => setQuery(e.target.value)}
              autoComplete="off" aria-describedby={id + "-help"} />
          </label>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-1" aria-label="Filtrar contas">
              {([
                ["all", "Todas"],
                ["ready", `Ativas (${readyCount})`],
                ["other", "Fora do painel / inativas"],
              ] as const).map(([key, title]) => (
                <button key={key} type="button" className={`btn btn-sm ${filter === key ? "btn-primary" : ""}`}
                  aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}</button>
              ))}
            </div>
            <span className="text-xs text-muted">{shown.length} resultado(s)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <button type="button" className="btn btn-sm" onClick={() => setSelection(accounts.map((a) => a.id))}>
              Selecionar todas ({accounts.length})
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSelection(accounts.filter(isReadyAccount).map((a) => a.id))}>
              Só ativas
            </button>
            {query.trim() && <button type="button" className="btn btn-sm" onClick={() => setSelection([...selectedIds, ...shown.map((a) => a.id)])}>
              Selecionar resultados
            </button>}
            <button type="button" className="btn btn-sm" onClick={() => setSelection([])}>Limpar</button>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-[#1f3a44] rounded-lg border border-line" aria-label="Contas encontradas">
            {shown.map((a) => (
              <li key={a.id} className={selectedSet.has(a.id) ? "bg-[#13303b]" : ""}>
                <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#1b3944]">
                  <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                    <input type="checkbox" checked={selectedSet.has(a.id)} onChange={() => toggle(a.id)}
                      aria-label={`Selecionar ${readableLabel(a.name)}, ID ${a.id.replace(/^act_/, "")}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate" title={readableLabel(a.name)}>
                        {readableLabel(a.name)}
                        {!isReadyAccount(a) && <span className="ml-2 text-xs text-spend">fora do painel / inativa</span>}
                      </span>
                      <span className="block text-xs text-muted break-all">
                        ID {a.id.replace(/^act_/, "")} · {a.currency} · {readableLabel(a.profile_name)}
                      </span>
                    </span>
                  </label>
                  {selectedSet.has(a.id) && (
                    <button type="button" className={`btn btn-sm ${primaryId === a.id ? "btn-primary" : ""}`}
                      aria-label={`Definir ${readableLabel(a.name)} como conta principal`}
                      aria-pressed={primaryId === a.id} onClick={() => onPrimaryChange(a.id)}>
                      {primaryId === a.id ? "Principal" : "Tornar principal"}
                    </button>
                  )}
                </div>
              </li>
            ))}
            {!shown.length && (
              <li className="p-4 text-sm text-muted">Nenhuma conta encontrada. Tente um ID, nome ou parte do perfil.</li>
            )}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <p id={id + "-help"} className="text-xs text-muted">
              A conta principal define as configurações-base. Cada conta selecionada recebe sua própria campanha.
            </p>
            <button type="button" className="btn btn-sm btn-primary shrink-0" onClick={() => setExpanded(false)}>Concluir</button>
          </div>
        </div>
      )}
      {outsideCount > 0 && (
        <p role="status" className="notice notice-warn text-xs">
          {outsideCount} conta(s) fora do painel ou inativa(s) selecionada(s). A Meta pode impedir a publicação nessas contas.
        </p>
      )}
      {total > 1 && <p className="text-xs text-spend">
        Publicação múltipla: serão geradas {total} campanhas separadas, uma por conta. Confira os orçamentos e permissões antes de publicar.
      </p>}
    </div>
  );
}
