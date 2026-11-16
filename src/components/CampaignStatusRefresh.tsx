"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function CampaignStatusRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-sm" disabled={pending}
      onClick={() => start(() => router.refresh())}>
      {pending ? "Atualizando…" : "Atualizar status"}
    </button>
  );
}
