import { authForAccount } from "@/lib/profiles";
import {
  catalogBusinessesForAccount, listAccountCatalogs, listAccountPixels, listCustomAudiences, listInstagramAccounts, listProductSets, searchInterests, searchRegions,
} from "@/lib/automacao/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Consultas do assistente de criação, sempre pela conexão Meta que já existe na conta de anúncio. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const op = sp.get("op") ?? "";
  const account = sp.get("account") ?? "";
  if (!/^act_\d+$/.test(account)) return Response.json({ error: "Conta de anúncio inválida." }, { status: 400 });
  try {
    const auth = await authForAccount(account);
    const q = (sp.get("q") ?? "").trim();
    switch (op) {
      case "pixels":
        return Response.json({ data: await listAccountPixels(auth, account) });
      case "catalogs":
        return Response.json({ data: await listAccountCatalogs(auth, account) });
      case "catalog_businesses":
        return Response.json({ data: await catalogBusinessesForAccount(auth, account) });
      case "productsets": {
        const catalog = sp.get("catalog") ?? "";
        if (!/^\d+$/.test(catalog)) return Response.json({ data: [] });
        return Response.json({ data: await listProductSets(auth, catalog) });
      }
      case "instagram":
        return Response.json({ data: await listInstagramAccounts(auth, account) });
      case "audiences":
        return Response.json({ data: await listCustomAudiences(auth, account) });
      case "regions":
        return Response.json({ data: q.length < 2 ? [] : await searchRegions(auth, q, sp.get("country") ?? undefined) });
      case "interests":
        return Response.json({ data: q.length < 2 ? [] : await searchInterests(auth, q) });
      default:
        return Response.json({ error: "Consulta desconhecida." }, { status: 400 });
    }
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Erro na API da Meta" }, { status: 502 });
  }
}
