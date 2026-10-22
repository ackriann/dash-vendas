export default function Notice({ ok, erro }: { ok?: string; erro?: string }) {
  if (!ok && !erro) return null;
  return <p className={`notice ${erro ? "notice-err" : "notice-ok"}`} role="status">{erro ?? ok}</p>;
}
