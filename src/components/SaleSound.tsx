"use client";
import { useEffect } from "react";

export const SALE_SOUND_URL = "/sounds/caixa-registradora.wav";
export const SALE_SOUND_KEY = "painel_som_venda";

let audio: HTMLAudioElement | null = null;
function getAudio() {
  if (!audio) {
    audio = new Audio(SALE_SOUND_URL);
    audio.preload = "auto";
  }
  return audio;
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SALE_SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function playSaleSound() {
  const a = getAudio();
  a.currentTime = 0;
  a.play().catch(() => {});
}

/** Toca o som de caixa quando chega uma venda com o painel aberto (o service worker avisa). */
export default function SaleSound() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "sale-sound" && soundEnabled()) playSaleSound();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    // Navegadores só deixam tocar som depois de um toque na página: destrava no primeiro toque
    const unlock = () => {
      const a = getAudio();
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}).finally(() => { a.muted = false; });
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);
  return null;
}
