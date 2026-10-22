/**
 * Item de lista que abre ao clicar (acordeão). O título fica sempre visível,
 * com espaço à direita para status/ajuda; o conteúdo aparece ao abrir.
 */
export default function Acc({
  title,
  sub,
  right,
  open,
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="acc" open={open}>
      <summary>
        <span className="acc-chev" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="acc-title">{title}</span>
          {sub && <span className="acc-sub">{sub}</span>}
        </span>
        {right && <span className="flex items-center gap-2 shrink-0">{right}</span>}
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}
