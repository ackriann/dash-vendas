import Link from "next/link";
import { db } from "@/lib/db";
import { listDashboards, type Dashboard } from "@/lib/dashboards";
import { listAccounts, type AccountRow } from "@/lib/profiles";
import Notice from "@/components/Notice";
import SubmitButton from "@/components/SubmitButton";
import Acc from "@/components/Acc";
import CopyButton from "@/components/CopyButton";
import { getPixels, type Pixel } from "@/lib/capi";
import { pixelCodeSnippet } from "@/lib/pixel-code";
import { pixelsOfDash } from "@/lib/dashboards";
import { createDashboard, deleteDashboard, updateDashboard } from "./actions";

export default async function Dashes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const [dashes, accounts, prod, pixels] = await Promise.all([
    listDashboards(),
    listAccounts(true).catch(() => [] as AccountRow[]),
    db().from("sales").select("product_name").not("product_name", "is", null).order("created_at", { ascending: false }).limit(5000),
    getPixels(),
  ]);
  // Produtos que já venderam + os já escolhidos nos dashes (mesmo sem venda recente)
  const products = [...new Set([...(prod.data ?? []).map((r: any) => r.product_name as string), ...dashes.flatMap((d) => d.products)])].sort();

  return (
    <div className="space-y-5 max-w-4xl">
      <header>
        <h1>Dashes</h1>
        <p className="sub">
          Um dash por produto: cada um mostra só as vendas dos produtos escolhidos e o gasto das contas de anúncio escolhidas, com o lucro de cada produto separado.
          Cada dash tem um código de pixel único que carrega todos os pixels ligados a ele.
          Para separar tudo (Meta, checkouts e webhooks), crie outra conta em Ajustes.
        </p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <section className="space-y-2">
        {dashes.map((d) => (
          <Acc
            key={d.id}
            title={d.name}
            sub={`${d.products.length ? `${d.products.length} produto(s)` : "Todos os produtos"} · ${d.ad_account_ids.length ? `${d.ad_account_ids.length} conta(s) de anúncio` : "Todas as contas de anúncio"} · ${d.pixel_ids.length ? `${d.pixel_ids.length} pixel(s)` : "pixel padrão"}`}
          >
            {pixels.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-sm">
                  <b>Código do pixel deste dash</b>{" "}
                  <span className="text-muted">· carrega: {pixelsOfDash(pixels, d).map((p) => p.name).join(", ")}</span>
                </p>
                <code className="codebox !text-[0.75rem]">{pixelCodeSnippet(d.pixel_code)}</code>
                <CopyButton text={pixelCodeSnippet(d.pixel_code)} label="Copiar código" />
                <p className="text-xs text-muted">Cole no &lt;head&gt; das páginas deste produto. Trocar os pixels abaixo não muda o código.</p>
              </div>
            )}
            <DashForm dash={d} products={products} accounts={accounts} pixels={pixels} />
            <form action={deleteDashboard} className="mt-3">
              <input type="hidden" name="id" value={d.id} />
              <SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o dash "${d.name}"? As vendas continuam no painel.`}>Remover dash</SubmitButton>
            </form>
          </Acc>
        ))}
        <Acc title="+ Novo dash" sub="Ex.: um para cada produto" open={!dashes.length}>
          <DashForm products={products} accounts={accounts} pixels={pixels} />
        </Acc>
      </section>

      <p className="text-xs text-muted">
        O gasto da Meta é separado por conta de anúncio: se os dois produtos usam a mesma conta, o gasto dela entra nos dois dashes.
        Custos que valem só para um produto podem ser ligados ao dash em <Link className="underline" href="/taxas">Taxas</Link>.
      </p>
    </div>
  );
}

function DashForm({ dash, products, accounts, pixels }: { dash?: Dashboard; products: string[]; accounts: AccountRow[]; pixels: Pixel[] }) {
  return (
    <form action={dash ? updateDashboard : createDashboard} className="space-y-4">
      {dash && <input type="hidden" name="id" value={dash.id} />}
      <label className="field">
        <span className="label">Nome do dash</span>
        <input className="input" name="name" defaultValue={dash?.name ?? ""} placeholder="Ex.: Produto A" maxLength={40} required />
      </label>

      <fieldset className="space-y-2">
        <legend className="label mb-1">Produtos (nenhum marcado = todos)</legend>
        {products.length ? (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {products.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="product" value={p} defaultChecked={dash?.products.includes(p)} /> <span className="truncate">{p}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Nenhuma venda com nome de produto ainda. Digite o nome exatamente como chega do checkout:</p>
        )}
        <input className="input" name="product" placeholder="Outro produto (nome exato, opcional)" />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="label mb-1">Contas de anúncio (nenhuma marcada = todas)</legend>
        {accounts.length ? (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ad_account" value={a.id} defaultChecked={dash?.ad_account_ids.includes(a.id)} />
                <span className="truncate">{a.name} <span className="text-muted">· {a.id.replace("act_", "")}</span></span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Ative as contas de anúncio em <Link className="underline" href="/perfis">Perfis Meta</Link> para escolher aqui.</p>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="label mb-1">Pixels (nenhum marcado = só o pixel padrão)</legend>
        {pixels.length ? (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {pixels.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="pixel" value={p.id} defaultChecked={dash?.pixel_ids.includes(p.id)} />
                <span className="truncate">{p.name} <span className="text-muted">· {p.pixel_id}</span></span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Cadastre os pixels em <Link className="underline" href="/integracoes">Integrações → Pixel</Link> para escolher aqui.</p>
        )}
        <p className="text-xs text-muted">O código do dash carrega estes pixels no site, e a venda aprovada do produto vai para eles pelo servidor.</p>
      </fieldset>

      <SubmitButton className="btn btn-primary" pendingText="Salvando…">{dash ? "Salvar dash" : "Criar dash"}</SubmitButton>
    </form>
  );
}
