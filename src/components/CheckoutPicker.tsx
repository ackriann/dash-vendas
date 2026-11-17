"use client";

import { useEffect, useState, type ReactNode } from "react";

type CheckoutChoice = { name: string; status: string; ready: boolean };

export default function CheckoutPicker({
  options, panels,
}: { options: CheckoutChoice[]; panels: ReactNode[] }) {
  const [selected, setSelected] = useState(() => options.findIndex((v) => v.ready) >= 0
    ? options.findIndex((v) => v.ready) : 0);
  useEffect(() => {
    try {
      const name = sessionStorage.getItem("dash-vendas:checkout-selecionado");
      const index = options.findIndex((item) => item.name === name);
      if (index >= 0) setSelected(index);
    } catch { /* armazenamento desativado */ }
  }, [options.map((o) => o.name).join("|")]);
  const picked = options[selected];

  return (
    <section id="checkout" className="rounded-2xl border border-line bg-surface p-4 sm:p-5 min-w-0 space-y-4">
      <div>
        <h2>Checkout</h2>
        <p className="text-sm text-muted mt-1">Escolha a plataforma para configurar seu webhook e receber vendas.</p>
      </div>
      <label className="field">
        <span className="label">Selecionar checkout</span>
        <select className="select" value={selected}
          onChange={(event) => {
            const index = Number(event.target.value);
            setSelected(index);
            try { sessionStorage.setItem("dash-vendas:checkout-selecionado", options[index]?.name ?? ""); }
            catch { /* armazenamento desativado */ }
          }}>
          {options.map((item, index) => (
            <option value={index} key={item.name}>{item.name}{item.ready ? " · conectado" : ""}</option>
          ))}
        </select>
      </label>
      {picked && (
        <div className="rounded-xl bg-[#10232b] border border-line p-3 sm:p-4 space-y-3">
          <div className="flex gap-2 justify-between items-center flex-wrap">
            <h3 className="font-semibold">{picked.name}</h3>
            <span className={`pill ${picked.ready ? "pill-approved" : "pill-pending"}`}>
              {picked.status}
            </span>
          </div>
          {panels[selected]}
        </div>
      )}
    </section>
  );
}
