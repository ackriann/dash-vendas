import Link from "next/link";
import type { Dashboard } from "@/lib/dashboards";

/** Seletor de dash (Todos + dashes da conta). Fica no topo de Resumo, Vendas e Campanhas. */
export default function DashBar({ dashes, active, path }: { dashes: Dashboard[]; active: Dashboard | null; path: string }) {
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-sm whitespace-nowrap ${on ? "border-profit bg-surface-2 text-ink font-semibold" : "border-line text-muted hover:text-ink"}`;
  const go = (id?: string) => `/api/dash?${new URLSearchParams({ ...(id ? { id } : {}), next: path })}`;
  if (!dashes.length) {
    return (
      <p className="text-xs text-muted">
        Vende mais de um produto? <Link className="underline" href="/dashes">Crie um dash para cada um</Link>.
      </p>
    );
  }
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 -mb-1" aria-label="Dash">
      <a className={chip(!active)} href={go()} aria-current={!active ? "page" : undefined}>Todos</a>
      {dashes.map((d) => (
        <a key={d.id} className={chip(active?.id === d.id)} href={go(d.id)} aria-current={active?.id === d.id ? "page" : undefined}>{d.name}</a>
      ))}
      <Link className={chip(false)} href="/dashes" title="Criar ou editar dashes">+ Dash</Link>
    </nav>
  );
}
