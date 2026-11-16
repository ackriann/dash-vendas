import { buildAdRows, type AdRow } from "@/lib/ads";
import type { Context } from "@/lib/report";
import type { DateRange } from "@/lib/dates";
import { fmtDateTime } from "@/lib/dates";
import SummaryCampaignClient from "./SummaryCampaignClient";

export default async function SummaryCampaignSlot({
  ctx, range, accountId, backHref, startDetailId,
}: {
  ctx: Context;
  range: DateRange;
  accountId?: string;
  backHref: string;
  startDetailId?: string;
}) {
  const accounts = accountId ? ctx.accounts.filter((account) => account.id === accountId) : ctx.accounts;
  if (!accounts.length) {
    return (
      <section className="panel panel-pad space-y-2">
        <h2>Campanhas</h2>
        <p className="sub">Selecione uma conta no filtro ou conecte uma conta em Perfis Meta para acompanhar suas campanhas.</p>
      </section>
    );
  }

  try {
    // Mesma origem e cálculo da aba Campanhas: Meta Marketing API + vendas rastreadas.
    const { rows, errors } = await buildAdRows(ctx, accounts, "campaign", range);
    const data = rows
      .filter((row) => row.level === "campaign")
      .sort((a, b) => b.spend - a.spend || Number(b.effective === "ACTIVE") - Number(a.effective === "ACTIVE"));

    return (
      <SummaryCampaignClient
        rows={data as AdRow[]}
        currency={ctx.base}
        timezone={ctx.tz}
        range={range}
        backHref={backHref}
        startDetailId={startDetailId}
        syncedAt={fmtDateTime(new Date().toISOString(), ctx.tz)}
        partialErrors={errors}
      />
    );
  } catch (error: any) {
    return (
      <section className="panel panel-pad space-y-2">
        <h2>Campanhas</h2>
        <p className="notice notice-warn">
          Não foi possível sincronizar as campanhas com a Meta: {error?.message ?? "falha de consulta"}.
          Nenhum número parcial será mostrado como total.
        </p>
        <a className="btn btn-sm" href={backHref}>Tentar novamente</a>
      </section>
    );
  }
}
