import { redirect } from "next/navigation";

export default async function LegacyRedirect({ searchParams }: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ area: "perfil" });
  if (sp.ok) q.set("ok", sp.ok);
  if (sp.erro) q.set("erro", sp.erro);
  redirect(`/integracoes?${q.toString()}#perfil`);
}
