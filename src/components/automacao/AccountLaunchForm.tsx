"use client";

import { useState } from "react";
import type { AccountLite } from "@/lib/automacao/types";
import AccountMultiPicker, { defaultCampaignAccounts } from "@/components/automacao/AccountMultiPicker";
import { newDraftAction } from "@/app/(painel)/automacao/actions";

export default function AccountLaunchForm({
  accounts, embedded = false, embeddedSurface,
}: { accounts: AccountLite[]; embedded?: boolean; embeddedSurface?: "resumo" | "campanhas" }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => defaultCampaignAccounts(accounts));
  const [primaryId, setPrimaryId] = useState(() => defaultCampaignAccounts(accounts)[0] ?? "");

  function update(ids: string[]) {
    setSelectedIds(ids);
    if (!ids.includes(primaryId)) setPrimaryId(ids[0] ?? "");
  }
  return (
    <form action={newDraftAction} className="panel panel-pad grid gap-4 max-w-4xl">
      {embedded && <input type="hidden" name="surface" value={embeddedSurface ?? "campanhas"} />}
      <div>
        <h2 className="text-base font-semibold">Escolha as contas da campanha</h2>
        <p className="text-sm text-muted mt-1">
          As contas ativas do painel já vêm selecionadas. Pesquise por nome ou ID e use
          “Selecionar todas” para incluir também as demais contas conectadas.
        </p>
      </div>
      <AccountMultiPicker accounts={accounts} selectedIds={selectedIds}
        primaryId={primaryId} onChange={update} onPrimaryChange={setPrimaryId} />
      <input type="hidden" name="account" value={primaryId} />
      {selectedIds.map((id) => <input key={id} type="hidden" name="accounts" value={id} />)}
      <div className="flex flex-wrap justify-between items-center gap-3 border-t border-line pt-3">
        <p className="text-xs text-muted">Você poderá revisar e modificar a seleção antes de publicar na Meta.</p>
        <button className="btn btn-primary" type="submit" disabled={!selectedIds.length || !primaryId}>
          Começar configuração →
        </button>
      </div>
    </form>
  );
}
