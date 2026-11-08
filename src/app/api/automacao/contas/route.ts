import { checkAccount, mainAccountRef } from "@/lib/automacao/engine";
import { normalizeDraft } from "@/lib/automacao/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conferência das contas extras do rascunho: BM, pixel, catálogo, públicos e moeda de cada uma. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const d = normalizeDraft(body?.draft);
  if (!/^act_\d+$/.test(d.accountId)) return Response.json({ error: "Escolha a conta principal." }, { status: 400 });
  const extras = d.extraAccountIds.filter((a) => /^act_\d+$/.test(a)).slice(0, 100);
  try {
    const main = await mainAccountRef(d.accountId);
    const checks = await Promise.all(
      extras.map((id) =>
        checkAccount({ ...d, accountId: id }, id, main).catch((e: any) => ({
          accountId: id, name: id, currency: null, business: null,
          pixel: { status: "error" as const, id: "", note: "" }, catalog: { status: "none" as const, note: "" }, audiences: { status: "none" as const, note: "" },
          errors: [e?.message ?? "Falha ao consultar a conta na Meta."],
        })),
      ),
    );
    return Response.json({ data: { main: { businessId: main.businessId, businessName: main.businessName }, checks } });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Erro na API da Meta" }, { status: 502 });
  }
}
