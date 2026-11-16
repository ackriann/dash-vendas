/**
 * Correção de nomes recebidos já com UTF-8 interpretado como Latin-1.
 * Somente apresentação; nunca modifica IDs nem grava a correção no banco.
 */
export function readableLabel(raw: string | null | undefined): string {
  let value = raw || "";
  for (let round = 0; round < 2; round++) {
    if (!/[ÃÂ]/.test(value)) break;
    const chars = Array.from(value);
    if (chars.some((ch) => ch.codePointAt(0)! > 255)) break;
    try {
      const fixed = new TextDecoder("utf-8", { fatal: true })
        .decode(new Uint8Array(chars.map((ch) => ch.codePointAt(0)!)));
      if (fixed === value || fixed.includes("\uFFFD")) break;
      value = fixed;
    } catch {
      break;
    }
  }
  return value;
}

export function searchLabel(raw: string): string {
  return readableLabel(raw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
