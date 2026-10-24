import Link from "next/link";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDateTime, resolveRange, ymdInTz } from "@/lib/dates";
import { fmtMoney } from "@/lib/money";
import { saleFees } from "@/lib/fees";
import { getPixels, type SaleRow } from "@/lib/capi";
import { loadFees } from "@/lib/report";
import { PLATFORM_LABEL, STATUS_LABEL, platformLabel } from "@/lib/sales";
import { nameFromUtm } from "@/lib/utm";
import RangeFilter from "@/components/RangeFilter";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import DashBar from "@/components/DashBar";
import { getActiveDashboard, listDashboards } from "@/lib/dashboards";
import { createManualSale, deleteSale, dispatchToPixel, setSaleStatus } from "./actions";

type SP = Promise<{
  range?: string; since?: string; until?: string; status?: string; platform?: string; q?: string;
  page?: string; id?: string; ok?: string; erro?: string; nova?: string;
}>;

const PAGE = 50;

export default async function Vendas({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tz = env.timezone;
  const range = resolveRange({ range: sp.range ?? "7d", since: sp.since, until: sp.until }, tz);
  const page = Math.max(1, Number(sp.page) || 1);
  const [dash, dashes] = await Promise.all([getActiveDashboard(), listDashboards()]);

  let query = db()
    .from("sales")
    .select("*", { count: "exact" })
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (dash?.products.length) query = query.in("product_name", dash.products);
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.platform) query = query.eq("platform", sp.platform);
  if (sp.q) {
    const q = sp.q.replace(/[%,()]/g, "").trim();
    if (q) query = query.or(`customer_email.ilike.%${q}%,customer_name.ilike.%${q}%,external_id.ilike.%${q}%,product_name.ilike.%${q}%`);
  }

  const [{ data, count, error }, pixels, fees, selected] = await Promise.all([
    query,
    getPixels(),
    loadFees(),
    sp.id ? db().from("sales").select("*").eq("id", sp.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const sales = (data ?? []) as SaleRow[];
  const sel = selected.data as SaleRow | null;
  const keep = { status: sp.status, platform: sp.platform, q: sp.q };
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { range: range.key, since: range.key === "custom" ? range.since : undefined, until: range.key === "custom" ? range.until : undefined, ...keep, page: String(page), ...over };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "page" && v === "1")) p.set(k, v);
    return `/vendas?${p}`;
  };
  const backUrl = link({ id: sp.id });
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const today = ymdInTz(new Date(), tz);
  const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

  return (
    <div className="space-y-5">
      <DashBar dashes={dashes} active={dash} path="/vendas" />
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1>Vendas{dash ? ` · ${dash.name}` : ""}</h1>
          <p className="sub">{range.label} · {count ?? 0} registro(s)</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <RangeFilter range={range} path="/vendas" keep={keep} />
          <a className="btn btn-sm" href={`/api/export/vendas?${new URLSearchParams(Object.entries({ range: range.key, since: range.since, until: range.until, status: sp.status, platform: sp.platform }).filter(([, v]) => v) as [string, string][])}`}>
            Exportar CSV
          </a>
        </div>
      </header>

      <Notice ok={sp.ok} erro={sp.erro ?? error?.message} />

      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <form method="get" action="/vendas" className="flex flex-wrap gap-2 flex-1">
          <input type="hidden" name="range" value={range.key} />
          {range.key === "custom" && (<><input type="hidden" name="since" value={range.since} /><input type="hidden" name="until" value={range.until} /></>)}
          <input className="input !w-56" name="q" placeholder="Buscar e-mail, nome, ID…" defaultValue={sp.q} />
          <select className="select !w-40" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select !w-40" name="platform" defaultValue={sp.platform ?? ""}>
            <option value="">Todas as plataformas</option>
            {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn">Filtrar</button>
        </form>
        <details className="relative" open={sp.nova === "1"}>
          <summary className="btn btn-primary">Nova venda manual</summary>
          <form action={createManualSale} className="panel panel-pad absolute right-0 z-30 mt-2 w-[min(92vw,560px)] grid grid-cols-2 gap-3">
            <p className="col-span-2 sub">Registre uma venda que o webhook não trouxe e, se quiser, dispare no pixel para a Meta otimizar.</p>
            <label className="field"><span className="label">Valor</span><input className="input num" name="amount" inputMode="decimal" placeholder="197,00" required /></label>
            <label className="field"><span className="label">Moeda</span>
              <select className="select" name="currency" defaultValue="BRL">{["BRL", "USD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="field col-span-2"><span className="label">Produto</span><input className="input" name="product" /></label>
            <label className="field"><span className="label">Data</span><input className="input" type="date" name="date" defaultValue={today} /></label>
            <label className="field"><span className="label">Hora</span><input className="input" type="time" name="time" defaultValue={nowTime} /></label>
            <label className="field col-span-2"><span className="label">Nome do comprador</span><input className="input" name="name" /></label>
            <label className="field"><span className="label">E-mail</span><input className="input" type="email" name="email" /></label>
            <label className="field"><span className="label">Telefone</span><input className="input" name="phone" placeholder="11 99999-9999" /></label>
            <label className="field"><span className="label">País (2 letras)</span><input className="input" name="country" placeholder="BR" maxLength={2} /></label>
            <label className="field"><span className="label">ID do pedido (opcional)</span><input className="input" name="external_id" /></label>
            <details className="col-span-2">
              <summary className="sub underline">Atribuir a uma campanha</summary>
              <div className="grid gap-3 mt-3">
                <label className="field"><span className="label">utm_campaign (Nome|ID) ou só o ID da campanha</span><input className="input" name="utm_campaign" placeholder="Campanha X|120210000000000" /></label>
                <label className="field"><span className="label">utm_medium (conjunto Nome|ID)</span><input className="input" name="utm_medium" /></label>
                <label className="field"><span className="label">utm_content (anúncio Nome|ID)</span><input className="input" name="utm_content" /></label>
              </div>
            </details>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="send_pixel" defaultChecked={pixels.length > 0} disabled={!pixels.length} /> Disparar Purchase no pixel
            </label>
            {pixels.length > 1 && (
              <label className="field col-span-2"><span className="label">Pixel</span>
                <select className="select" name="pixel" defaultValue={pixels.find((p) => p.is_default)?.id}>{pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
            {!pixels.length && <p className="col-span-2 text-xs text-muted">Cadastre um pixel em Integrações para poder disparar.</p>}
            <div className="col-span-2"><SubmitButton className="btn btn-primary w-full" pendingText="Registrando…">Registrar venda</SubmitButton></div>
          </form>
        </details>
      </div>

      {sel && (
        <SaleDetail sale={sel} pixels={pixels} fees={saleFees(sel, fees)} backUrl={backUrl} closeUrl={link({ id: undefined })} tz={tz} />
      )}

      <section className="panel overflow-x-auto">
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>Data</th><th>Status</th><th>Produto</th><th>Comprador</th><th>Origem</th><th className="r">Valor</th><th className="r">Pixel</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className={sel?.id === s.id ? "bg-surface-2" : ""}>
                <td className="whitespace-nowrap"><Link href={link({ id: s.id })} className="hover:underline">{fmtDateTime(s.created_at, tz)}</Link></td>
                <td><span className={`pill pill-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                <td className="max-w-[220px] truncate">{s.product_name ?? "—"}<div className="text-xs text-muted">{platformLabel(s.platform)}</div></td>
                <td className="max-w-[200px] truncate">{s.customer_name ?? "—"}<div className="text-xs text-muted truncate">{s.customer_email}</div></td>
                <td className="max-w-[200px] truncate text-sm">{nameFromUtm(s.utm_campaign) ?? <span className="text-muted">sem rastreio</span>}</td>
                <td className="r num whitespace-nowrap">{fmtMoney(Number(s.gross_amount), s.currency)}</td>
                <td className="r">
                  {s.capi_sent_at ? <span className="pill pill-approved" title={fmtDateTime(s.capi_sent_at, tz)}>Enviado</span>
                    : s.capi_last_error ? <span className="pill pill-refunded" title={s.capi_last_error}>Erro</span>
                    : s.status === "approved" ? (
                      <form action={dispatchToPixel}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="back" value={link({})} />
                        <SubmitButton className="btn btn-sm" pendingText="…">Disparar</SubmitButton>
                      </form>
                    ) : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
            {!sales.length && (
              <tr><td colSpan={7} className="text-center text-muted py-10">Nenhuma venda neste filtro. Configure os webhooks em <Link className="underline" href="/integracoes">Integrações</Link>.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-2">
          {page > 1 && <Link className="btn btn-sm" href={link({ page: String(page - 1) })}>Anterior</Link>}
          <span className="sub">Página {page} de {pages}</span>
          {page < pages && <Link className="btn btn-sm" href={link({ page: String(page + 1) })}>Próxima</Link>}
        </nav>
      )}
    </div>
  );
}

function SaleDetail({ sale, pixels, fees, backUrl, closeUrl, tz }: { sale: SaleRow; pixels: Awaited<ReturnType<typeof getPixels>>; fees: number; backUrl: string; closeUrl: string; tz: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Plataforma", platformLabel(sale.platform)],
    ["ID na plataforma", <code key="e">{sale.external_id}</code>],
    ["Data", fmtDateTime(sale.created_at, tz)],
    ["Aprovada em", fmtDateTime(sale.approved_at, tz)],
    ["Comprador", [sale.customer_name, sale.customer_email, sale.customer_phone].filter(Boolean).join(" · ") || "—"],
    ["Pagamento", [sale.payment_method, sale.installments ? `${sale.installments}x` : null].filter(Boolean).join(" · ") || "—"],
    ["Valor bruto", fmtMoney(Number(sale.gross_amount), sale.currency)],
    ["Taxas (pelas suas regras)", fmtMoney(fees, "BRL")],
    ["Líquido estimado", fmtMoney(Number(sale.gross_base) - fees, "BRL")],
    ...(sale.net_reported ? [["Líquido informado pela plataforma", fmtMoney(Number(sale.net_reported), sale.currency)] as [string, React.ReactNode]] : []),
    ["Campanha", nameFromUtm(sale.utm_campaign) ?? "—"],
    ["Conjunto", nameFromUtm(sale.utm_medium) ?? "—"],
    ["Anúncio", nameFromUtm(sale.utm_content) ?? "—"],
    ["Posicionamento", sale.utm_term ?? "—"],
    ["Clique rastreado", sale.click_id ? "Sim (fbc/fbp disponíveis para o pixel)" : "Não"],
    ["Pixel", sale.capi_sent_at ? `Enviado em ${fmtDateTime(sale.capi_sent_at, tz)}` : sale.capi_last_error ? `Erro: ${sale.capi_last_error}` : "Não enviado"],
  ];
  return (
    <section className="panel panel-pad space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2>{sale.product_name ?? "Venda"}</h2>
          <span className={`pill pill-${sale.status}`}>{STATUS_LABEL[sale.status] ?? sale.status}</span>
        </div>
        <Link href={closeUrl} className="btn btn-sm">Fechar</Link>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-[#1f3a44] py-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 items-end">
        {sale.status === "approved" && (
          <form action={dispatchToPixel} className="flex gap-2 items-end">
            <input type="hidden" name="id" value={sale.id} />
            <input type="hidden" name="back" value={backUrl} />
            {pixels.length > 1 && (
              <select className="select !w-44" name="pixel" defaultValue={pixels.find((p) => p.is_default)?.id}>
                {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <SubmitButton className="btn btn-primary" pendingText="Disparando…"
              confirm={sale.capi_sent_at ? "Esta venda já foi enviada. A Meta deduplica pelo mesmo ID, então reenviar só serve se o primeiro envio falhou. Continuar?" : undefined}>
              {sale.capi_sent_at ? "Disparar de novo no pixel" : "Disparar venda no pixel"}
            </SubmitButton>
          </form>
        )}
        <form action={setSaleStatus} className="flex gap-2">
          <input type="hidden" name="id" value={sale.id} />
          <select className="select !w-40" name="status" defaultValue={sale.status}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <SubmitButton pendingText="…">Mudar status</SubmitButton>
        </form>
        <form action={deleteSale}>
          <input type="hidden" name="id" value={sale.id} />
          <SubmitButton className="btn btn-danger" confirm="Excluir esta venda do painel? Isso não afeta a plataforma.">Excluir</SubmitButton>
        </form>
      </div>
    </section>
  );
}
