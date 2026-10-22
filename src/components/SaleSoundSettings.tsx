"use client";
import { useEffect, useState } from "react";
import { SALE_SOUND_KEY, SALE_SOUND_URL, playSaleSound, soundEnabled } from "./SaleSound";

export default function SaleSoundSettings() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(soundEnabled()), []);

  function toggle(v: boolean) {
    setOn(v);
    try {
      localStorage.setItem(SALE_SOUND_KEY, v ? "on" : "off");
    } catch {
      /* sem armazenamento: fica ligado */
    }
  }

  return (
    <div className="border-t border-line pt-4 space-y-3">
      <h3>Som de venda</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Tocar som de caixa registradora com o painel aberto neste aparelho
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={playSaleSound}>Ouvir o som</button>
        <a className="btn btn-sm" href={SALE_SOUND_URL} download="caixa-registradora.wav">Baixar o som</a>
      </div>
      <p className="text-xs text-muted">
        Com o painel fechado, a notificação usa o som do aparelho. No Android dá para trocar: baixe o som, depois segure uma notificação do painel →
        Configurações → Som → escolha “caixa-registradora”. No iPhone a Apple não permite som personalizado para apps da web.
      </p>
      <p className="text-xs text-muted">
        Som: “Cha Ching Register”, por Muska666 / Laxerboyd, via Wikimedia Commons (CC BY-SA 4.0).
      </p>
    </div>
  );
}
