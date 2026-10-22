"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Resumo", icon: "M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z" },
  { href: "/vendas", label: "Vendas", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/campanhas", label: "Campanhas", icon: "M4 15V9l12-5v16L4 15zm12-4h4" },
  { href: "/regras", label: "Regras", icon: "M13 3L4 14h7l-1 7 9-11h-7l1-7z" },
  { href: "/utms", label: "UTMs", icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
  { href: "/paginas", label: "Páginas", icon: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3" },
  { href: "/taxas", label: "Taxas", icon: "M6 18L18 6M8 8.5a1.5 1.5 0 1 0 0-.01M16 16.5a1.5 1.5 0 1 0 0-.01" },
  { href: "/perfis", label: "Perfis Meta", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" },
  { href: "/integracoes", label: "Integrações", icon: "M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7zM12 17v4" },
  { href: "/configuracoes", label: "Ajustes", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-line bg-[#0c181d] px-3 py-5">
        <div className="flex items-center gap-2.5 px-2 mb-7">
          <img src="/icons/icon-192.png" alt="" width={30} height={30} />
          <span className="font-[family-name:var(--font-display)] font-semibold text-lg">Painel</span>
        </div>
        <nav className="flex flex-col gap-1">
          {ITEMS.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active(i.href) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[0.92rem] ${
                active(i.href) ? "bg-surface-2 text-ink font-semibold" : "text-muted hover:text-ink"
              }`}
            >
              <Icon d={i.icon} />
              {i.label}
            </Link>
          ))}
        </nav>
        <form action="/api/logout" method="post" className="mt-auto px-2">
          <button className="text-muted hover:text-ink text-sm">Sair</button>
        </form>
      </aside>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 border-t border-line bg-[#0c181d]/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {ITEMS.filter((i) => ["/", "/vendas", "/campanhas", "/paginas", "/configuracoes"].includes(i.href)).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active(i.href) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[0.7rem] ${active(i.href) ? "text-profit" : "text-muted"}`}
          >
            <Icon d={i.icon} />
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
