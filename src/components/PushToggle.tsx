"use client";
import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export default function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") return setState("denied");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setMsg(null);
    if (!vapidKey) return setMsg("Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY no servidor.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
    if (!r.ok) return setMsg("Não foi possível salvar a inscrição deste aparelho.");
    setState("on");
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function test() {
    setMsg(null);
    const r = await fetch("/api/push/test", { method: "POST" }).then((r) => r.json());
    setMsg(r.error ?? `Enviado para ${r.sent} aparelho(s).`);
  }

  return (
    <div className="space-y-3">
      {state === "loading" && <p className="sub">Verificando este aparelho…</p>}
      {state === "unsupported" && <p className="sub">Este navegador não suporta notificações push. No Android use o Chrome; no computador, Chrome, Edge ou Firefox.</p>}
      {state === "ios-install" && (
        <p className="notice notice-warn">
          No iPhone, as notificações só funcionam com o painel instalado: toque em Compartilhar → <b>Adicionar à Tela de Início</b>, abra pelo ícone e volte aqui.
        </p>
      )}
      {state === "denied" && <p className="notice notice-err">As notificações foram bloqueadas. Libere nas configurações do navegador para este site.</p>}
      <div className="flex flex-wrap gap-2">
        {state === "off" && <button className="btn btn-primary" onClick={enable}>Ativar neste aparelho</button>}
        {state === "on" && (
          <>
            <span className="pill pill-approved">Ativo neste aparelho</span>
            <button className="btn btn-sm" onClick={test}>Enviar teste</button>
            <button className="btn btn-sm btn-danger" onClick={disable}>Desativar</button>
          </>
        )}
      </div>
      {msg && <p className="sub">{msg}</p>}
    </div>
  );
}
