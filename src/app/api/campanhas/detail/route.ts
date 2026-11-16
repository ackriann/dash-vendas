import { requireAuth } from "@/lib/session";
import { getContext } from "@/lib/report";
import { graph, graphAll } from "@/lib/meta";

/** Detalhes reais e atuais de uma campanha, carregados somente ao abrir o painel.
 * Confere o acesso à conta do dash atual e o vínculo da campanha com a conta.
 */
export async function GET(request: Request) {
  await requireAuth();
  const query = new URL(request.url).searchParams;
  const campaignId = query.get("campaign") || "";
  const accountId = query.get("account") || "";
  if (!/^\d+$/.test(campaignId) || !/^act_\d+$/.test(accountId)) {
    return Response.json({ error: "Campanha ou conta inválida." }, { status: 400 });
  }

  const ctx = await getContext({ useDash: true });
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) {
    return Response.json({ error: "Esta conta não está disponível no dash selecionado." }, { status: 403 });
  }

  try {
    const campaign = await graph<{
      id: string; name: string; account_id: string;
      objective?: string; status?: string; effective_status?: string;
    }>(campaignId, {
      params: { fields: "id,name,account_id,objective,status,effective_status" },
      auth: account.auth,
    });
    if (String(campaign.account_id).replace(/^act_/, "") !== accountId.replace(/^act_/, "")) {
      return Response.json({ error: "A campanha não pertence à conta informada." }, { status: 403 });
    }

    const [sets, ads] = await Promise.all([
      graphAll<{
        id: string; name: string; status: string; effective_status: string;
        daily_budget?: string | null;
      }>(`${campaignId}/adsets`, { fields: "id,name,status,effective_status,daily_budget" }, account.auth, 20),
      graphAll<{
        id: string; name: string; status: string; effective_status: string;
        adset_id?: string;
      }>(`${campaignId}/ads`, { fields: "id,name,status,effective_status,adset_id" }, account.auth, 20),
    ]);

    return Response.json({
      campaign: {
        id: campaign.id, name: campaign.name, objective: campaign.objective,
        status: campaign.status, effective: campaign.effective_status,
      },
      adsets: sets.slice(0, 40).map((set) => ({
        id: set.id, name: set.name, status: set.status, effective: set.effective_status,
        budget: set.daily_budget != null ? Number(set.daily_budget) / 100 : null,
      })),
      ads: ads.slice(0, 50).map((ad) => ({
        id: ad.id, name: ad.name, status: ad.status, effective: ad.effective_status, adsetId: ad.adset_id,
      })),
      adsetsTotal: sets.length, adsTotal: ads.length, fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return Response.json({
      error: error?.message || "Não foi possível consultar os detalhes na Meta.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
