import { currentWorkspace, publicUrl } from "@/lib/workspaces";
import { env } from "@/lib/env";
import { listDashboards } from "@/lib/dashboards";
import PixelCodes from "@/components/PixelCodes";
import Link from "next/link";
import { RECOMMENDED_UTM } from "@/lib/utm";
import { getPixels } from "@/lib/capi";
import CopyButton from "@/components/CopyButton";
import UtmBuilder from "@/components/UtmBuilder";
import Help from "@/components/Help";
import Acc from "@/components/Acc";

export default async function Utms() {
  const tjs = await publicUrl("/t.js");
  const [pixels, dashes, ws] = await Promise.all([getPixels(), listDashboards(), currentWorkspace()]);
  const main = pixels.slice(0, 1);
  const scriptDomains = `<script src="${env.appUrl}/t.js" data-pixel="${ws.pixel_code}" data-domains="checkout.meusite.com" async></script>`;
  const scriptOnlyUtm = `<script src="${tjs}" async></script>`;

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1>UTMs</h1>
        <p className="sub">Como cada venda é ligada à campanha, conjunto e anúncio. Clique em cada passo para abrir.</p>
      </header>

      <section>
        <Acc
          title="1. Parâmetros nos anúncios da Meta"
          sub="Colar em Parâmetros de URL de cada anúncio"
          right={
            <Help title="Onde colar as UTMs">
              <ol>
                <li>Gerenciador de Anúncios → selecione os anúncios (pode ser vários de uma vez) → <b>Editar</b>.</li>
                <li>Em <b>Rastreamento → Parâmetros de URL</b>, cole o texto copiado.</li>
                <li>Publique. O ID depois do “|” liga a venda ao anúncio, mesmo se você renomear a campanha.</li>
              </ol>
            </Help>
          }
        >
          <code className="codebox">{RECOMMENDED_UTM}</code>
          <div><CopyButton text={RECOMMENDED_UTM} label="Copiar UTMs" /></div>
        </Acc>

        <Acc
          title="2. Código do pixel na página"
          sub={main.length ? "Um código por dash · carrega os pixels do dash e rastreia as UTMs" : "Rastreia as UTMs (cadastre o pixel para incluir)"}
          open
          right={
            <Help title="Como usar o código">
              <ul>
                <li>Cole no &lt;head&gt; de <b>todas</b> as páginas: presell, vendas e obrigado.</li>
                <li>Ele <b>carrega o pixel da Meta</b> e manda PageView, ViewContent e InitiateCheckout pelo navegador e pelo servidor, sem contar duas vezes.</li>
                <li><b>Tire o código antigo do pixel da Meta</b> dessas páginas, senão o PageView conta em dobro.</li>
                <li>Também passa as UTMs para o checkout (Hotmart → sck, Digistore24 → custom, Stripe → client_reference_id, outros → vid e UTMs).</li>
                <li>O Purchase vai pelo servidor quando o checkout aprova a venda.</li>
              </ul>
            </Help>
          }
        >
          {!main.length && (
            <div className="notice notice-warn text-sm">
              Cadastre o pixel em <Link className="underline" href="/integracoes">Integrações → Pixel</Link> para o código já sair com ele.
            </div>
          )}
          {main.length ? (
            <PixelCodes accountCode={ws.pixel_code} dashes={dashes} pixels={pixels} />
          ) : (
            <>
              <code className="codebox">{scriptOnlyUtm}</code>
              <div><CopyButton text={scriptOnlyUtm} label="Copiar código" /></div>
            </>
          )}
          <Acc title="Opções avançadas" sub="Vários pixels, valor da oferta, checkout em domínio próprio">
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
              <li>Os pixels de cada código são os marcados no dash (em <b>Dashes</b>). Mudou lá, muda no site sem trocar o código.</li>
              <li><code>data-value=&quot;197&quot; data-currency=&quot;BRL&quot; data-content-name=&quot;Curso X&quot;</code> — valor da oferta nos eventos.</li>
              <li><code>data-events=&quot;PageView&quot;</code> — eventos ao abrir a página (padrão: PageView,ViewContent). Use só PageView na presell.</li>
              <li><code>painelTrack(&quot;Lead&quot;)</code> — dispara outro evento, por exemplo no envio de um formulário.</li>
              <li>Checkout reconhecido sozinho: Hotmart, Kiwify, Perfect Pay, Eduzz, Cakto, Ticto, Lastlink, Payt, Greenn, Braip, Yampi, Monetizze, Digistore24 e Stripe. Outro domínio:</li>
            </ul>
            <code className="codebox">{scriptDomains}</code>
            <div><CopyButton text={scriptDomains} label="Copiar" /></div>
          </Acc>
        </Acc>

        <Acc title="3. Checkout devolvendo as UTMs" sub="Automático na maioria dos checkouts">
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
            <li><b>Hotmart, Digistore24, Stripe:</b> automático com o código acima.</li>
            <li><b>Kiwify, Perfect Pay, Eduzz, Yampi e outros:</b> repassam as UTMs para o webhook. Use o webhook universal em Integrações.</li>
            <li>Venda sem UTM com ID aparece como “sem rastreio” em Campanhas.</li>
          </ul>
        </Acc>

        <Acc
          title="Gerador de link com UTM"
          sub="Bio, stories, e-mail, WhatsApp, influenciador"
          right={<Help title="Para que serve"><p>Monta um link com UTMs para tráfego que não é anúncio. As vendas aparecem no Resumo agrupadas pela origem (utm_source).</p></Help>}
        >
          <UtmBuilder />
        </Acc>
      </section>
    </div>
  );
}
