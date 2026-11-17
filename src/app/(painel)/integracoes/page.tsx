import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { getPixels } from "@/lib/capi";
import IntegrationProfiles from "@/components/IntegrationProfiles";
import CheckoutPicker from "@/components/CheckoutPicker";
import { RECOMMENDED_UTM } from "@/lib/utm";
import { pixelCodeSnippet } from "@/lib/pixel-code";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { currentWorkspace, withWorkspace } from "@/lib/workspaces";
import { ipnInfo, ipnUrl as digistoreIpnUrl, type IpnInfo } from "@/lib/digistore";
import { HEALTH_PILL, webhookHealth, type Health } from "@/lib/webhook-health";
import Notice from "@/components/Notice";
import CopyButton from "@/components/CopyButton";
import SubmitButton from "@/components/SubmitButton";
import Help from "@/components/Help";
import {
  addPixel, clearCheckout, connectDigistore, connectStripe, disconnectDigistore, deletePixel, disconnectStripe, newUniversalKey, saveDigistore,
  saveCooud, saveHotmart, saveStripeManual,
} from "./actions";

export default async function Integracoes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const ws = await currentWorkspace();
  const pub = (path: string) => withWorkspace(`${env.appUrl}${path}`, ws);
  const [pixels, checkout] = await Promise.all([getPixels(), getCheckoutSecrets()]);

  const tail = (v: string) => `…${v.slice(-6)}`;
  const universalUrl = pub(`/api/webhooks/universal?key=${checkout.universalKey || "GERE_A_CHAVE"}&platform=kiwify`);

  const tz = env.timezone;
  const [hStripe, hHotmart, hDigi, hUni, hCooud] = await Promise.all([
    webhookHealth({ source: "stripe" }, !!checkout.stripeWebhookSecret),
    webhookHealth({ source: "hotmart" }, !!checkout.hotmartHottok),
    webhookHealth({ source: "digistore" }, true),
    webhookHealth({ kind: "universal" }, !!checkout.universalKey),
    webhookHealth({ source: "cooud" }, !!checkout.cooudWebhookSecret),
  ]);

  // Digistore: confere na própria Digistore (se conectada pela chave de API) + o que chegou de verdade
  let dsInfo: IpnInfo | null = null;
  let dsInfoErr: string | null = null;
  if (checkout.digistoreApiKey) {
    try {
      dsInfo = await ipnInfo(checkout.digistoreApiKey);
    } catch (e: any) {
      dsInfoErr = e?.message ?? "erro";
    }
  }
  const dsChecks: Check[] = [];
  if (checkout.digistoreApiKey) {
    dsChecks.push({
      ok: dsInfoErr ? null : !!dsInfo?.exists,
      text: dsInfoErr ? `Não deu para consultar a Digistore24: ${dsInfoErr}` : "Conexão IPN existe na sua conta Digistore24",
      fix: "A conexão não existe mais na Digistore24. Clique em Reconectar.",
    });
    if (dsInfo?.exists) {
      dsChecks.push({
        ok: dsInfo.urlOk,
        text: dsInfo.urlOk ? "A conexão aponta para este painel" : `A conexão aponta para outro endereço: ${dsInfo.url}`,
        fix: "Clique em Reconectar para apontar a conexão para este painel.",
      });
    }
  }
  const dsSecretFix = checkout.digistoreApiKey
    ? "Clique em Reconectar para o painel recriar a conexão com a URL certa."
    : "Na Digistore24 → Configurações → Integrações (IPN) → sua conexão, troque a URL pela URL acima (ela já tem a chave de segurança, não precisa de senha), salve e clique em “Testar conexão”.";
  if (hDigi.state === "error") {
    // Está chegando, mas recusado: a URL está certa, o problema é a senha
    dsChecks.push({ ok: true, text: `A Digistore24 está mandando avisos para o painel (último: ${fmtDateTime(hDigi.lastError!.at, tz)})`, fix: "" });
    dsChecks.push({ ok: false, text: `Aviso recusado: ${hDigi.lastError!.message}`, fix: dsSecretFix });
  } else {
    dsChecks.push({
      ok: !!hDigi.lastOk,
      text: hDigi.lastOk
        ? `Digistore24 mandando avisos e aceitos pelo painel (último: ${fmtDateTime(hDigi.lastOk.at, tz)}${hDigi.lastOk.kind ? ` · ${hDigi.lastOk.kind}` : ""})`
        : "Nenhum aviso da Digistore24 chegou ainda",
      fix: checkout.digistoreApiKey
        ? "A conexão está criada; o primeiro aviso chega na próxima venda. Para testar já: Digistore24 → Configurações → Integrações (IPN) → conexão “Painel de Vendas” → Testar conexão."
        : "Na Digistore24 → Configurações → Integrações (IPN), crie a conexão tipo Generic com a URL acima, salve e clique em “Testar conexão”. Se continuar sem chegar, a URL ou a conexão estão erradas.",
    });
  }

  const genericChecks = (h: Health, label: string, fixError: string, fixWaiting: string): Check[] =>
    h.state === "off"
      ? []
      : [
          {
            ok: !!h.lastOk,
            text: h.lastOk ? `${label} já mandou aviso (último: ${fmtDateTime(h.lastOk.at, tz)}${h.lastOk.kind ? ` · ${h.lastOk.kind}` : ""})` : `Nenhum aviso da ${label} chegou ainda`,
            fix: fixWaiting,
          },
          ...(h.state === "error"
            ? [{ ok: false, text: `Último aviso recusado (${fmtDateTime(h.lastError!.at, tz)}): ${h.lastError!.message}`, fix: fixError }]
            : []),
        ];

  const hooks: {
    name: string;
    url: string;
    health: Health;
    checks: Check[];
    status?: string;
    steps: string[];
    connect: React.ReactNode;
    example?: string;
  }[] = [
    {
      name: "Stripe",
      url: pub("/api/webhooks/stripe"),
      health: hStripe,
      checks: genericChecks(hStripe, "Stripe", "Clique em Reconectar: o segredo do webhook (whsec_) não confere.", "O webhook está criado; o primeiro aviso chega na próxima compra ou no Enviar evento de teste da Stripe."),
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
      name: "Cooud",
      url: pub("/api/webhooks/cooud"),
      health: hCooud,
      checks: genericChecks(
        hCooud,
        "Cooud",
        "O segredo salvo não confere com o do webhook. Na Cooud o segredo só aparece na criação: crie um webhook novo com a URL acima e cole o whsec_ novo aqui.",
        "O aviso chega na próxima venda. Confira na Cooud se o webhook tem a URL acima e o evento order.paid marcado.",
      ),
      status: checkout.cooudWebhookSecret ? `whsec ${tail(checkout.cooudWebhookSecret)}${checkout.cooudApiKey ? " · API ok" : ""}` : undefined,
      steps: [
        "Na Cooud: Store → Integrations → Webhooks → Novo webhook, cole a URL acima.",
        "Marque os eventos order.paid e order.refunded (order.created também, se quiser ver Pix/boleto gerado como pendente).",
        "A Cooud mostra o segredo (whsec_…) uma única vez: copie, cole abaixo e salve.",
        "Opcional: a chave de API (Store → Integrations → Chaves da API v2 → Criar chave live) completa cada venda com e-mail, valor líquido e UTMs.",
        "O t.js coloca o ID da visita e as UTMs no link do checkout da Cooud.",
      ],
      connect: (
        <div className="space-y-3">
          <form action={saveCooud} className="grid sm:grid-cols-2 gap-3">
            <label className="field">
              <span className="label">Segredo do webhook</span>
              <input className="input mono" name="webhook_secret" placeholder={checkout.cooudWebhookSecret ? `salvo (${tail(checkout.cooudWebhookSecret)})` : "whsec_…"} required={!checkout.cooudWebhookSecret} autoComplete="off" />
            </label>
            <label className="field">
              <span className="label">Chave de API (opcional)</span>
              <input className="input mono" name="api_key" placeholder={checkout.cooudApiKey ? `salva (${tail(checkout.cooudApiKey)})` : "cooud_sk_live_…"} autoComplete="off" />
            </label>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-primary" pendingText="Conferindo…">{checkout.cooudWebhookSecret ? "Salvar" : "Conectar Cooud"}</SubmitButton></div>
          </form>
          {checkout.cooudWebhookSecret && (
            <div className="flex gap-2 flex-wrap">
              {checkout.cooudApiKey && (
                <form action={clearCheckout}><input type="hidden" name="which" value="cooud_key" /><SubmitButton className="btn btn-sm" confirm="Remover a chave de API da Cooud? O webhook continua funcionando.">Remover chave de API</SubmitButton></form>
              )}
              <form action={clearCheckout}><input type="hidden" name="which" value="cooud" /><SubmitButton className="btn btn-sm btn-danger" confirm="Desconectar a Cooud? As vendas param de chegar até você conectar de novo.">Desconectar</SubmitButton></form>
            </div>
          )}
        </div>
      ),
    },
    {
      name: "Hotmart",
      url: pub("/api/webhooks/hotmart"),
      health: hHotmart,
      checks: genericChecks(hHotmart, "Hotmart", "O Hottok salvo é diferente do da Hotmart. Copie de novo em Hotmart → Ferramentas → Webhook → Autenticação.", "Na Hotmart → Ferramentas → Webhook, confira a URL acima e use “Enviar teste”."),
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
      url: digistoreIpnUrl(ws),
      health: hDigi,
      checks: dsChecks,
      status: checkout.digistoreApiKey ? "via chave de API" : undefined,
      steps: [
        "Mais simples: Digistore24 → Configurações → Integrações (IPN) → Nova conexão, tipo Generic. Cole a URL acima — ela já tem a chave de segurança, então NÃO precisa de senha. Produtos: todos. Salve e clique em “Testar conexão”.",
        "Ou automático: crie uma chave de API (Configurações da conta → Acesso à conta → Chaves de API, acesso total), cole abaixo e clique em Conectar Digistore24 — o painel cria a conexão sozinho.",
        "O t.js coloca o ID da visita no parâmetro custom do link de pedido, que volta no IPN.",
      ],
      connect: (
        <div className="space-y-3">
          <form action={connectDigistore} className="flex gap-2 flex-wrap">
            <input className="input mono flex-1 min-w-0" name="api_key" type="password" placeholder="Chave de API da Digistore24" required autoComplete="off" />
            <SubmitButton className="btn btn-primary" pendingText="Conectando…">{checkout.digistoreApiKey ? "Reconectar" : "Conectar Digistore24"}</SubmitButton>
          </form>
          {checkout.digistoreApiKey && (
            <form action={disconnectDigistore}><SubmitButton className="btn btn-sm btn-danger" confirm="Desconectar a Digistore24 e apagar a conexão IPN criada pelo painel?">Desconectar</SubmitButton></form>
          )}
          <details>
            <summary className="sub underline">Senha SHA (opcional)</summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted">Só se quiser usar a senha da Digistore além da chave da URL. Se usar, a senha da conexão na Digistore precisa ser igual a esta.</p>
              {checkout.digistorePassphrase && (
                <div className="flex gap-2 items-start">
                  <code className="codebox flex-1">{checkout.digistorePassphrase}</code>
                  <CopyButton text={checkout.digistorePassphrase} label="Copiar senha" />
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <form action={saveDigistore} className="flex gap-2 flex-1 min-w-0">
                  <input className="input mono flex-1 min-w-0" name="passphrase" placeholder="Deixe vazio para gerar" autoComplete="off" />
                  <SubmitButton className="btn" pendingText="Salvando…">{checkout.digistorePassphrase ? "Trocar senha" : "Gerar senha"}</SubmitButton>
                </form>
                {checkout.digistorePassphrase && (
                  <form action={clearCheckout}><input type="hidden" name="which" value="digistore" /><SubmitButton className="btn btn-danger" confirm="Remover a senha do IPN?">Remover</SubmitButton></form>
                )}
              </div>
            </div>
          </details>
        </div>
      ),
    },
    {
      name: "Universal",
      url: universalUrl,
      health: hUni,
      checks: genericChecks(hUni, "plataforma", "A chave da URL não confere: copie a URL acima de novo e atualize no checkout.", "Cadastre a URL acima no checkout e faça uma venda/teste."),
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
    <div className="space-y-6">
      <header>
        <h1>Integrações</h1>
        <p className="sub">Perfil Meta, Pixel e UTM e Checkout — tudo em um único lugar.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      <div className="grid grid-cols-1 lg:grid-cols-3 items-start gap-4">
        <IntegrationProfiles />

        <section id="rastreamento" className="rounded-2xl border border-line bg-surface p-4 sm:p-5 min-w-0 space-y-5">
          <div>
            <h2>Pixel e UTM</h2>
            <p className="text-sm text-muted mt-1">Cadastre o pixel e copie os dois códigos de rastreamento.</p>
          </div>

          <div className="space-y-3 rounded-xl bg-[#10232b] border border-line p-3 sm:p-4">
            <h3 className="font-semibold">Pixel</h3>
            <form action={addPixel} className="space-y-3">
              <label className="field">
                <span className="label">Nome</span>
                <input className="input" name="name" placeholder="Pixel principal" required />
              </label>
              <label className="field">
                <span className="label">ID do pixel</span>
                <input className="input mono" name="pixel_id" inputMode="numeric" placeholder="123456789012345" required />
              </label>
              <label className="field">
                <span className="label">Token da API de Conversões</span>
                <input className="input mono" name="access_token" type="password" autoComplete="new-password"
                  placeholder="Token de acesso do pixel" required />
              </label>
              <SubmitButton className="btn btn-primary" pendingText="Salvando…">Salvar pixel</SubmitButton>
            </form>
            {pixels.length > 0 && (
              <ul className="space-y-2 pt-3 border-t border-line">
                {pixels.map((p) => (
                  <li key={p.id} className="flex flex-wrap gap-2 items-center justify-between rounded-lg border border-line p-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm break-words">{p.name}</p>
                      <p className="text-xs text-muted break-all">ID {p.pixel_id} · token •••{p.access_token.slice(-4)}{p.is_default ? " · padrão" : ""}</p>
                    </div>
                    <form action={deletePixel}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o pixel ${p.name}? A coleta dos eventos vinculados a ele será interrompida.`}>Remover</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold">UTM</h3>
            <div className="rounded-xl border border-line bg-[#10232b] p-3 space-y-2">
              <p className="font-medium text-sm">1. Parâmetros dos anúncios</p>
              <p className="text-xs text-muted">Cole em Rastreamento → Parâmetros de URL, no anúncio da Meta.</p>
              <code className="codebox block text-xs max-h-44 overflow-auto">{RECOMMENDED_UTM}</code>
              <CopyButton text={RECOMMENDED_UTM} label="Copiar UTM 1" />
            </div>
            <div className="rounded-xl border border-line bg-[#10232b] p-3 space-y-2">
              <p className="font-medium text-sm">2. Código de rastreamento na página</p>
              <p className="text-xs text-muted">Cole no &lt;head&gt; da página. O script registra UTMs e usa os pixels configurados.</p>
              <code className="codebox block text-xs max-h-44 overflow-auto">{pixelCodeSnippet(ws.pixel_code)}</code>
              <CopyButton text={pixelCodeSnippet(ws.pixel_code)} label="Copiar UTM 2" />
              {!pixels.length && <p className="text-xs text-spend">Cadastre um pixel acima para enviar eventos à Meta.</p>}
            </div>
          </div>
        </section>

        <CheckoutPicker
          options={hooks.map((h) => ({
            name: h.name,
            status: HEALTH_PILL[h.health.state].label,
            ready: h.health.state !== "off" || Boolean(h.status),
          }))}
          panels={hooks.map((h) => (
            <div key={h.name} className="space-y-3">
              {h.checks.length > 0 && <Checklist checks={h.checks} />}
              <div>
                <p className="label">URL do webhook</p>
                <div className="flex gap-2 items-start">
                  <code className="codebox flex-1 !text-[0.75rem]">{h.url}</code>
                  <CopyButton text={h.url} label="Copiar URL" />
                </div>
              </div>
              {h.connect}
              <details className="border-t border-line pt-3">
                <summary className="text-sm font-medium text-muted cursor-pointer">
                  Como configurar {h.name}
                </summary>
                <ol className="list-decimal text-sm text-muted pl-5 mt-2 space-y-2">
                  {h.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
                {h.example && (
                  <div className="space-y-2 mt-3">
                    <p className="label">Exemplo JSON</p>
                    <code className="codebox !text-[0.72rem] max-h-60 overflow-auto">{h.example}</code>
                  </div>
                )}
              </details>
            </div>
          ))}
        />
      </div>
    </div>
  );
}

interface Check {
  ok: boolean | null; // null = não deu para conferir
  text: string;
  fix: string;
}

/** Lista do que foi conferido e, no primeiro item que falhou, o que falta fazer. */
function Checklist({ checks }: { checks: Check[] }) {
  const firstFail = checks.find((c) => c.ok === false);
  return (
    <div className="border border-line rounded-xl p-3 space-y-1.5">
      {checks.map((c) => (
        <p key={c.text} className="text-sm flex gap-2">
          <span aria-hidden className={c.ok ? "pos" : c.ok === false ? "neg" : "text-spend"}>{c.ok ? "✓" : c.ok === false ? "✗" : "?"}</span>
          <span className={c.ok ? "" : "font-medium"}>{c.text}</span>
        </p>
      ))}
      {firstFail ? (
        <div className="notice notice-warn text-sm !mt-3"><b>O que falta:</b> {firstFail.fix}</div>
      ) : (
        checks.every((c) => c.ok) && <p className="text-xs text-muted pt-1">Tudo certo: as vendas estão chegando no painel.</p>
      )}
    </div>
  );
}
