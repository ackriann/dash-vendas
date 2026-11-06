"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [
  ["/automacao", "Visão geral"],
  ["/automacao/criar", "Criar campanha"],
  ["/automacao/campanhas", "Campanhas publicadas"],
  ["/automacao/catalogos", "Catálogos"],
  ["/automacao/midias", "Mídias"],
  ["/automacao/fanpages", "FanPages"],
  ["/automacao/processos", "Processos"],
];

export default function AutoTabs() {
  const path = usePathname();
  const active = (href: string) => (href === "/automacao" ? path === href : path.startsWith(href));
  return (
    <nav className="seg" aria-label="Automação de Campanhas">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={active(href) ? "true" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
