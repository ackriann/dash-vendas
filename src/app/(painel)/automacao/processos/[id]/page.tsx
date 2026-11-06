import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunView } from "@/lib/automacao/engine";
import Notice from "@/components/Notice";
import RunProgress from "./RunProgress";

type SP = Promise<{ ok?: string; erro?: string; de?: string; catalogo?: string; perfil?: string }>;

export default async function Processo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const run = await getRunView(id);
  if (!run) notFound();

  const back =
    sp.de === "fanpages" || run.kind === "page_sync"
      ? { href: "/automacao/fanpages", label: "Ver resultado nas FanPages" }
      : run.kind === "catalog_update"
        ? { href: `/automacao/catalogos/${sp.catalogo ?? run.ref_id}${sp.perfil || run.summary?.profileId ? `?perfil=${sp.perfil ?? run.summary?.profileId}` : ""}`, label: "Voltar ao catálogo" }
        : null;

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link className="text-muted hover:text-ink" href="/automacao/processos">← Processos</Link></p>
      <Notice ok={sp.ok} erro={sp.erro} />
      <RunProgress initial={run} back={back} />
    </div>
  );
}
