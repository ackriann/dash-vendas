import Link from "next/link";
import { db, getSetting } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { getPixels } from "@/lib/capi";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { pixelSnippet } from "@/lib/utm";
import Notice from "@/components/Notice";
import CopyButton from "@/components/CopyButton";
import SubmitButton from "@/components/SubmitButton";
import {
  addPixel, clearCheckout, connectStripe, deletePixel, disconnectStripe, newUniversalKey, saveDigistore,
  saveHotmart, saveStripeManual, setAutoCapi, setDefaultPixel, updatePixelTestCode,
} from "./actions";

export default async function Integracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const app = env.appUrl;
  const [profiles, accounts, pixels, autoCapi, logs, checkout] = await Promise.all([
    db().from("meta_profiles").select("id"),
    db().from("ad_accounts").select("id", { count: "exact", head: true }).eq("enabled", true),
    getPixels(),
    getSetting<boolean>("auto_capi", false),
    db().from("events_log").select("*").order("created_at", { ascending: false }).limit(15),
    getCheckoutSecrets(),
  ]).then(([p, a, ...rest]) => [p.data ?? [], a.count ?? 0, ...rest] as const);
  const enabledAccounts = accounts;

  const tail = (v: string) => `…${v.slice(-6)}`;
  const universalUrl = `${app}/api/webhooks/universal?key=${checkout.universalKey || "GERE_A_CHAVE"}&platform=kiwify`;

  const hooks: {
    name: string;
    url: string;
    ready: boolean;
    status?: string;
    steps: string[];
    connect: React.ReactNode;
    example?: string;
  }[] = [
    {
      name: "Stripe",
      url: `${app}/api/webhooks/stripe`,
      ready: !!checkout.stripeWebhookSecret,
      status: checkout.stripeSecretKey ? `chave ${tail(checkout.stripeSecretKey)}` : undefined,
      steps: [
        "Cole a chave secreta (Stripe → Developers → API keys → Secret key) e clique em Conectar. O painel cria o webhook na sua conta Stripe sozinho.",
        "Nos Payment Links, o t.js adiciona client_reference_id automaticamente. Em Checkout via API, envie metadata.vid e as UTMs.",
      ],
      connect: (
        <div className="space-y-3">
          <form action={connectStripe} className="flex gap-2 flex-wrap">
            <input className="input mono flex-1 min-w-0" name="secret_key" placeholder="sk_live_…" required autoComplete="off" />
            <SubmitButton className="btn btn-primary" pendingText="Conectando…">{checkout.stripeWebhookSecret ? "Reconectar" : "Conectar Stripe"}</SubmitButton>
          </form>
          <details>
            <summary className="sub underline">Configurar manualmente (webhook já criado na Stripe)</summary>
            <form action={saveStripeManual} className="mt-3 grid sm:grid-cols-2 gap-3">
              <label className="field"><span className="label">Chave secreta (opcional, para ler o nome do produto)</span><input className="input mono" name="secret_key" placeholder="sk_live_…" autoComplete="off" /></label>
              <label className="field"><span className="label">Signing secret do webhook</span><input className="input mono" name="webhook_secret" placeholder="whsec_…" required autoComplete="off" /></label>
              <p className="text-xs text-muted sm:col-span-2">Eventos: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded, charge.dispute.created.</p>
              <div><SubmitButton className="btn" pendingText="Salvando…">Salvar</SubmitButton></div>
            </form>
          </details>
          {checkout.stripeWebhookSecret && (
            <form action={disconnectStripe}><SubmitButton className="btn btn-sm btn-danger" confirm="Desconectar a Stripe e apagar o webhook criado pelo painel?">Desconectar</SubmitButton></form>
          )}
        </div>
      ),
    },
    {
      name: "Hotmart",
      url: `${app}/api/webhooks/hotmart`,
      ready: !!checkout.hotmartHottok,
      status: checkout.hotmartHottok ? `hottok ${tail(checkout.hotmartHottok)}` : undefined,
      steps: [
        "Hotmart → Ferramentas → Webhook → Cadastrar webhook, versão 2.0.0, cole a URL acima.",
        "Marque os eventos de compra: aprovada, completa, boleto/pix gerado, atrasada, reembolsada, chargeback, cancelada, expirada.",
        "Copie o Hottok de verificação (aba Autenticação), cole abaixo e salve.",
        "O t.js coloca o ID da visita no parâmetro sck do checkout, que volta no webhook.",
      ],
      connect: (
        <div className="flex gap-2 flex-wrap">
          <form action={saveHotmart} className="flex gap-2 flex-1 min-w-0">
            <input className="input mono flex-1 min-w-0" name="hottok" placeholder="Hottok" required autoComplete="off" />
            <SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar Hottok</SubmitButton>
          </form>
          {checkout.hotmartHottok && (
            <form action={clearCheckout}><input type="hidden" name="which" value="hotmart" /><SubmitButton className="btn btn-danger" confirm="Remover o Hottok?">Remover</SubmitButton></form>
          )}
        </div>
      ),
    },
    {
      name: "Digistore24",
      url: `${app}/api/webhooks/digistore`,
      ready: !!checkout.digistorePassphrase,
      steps: [
        "Clique em Gerar senha (ou digite a sua) e salve.",
        "Digistore24 → Configurações → Integrações (IPN) → Nova conexão, tipo Generic. Cole a URL acima.",
        "Escolha os produtos, o timing “Antes do redirecionamento para a página de obrigado” e cole a senha SHA abaixo.",
        "O t.js coloca o ID da visita no parâmetro custom do link de pedido, que volta no IPN.",
      ],
      connect: (
        <div className="space-y-3">
          {checkout.digistorePassphrase && (
            <div className="flex gap-2 items-start">
              <code className="codebox flex-1">{checkout.digistorePassphrase}</code>
              <CopyButton text={checkout.digistorePassphrase} label="Copiar senha" />
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <form action={saveDigistore} className="flex gap-2 flex-1 min-w-0">
              <input className="input mono flex-1 min-w-0" name="passphrase" placeholder="Deixe vazio para gerar" autoComplete="off" />
              <SubmitButton className="btn btn-primary" pendingText="Salvando…">{checkout.digistorePassphrase ? "Trocar senha" : "Gerar senha"}</SubmitButton>
            </form>
            {checkout.digistorePassphrase && (
              <form action={clearCheckout}><input type="hidden" name="which" value="digistore" /><SubmitButton className="btn btn-danger" confirm="Remover a senha do IPN?">Remover</SubmitButton></form>
            )}
          </div>
        </div>
      ),
    },
    {
      name: "Universal",
      url: universalUrl,
      ready: !!checkout.universalKey,
      steps: [
        "Funciona com qualquer checkout que mande webhook (Kiwify, Perfect Pay, Eduzz, Yampi…), n8n, Make ou Zapier.",
        "Copie a URL acima (a chave já está nela) e troque platform=kiwify pelo nome que quer ver no painel.",
        "Reconhece sozinho os campos mais comuns (id/order_id, status, amount/value, customer, utm_*). Se precisar montar o JSON, use o formato abaixo.",
      ],
      connect: (
        <form action={newUniversalKey}>
          <SubmitButton className={checkout.universalKey ? "btn btn-sm" : "btn btn-primary"} pendingText="Gerando…" confirm={checkout.universalKey ? "Gerar uma chave nova? A URL antiga para de funcionar." : undefined}>
            {checkout.universalKey ? "Gerar nova chave" : "Gerar chave"}
          </SubmitButton>
        </form>
      ),
      example: JSON.stringify(
        {
          id: "pedido-123",
          status: "approved",
          amount: 197.0,
          currency: "BRL",
          product: "Curso X",
          customer: { name: "Maria Silva", email: "maria@email.com", phone: "11999999999" },
          vid: "id-da-visita-do-t.js",
          utm_source: "FB",
          utm_campaign: "Campanha|120210000000000",
          utm_medium: "Conjunto|120210000000001",
          utm_content: "Anuncio|120210000000002",
        },
        null,
        2,
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1>Integrações</h1>
        <p className="sub">Meta, checkouts, pixel e rastreamento.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      {/* ------------------------------------------------ Meta */}
      <section className="panel panel-pad flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2>Meta Ads</h2>
          <p className="sub">
            {profiles.length
              ? `${profiles.length} perfil(is) conectado(s) · ${enabledAccounts} conta(s) de anúncio no painel`
              : "Conecte seus perfis com token + app para puxar gasto, campanhas e páginas."}
          </p>
        </div>
        <Link className={profiles.length ? "btn" : "btn btn-primary"} href="/perfis">{profiles.length ? "Gerenciar perfis" : "Conectar perfil"}</Link>
      </section>

      <section className="panel panel-pad flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2>Rastreamento (UTMs + script)</h2>
          <p className="sub">Parâmetros dos anúncios, script da página de vendas e gerador de links.</p>
        </div>
        <Link className="btn" href="/utms">Abrir UTMs</Link>
      </section>

      {/* ------------------------------------------------ Pixels */}
      <section className="panel panel-pad space-y-4">
        <div>
          <h2>Pixel — API de Conversões</h2>
          <p className="sub">O script de cada pixel carrega o pixel no site e manda os eventos também pelo servidor. O token é usado no Purchase (envio automático e botão “Disparar venda no pixel”).</p>
        </div>
        {pixels.length > 0 && (
          <ul className="space-y-2">
            {pixels.map((p) => (
              <li key={p.id} className="border border-line rounded-xl p-3 flex flex-col md:flex-row md:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{p.name} {p.is_default && <span className="pill pill-approved ml-1">padrão</span>}</p>
                  <p className="text-xs text-muted">ID {p.pixel_id} · token …{p.access_token.slice(-6)}</p>
                  <details className="mt-3" open={pixels.length === 1 || p.is_default}>
                    <summary className="text-sm font-semibold text-profit">Código do pixel para o site</summary>
                    <p className="text-xs text-muted mt-2">
                      Cole na &lt;head&gt; de todas as páginas (presell, vendas, obrigado) no lugar do código do pixel da Meta. Ele carrega o pixel e manda
                      PageView, ViewContent e InitiateCheckout pelo navegador e pelo servidor, e passa as UTMs para o checkout.
                    </p>
                    <code className="codebox mt-2 !text-[0.75rem]">{pixelSnippet(app, [p.pixel_id])}</code>
                    <div className="mt-2"><CopyButton text={pixelSnippet(app, [p.pixel_id])} label="Copiar código" /></div>
                  </details>
                </div>
                <form action={updatePixelTestCode} className="flex gap-1">
                  <input type="hidden" name="id" value={p.id} />
                  <input className="input !h-8 !w-32 text-sm" name="test_event_code" defaultValue={p.test_event_code ?? ""} placeholder="TEST1234" aria-label="Código de evento de teste" />
                  <SubmitButton className="btn btn-sm" pendingText="…">Salvar teste</SubmitButton>
                </form>
                <div className="flex gap-1">
                  {!p.is_default && (
                    <form action={setDefaultPixel}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm">Tornar padrão</SubmitButton></form>
                  )}
                  <form action={deletePixel}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o pixel ${p.name}?`}>Remover</SubmitButton></form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={addPixel} className="grid sm:grid-cols-2 gap-3">
          <label className="field"><span className="label">Nome</span><input className="input" name="name" placeholder="Pixel principal" /></label>
          <label className="field"><span className="label">ID do pixel</span><input className="input num" name="pixel_id" inputMode="numeric" required /></label>
          <label className="field sm:col-span-2">
            <span className="label">Token da API de Conversões (Gerenciador de Eventos → pixel → Configurações → Gerar token)</span>
            <input className="input mono" name="access_token" required />
          </label>
          <label className="field"><span className="label">Código de teste (opcional)</span><input className="input" name="test_event_code" placeholder="TEST1234" /></label>
          <div className="flex items-end"><SubmitButton className="btn btn-primary" pendingText="Salvando…">Adicionar pixel</SubmitButton></div>
        </form>
        <div className="border-t border-line pt-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3>Envio automático</h3>
            <p className="sub">Toda venda aprovada vai para o pixel padrão pelo servidor, além do pixel da página.</p>
          </div>
          <form action={setAutoCapi}>
            <input type="hidden" name="auto" value={String(!autoCapi)} />
            <SubmitButton className={autoCapi ? "btn" : "btn btn-primary"} pendingText="…">{autoCapi ? "Desligar" : "Ligar"}</SubmitButton>
          </form>
        </div>
        <p className="text-xs text-muted">A Meta aceita eventos de até 7 dias e deduplica pelo ID da venda, então disparar de novo a mesma venda não conta duas vezes.</p>
      </section>

      {/* ------------------------------------------------ Webhooks */}
      <section className="space-y-3">
        <h2>Webhooks dos checkouts</h2>
        {hooks.map((h) => (
          <details key={h.name} className="panel panel-pad">
            <summary className="flex items-center justify-between gap-3">
              <span className="font-semibold">{h.name}</span>
              <span className="flex items-center gap-2">
                {h.status && <span className="text-xs text-muted mono">{h.status}</span>}
                <span className={`pill ${h.ready ? "pill-approved" : "pill-pending"}`}>{h.ready ? "Conectado" : "Falta conectar"}</span>
              </span>
            </summary>
            <div className="mt-4 space-y-3">
              <div className="flex gap-2 items-start">
                <code className="codebox flex-1">{h.url}</code>
                <CopyButton text={h.url} />
              </div>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-muted">
                {h.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              {h.connect}
              {h.example && <code className="codebox">{h.example}</code>}
            </div>
          </details>
        ))}
      </section>

      {/* ------------------------------------------------ Log */}
      <section className="panel overflow-x-auto">
        <div className="panel-pad pb-0"><h2>Últimos eventos recebidos</h2></div>
        <table className="tbl min-w-[600px]">
          <thead><tr><th>Quando</th><th>Origem</th><th>Evento</th><th>Resultado</th></tr></thead>
          <tbody>
            {(logs.data ?? []).map((l: any) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-sm">{fmtDateTime(l.created_at, env.timezone)}</td>
                <td className="text-sm">{l.source}</td>
                <td className="text-sm mono">{l.kind}</td>
                <td className={`text-sm ${l.ok ? "" : "neg"}`}>{l.message ?? (l.ok ? "ok" : "erro")}</td>
              </tr>
            ))}
            {!logs.data?.length && <tr><td colSpan={4} className="text-center text-muted py-6">Nada recebido ainda.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
