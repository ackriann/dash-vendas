import Nav from "@/components/Nav";
import SaleSound from "@/components/SaleSound";

export const dynamic = "force-dynamic";

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Nav />
      <SaleSound />
      <main className="md:pl-56">
        <div className="mx-auto max-w-6xl px-4 md:px-8 pt-6 pb-28 md:pb-12">{children}</div>
      </main>
    </div>
  );
}
