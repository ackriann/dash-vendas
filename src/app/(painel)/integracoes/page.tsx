import Link from "next/link";
import { db, getSetting } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/dates";
import { getPixels } from "@/lib/capi";
import { getCheckoutSecrets } from "@/lib/checkouts";
import { pixelSnippet } from "@/lib/utm";
import { ipnInfo, ipnUrl as digistoreIpnUrl, type IpnInfo } from "@/lib/digistore";
import { HEALTH_PILL, webhookHealth, type Health } from "@/lib/webhook-health";
import Notice from "@/components/Notice";
import CopyButton from "@/components/CopyButton";
import SubmitButton from "@/components/SubmitButton";
import Help from "@/components/Help";
import Acc from "@/components/Acc";
import {
  addPixel, clearCheckout, connectDigistore, connectStripe, disconnectDigistore, deletePixel, disconnectStripe, newUniversalKey, saveDigistore,
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

  const tz = env.timezone;
  const [hStripe, hHotmart, hDigi, hUni] = await Promise.all([
    webhookHealth({ source: "stripe" }, !!checkout.stripeWebhookSecret),
    webhookHealth({ source: "hotmart" }, !!checkout.hotmartHottok),
    webhookHealth({ source: "digistore" }, true),
    webhookHealth({ kind: "universal" }, !!checkout.universalKey),
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
      url: `${app}/api/webhooks/stripe`,
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
      name: "Hotmart",
      url: `${app}/api/webhooks/hotmart`,
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
      url: digistoreIpnUrl(),
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
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1>Integrações</h1>
        <p className="sub">Meta, pixel e checkouts. Clique em cada item para abrir.</p>
      </header>
      <Notice ok={sp.ok} erro={sp.erro} />

      {/* ------------------------------------------------ Meta e rastreamento */}
      <section>
        <h2 className="mb-3">Meta</h2>
        <div className="acc">
          <Link href="/perfis" className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] hover:bg-[#18303a]">
            <span className="flex-1 min-w-0">
              <span className="acc-title">Perfis e contas de anúncio</span>
              <span className="acc-sub">
                {profiles.length ? `${profiles.length} perfil(is) · ${enabledAccounts} conta(s) no painel` : "Nenhum perfil conectado"}
              </span>
            </span>
            <span className={`pill ${profiles.length ? "pill-approved" : "pill-pending"}`}>{profiles.length ? "Conectado" : "Conectar"}</span>
          </Link>
        </div>
        <div className="acc">
          <Link href="/utms" className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] hover:bg-[#18303a]">
            <span className="flex-1 min-w-0">
              <span className="acc-title">UTMs e script de rastreamento</span>
              <span className="acc-sub">Parâmetros dos anúncios e gerador de links</span>
            </span>
            <span className="text-muted" aria-hidden>→</span>
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------ Pixels */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2>Pixel</h2>
          <Help title="Como funciona o pixel do painel">
            <ul>
              <li>O <b>código do pixel</b> vai no &lt;head&gt; de todas as páginas (presell, vendas, obrigado), <b>no lugar</b> do código do pixel da Meta.</li>
              <li>Ele carrega o pixel e manda <b>PageView, ViewContent e InitiateCheckout</b> pelo navegador e pelo servidor, sem contar duas vezes.</li>
              <li>Também guarda as UTMs da visita e passa para o checkout, para a venda cair na campanha certa.</li>
              <li>O <b>Purchase</b> vai pelo servidor quando o checkout aprova a venda (com o envio automático ligado) ou pelo botão “Disparar venda no pixel”.</li>
              <li>A Meta aceita eventos de até 7 dias e não conta a mesma venda duas vezes.</li>
            </ul>
          </Help>
        </div>
        {pixels.map((p) => (
          <Acc
            key={p.id}
            title={p.name}
            sub={`ID ${p.pixel_id} · token …${p.access_token.slice(-6)}${p.test_event_code ? ` · teste ${p.test_event_code}` : ""}`}
            right={p.is_default ? <span className="pill pill-approved">padrão</span> : undefined}
            open={pixels.length === 1}
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-profit">Código do pixel para o site</p>
                <Help title="Onde colar o código">
                  <ol>
                    <li>Copie o código.</li>
                    <li>Cole no &lt;head&gt; de <b>todas</b> as páginas: presell, vendas e obrigado.</li>
                    <li><b>Tire o código antigo do pixel da Meta</b> dessas páginas (inclusive de plugin ou construtor de página), senão o PageView conta em dobro.</li>
                  </ol>
                </Help>
              </div>
              <code className="codebox !text-[0.75rem]">{pixelSnippet(app, [p.pixel_id])}</code>
              <div className="mt-2"><CopyButton text={pixelSnippet(app, [p.pixel_id])} label="Copiar código" /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <form action={updatePixelTestCode} className="flex gap-1 items-center">
                <input type="hidden" name="id" value={p.id} />
                <input className="input !h-8 !w-32 text-sm" name="test_event_code" defaultValue={p.test_event_code ?? ""} placeholder="TEST1234" aria-label="Código de evento de teste" />
                <SubmitButton className="btn btn-sm" pendingText="…">Salvar teste</SubmitButton>
                <Help title="Código de teste">
                  <p>Para ver os eventos chegando sem afetar as campanhas:</p>
                  <ol>
                    <li>Gerenciador de Eventos → seu pixel → <b>Eventos de teste</b>.</li>
                    <li>Copie o código (ex.: TEST1234), cole aqui e salve.</li>
                    <li>Os eventos aparecem lá marcados como Navegador e Servidor.</li>
                    <li><b>Apague o código depois</b>: enquanto ele estiver salvo, os eventos não contam para as campanhas.</li>
                  </ol>
                </Help>
              </form>
              <div className="flex gap-1 ml-auto">
                {!p.is_default && (
                  <form action={setDefaultPixel}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm">Tornar padrão</SubmitButton></form>
                )}
                <form action={deletePixel}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm btn-danger" confirm={`Remover o pixel ${p.name}?`}>Remover</SubmitButton></form>
              </div>
            </div>
          </Acc>
        ))}
        <Acc
          title="Envio automático do Purchase"
          sub="Toda venda aprovada vai para o pixel padrão pelo servidor"
          right={<span className={`pill ${autoCapi ? "pill-approved" : ""}`}>{autoCapi ? "Ligado" : "Desligado"}</span>}
        >
          <form action={setAutoCapi} className="flex items-center gap-3">
            <input type="hidden" name="auto" value={String(!autoCapi)} />
            <SubmitButton className={autoCapi ? "btn" : "btn btn-primary"} pendingText="…">{autoCapi ? "Desligar" : "Ligar"}</SubmitButton>
            <span className="text-sm text-muted">Recomendado ligado: a Meta recebe só as compras pagas de verdade.</span>
          </form>
        </Acc>
        <Acc title="Adicionar pixel" sub="ID do pixel + token da API de Conversões" open={!pixels.length}>
          <form action={addPixel} className="grid sm:grid-cols-2 gap-3">
            <label className="field"><span className="label">Nome</span><input className="input" name="name" placeholder="Pixel principal" /></label>
            <label className="field"><span className="label">ID do pixel</span><input className="input num" name="pixel_id" inputMode="numeric" required /></label>
            <label className="field sm:col-span-2">
              <span className="label flex items-center gap-2">
                Token da API de Conversões
                <Help title="Onde pegar o token">
                  <ol>
                    <li>Abra o <b>Gerenciador de Eventos</b> da Meta.</li>
                    <li>Escolha o pixel → <b>Configurações</b>.</li>
                    <li>Em <b>API de Conversões</b>, clique em <b>Gerar token de acesso</b> e copie.</li>
                  </ol>
                </Help>
              </span>
              <input className="input mono" name="access_token" required />
            </label>
            <label className="field"><span className="label">Código de teste (opcional)</span><input className="input" name="test_event_code" placeholder="TEST1234" /></label>
            <div className="flex items-end"><SubmitButton className="btn btn-primary" pendingText="Salvando…">Adicionar pixel</SubmitButton></div>
          </form>
        </Acc>
      </section>

      {/* ------------------------------------------------ Webhooks */}
      <section>
        <h2 className="mb-3">Checkouts</h2>
        {hooks.map((h) => (
          <Acc
            key={h.name}
            title={h.name}
            sub={h.status}
            open={h.health.state === "error"}
            right={
              <>
                <Help title={`Como conectar ${h.name}`}>
                  <ol>{h.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  {h.example && (
                    <>
                      <p>Formato do JSON, se precisar montar:</p>
                      <code className="codebox !text-[0.72rem]">{h.example}</code>
                    </>
                  )}
                </Help>
                <span className={`pill ${HEALTH_PILL[h.health.state].cls}`}>{HEALTH_PILL[h.health.state].label}</span>
              </>
            }
          >
            {h.checks.length > 0 && <Checklist checks={h.checks} />}
            <div>
              <p className="label">URL do webhook</p>
              <div className="flex gap-2 items-start">
                <code className="codebox flex-1">{h.url}</code>
                <CopyButton text={h.url} />
              </div>
            </div>
            {h.connect}
          </Acc>
        ))}
      </section>

      {/* ------------------------------------------------ Log */}
      <section>
        <Acc title="Últimos eventos recebidos" sub={`${logs.data?.length ?? 0} mais recentes`}>
          <div className="overflow-x-auto -m-4">
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
          </div>
        </Acc>
      </section>
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
