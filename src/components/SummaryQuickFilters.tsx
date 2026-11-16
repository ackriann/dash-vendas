"use client";

import Link from "next/link";
import { readableLabel } from "@/lib/readable-label";

type Option = { id: string; label: string };

export default function SummaryQuickFilters({
  range, since, until,
  account, platform, product,
  accounts, platforms, products,
}: {
  range: string; since: string; until: string;
  account?: string; platform?: string; product?: string;
  accounts: Option[]; platforms: Option[]; products: Option[];
}) {
  const any = Boolean(account || platform || product);
  return (
    <form method="get" action="/" className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="range" value={range} />
      {range === "custom" && <>
        <input type="hidden" name="since" value={since} />
        <input type="hidden" name="until" value={until} />
      </>}
      <label className="sr-only" htmlFor="summary-account-filter">Conta de anúncio</label>
      <select id="summary-account-filter" name="conta" defaultValue={account || ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-[43px] w-auto max-w-[225px] min-w-[165px] rounded-full border border-[#243039] bg-[#121a1e] px-4 text-sm text-[#e7f0f2]">
        <option value="">Todas as contas</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{readableLabel(a.label)}</option>)}
      </select>
      <label className="sr-only" htmlFor="summary-platform-filter">Plataforma de venda</label>
      <select id="summary-platform-filter" name="plataforma" defaultValue={platform || ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-[43px] w-auto max-w-[225px] min-w-[185px] rounded-full border border-[#243039] bg-[#121a1e] px-4 text-sm text-[#e7f0f2]">
        <option value="">Todas as plataformas</option>
        {platforms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="summary-product-filter">Produto</label>
      <select id="summary-product-filter" name="produto" defaultValue={product || ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-[43px] w-auto max-w-[225px] min-w-[185px] rounded-full border border-[#243039] bg-[#121a1e] px-4 text-sm text-[#e7f0f2]">
        <option value="">Todos os produtos</option>
        {products.map((p) => <option key={p.id} value={p.id}>{readableLabel(p.label)}</option>)}
      </select>
      {any && (
        <Link href={`/?range=${encodeURIComponent(range)}${range === "custom" ? `&since=${since}&until=${until}` : ""}`}
          className="text-sm text-[#97aab1] hover:text-white underline underline-offset-4">
          Limpar
        </Link>
      )}
    </form>
  );
}
