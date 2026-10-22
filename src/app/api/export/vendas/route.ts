import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDateTime, resolveRange } from "@/lib/dates";
import { STATUS_LABEL, platformLabel } from "@/lib/sales";
import { nameFromUtm } from "@/lib/utm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS: [string, (s: any) => unknown][] = [
  ["Data", (s) => fmtDateTime(s.created_at, env.timezone)],
  ["Status", (s) => STATUS_LABEL[s.status] ?? s.status],
  ["Plataforma", (s) => platformLabel(s.platform)],
  ["ID", (s) => s.external_id],
  ["Produto", (s) => s.product_name],
  ["Cliente", (s) => s.customer_name],
  ["E-mail", (s) => s.customer_email],
  ["Telefone", (s) => s.customer_phone],
  ["Pagamento", (s) => s.payment_method],
  ["Moeda", (s) => s.currency],
  ["Valor", (s) => Number(s.gross_amount).toFixed(2).replace(".", ",")],
  ["Valor (moeda do painel)", (s) => Number(s.gross_base).toFixed(2).replace(".", ",")],
  ["utm_source", (s) => s.utm_source],
  ["Campanha", (s) => nameFromUtm(s.utm_campaign)],
  ["Conjunto", (s) => nameFromUtm(s.utm_medium)],
  ["Anúncio", (s) => nameFromUtm(s.utm_content)],
  ["utm_term", (s) => s.utm_term],
  ["ID campanha", (s) => s.campaign_id],
  ["ID conjunto", (s) => s.adset_id],
  ["ID anúncio", (s) => s.ad_id],
];

const cell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV (separado por ; para abrir direto no Excel em português). */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const range = resolveRange({ range: sp.range ?? "7d", since: sp.since, until: sp.until }, env.timezone);
  const lines = [COLS.map(([h]) => h).join(";")];
  for (let from = 0; from < 100000; from += 1000) {
    let q = db()
      .from("sales")
      .select("*")
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (sp.status) q = q.eq("status", sp.status);
    if (sp.platform) q = q.eq("platform", sp.platform);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 500 });
    for (const s of data ?? []) lines.push(COLS.map(([, f]) => cell(f(s))).join(";"));
    if (!data || data.length < 1000) break;
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vendas-${range.since}-a-${range.until}.csv"`,
    },
  });
}
