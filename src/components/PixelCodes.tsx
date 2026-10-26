import { pixelCodeSnippet } from "@/lib/pixel-code";
import { pixelsOfDash, type Dashboard } from "@/lib/dashboards";
import type { Pixel } from "@/lib/capi";
import CopyButton from "./CopyButton";

/**
 * Código único do pixel (modelo Utmify): um por dash e um da conta inteira.
 * O código não leva IDs: o t.js pergunta ao painel quais pixels carregar,
 * então ligar/desligar pixels no dash não exige trocar o código no site.
 */
export default function PixelCodes({ accountCode, dashes, pixels }: { accountCode: string; dashes: Dashboard[]; pixels: Pixel[] }) {
  const names = (list: Pixel[]) => (list.length ? list.map((p) => p.name).join(", ") : "nenhum pixel cadastrado");
  const items = [
    ...dashes.map((d) => ({ key: d.id, title: `Dash ${d.name}`, code: d.pixel_code, list: pixelsOfDash(pixels, d) })),
    { key: "conta", title: dashes.length ? "Todos os pixels da conta" : "Código do pixel", code: accountCode, list: pixels },
  ];
  return (
    <div className="space-y-4">
      {items.map((i) => (
        <div key={i.key} className="space-y-2">
          <p className="text-sm">
            <b>{i.title}</b> <span className="text-muted">· carrega: {names(i.list)}</span>
          </p>
          <code className="codebox !text-[0.75rem]">{pixelCodeSnippet(i.code)}</code>
          <CopyButton text={pixelCodeSnippet(i.code)} label="Copiar código" />
        </div>
      ))}
    </div>
  );
}
