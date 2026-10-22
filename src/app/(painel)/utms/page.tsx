import { env } from "@/lib/env";
import Link from "next/link";
import { RECOMMENDED_UTM, pixelSnippet } from "@/lib/utm";
import { getPixels } from "@/lib/capi";
import CopyButton from "@/components/CopyButton";
import UtmBuilder from "@/components/UtmBuilder";

export default async function Utms() {
  const app = env.appUrl;
  const pixels = await getPixels();
  const main = pixels.filter((p) => p.is_default).concat(pixels.filter((p) => !p.is_default)).slice(0, 1);
  const pixelAttr = main.length ? ` data-pixel="${main.map((p) => p.pixel_id).join(",")}"` : "";
  const script = main.length ? pixelSnippet(app, main.map((p) => p.pixel_id)) : `<script src="${app}/t.js" async></script>`;
  const scriptDomains = `<script src="${app}/t.js"${pixelAttr} data-domains="checkout.meusite.com" async></script>`;

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1>UTMs</h1>
        <p className="sub">Como cada venda é ligada à campanha, conjunto e anúncio que a gerou.</p>
      </header>

      <section className="panel panel-pad space-y-3">
        <h2>1. Parâmetros nos anúncios da Meta</h2>
        <p className="sub">
          No Gerenciador de Anúncios, em cada anúncio → <b>Rastreamento → Parâmetros de URL</b>, cole o texto abaixo. Dá para selecionar vários anúncios e
          colar de uma vez. O ID depois do “|” é o que liga a venda ao anúncio, mesmo que você renomeie a campanha.
        </p>
        <code className="codebox">{RECOMMENDED_UTM}</code>
        <CopyButton text={RECOMMENDED_UTM} label="Copiar UTMs" />
      </section>

      <section className="panel panel-pad space-y-3">
        <h2>2. Pixel do painel na página de vendas</h2>
        <p className="sub">
          Cole na &lt;head&gt; da página de vendas ou presell. Ele <b>carrega o pixel da Meta</b> e manda PageView, ViewContent e InitiateCheckout pelo
          navegador e pelo servidor (API de Conversões), sem contar duas vezes. Também guarda as UTMs, o fbclid e os cookies do pixel e passa tudo para o
          checkout (Hotmart → sck, Digistore24 → custom, Stripe → client_reference_id, outros → vid, sck e as UTMs). O Purchase vai pelo servidor quando o
          checkout aprova a venda.
        </p>
        <code className="codebox">{script}</code>
        <CopyButton text={script} label="Copiar código" />
        {main.length ? (
          <p className="notice notice-warn text-sm">
            <b>Tire o código antigo do pixel da Meta</b> dessa página (e do plugin/construtor de página). Senão o PageView do navegador conta em dobro.
            Pixel usado: {main[0].name} ({main[0].pixel_id}) — outros pixels em <Link className="underline" href="/integracoes">Integrações</Link>.
          </p>
        ) : (
          <p className="notice notice-warn text-sm">
            Cadastre o pixel (ID + token da API de Conversões) em <Link className="underline" href="/integracoes">Integrações → Pixel</Link> para o script já sair com ele.
            Sem pixel, o script só rastreia as UTMs e você mantém o pixel da Meta no site.
          </p>
        )}
        <details>
          <summary className="sub underline">Opções</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-muted">
            <li><code>data-pixel=&quot;ID1,ID2&quot;</code> — mais de um pixel.</li>
            <li><code>data-value=&quot;197&quot; data-currency=&quot;BRL&quot; data-content-name=&quot;Curso X&quot;</code> — valor da oferta nos eventos.</li>
            <li><code>data-events=&quot;PageView&quot;</code> — eventos ao abrir a página (padrão: PageView,ViewContent). Use só PageView na presell.</li>
            <li><code>painelTrack(&quot;Lead&quot;)</code> — dispara outro evento, por exemplo no envio de um formulário.</li>
          </ul>
        </details>
        <p className="text-sm">
          Já reconhece Hotmart, Kiwify, Perfect Pay, Eduzz, Cakto, Ticto, Lastlink, Payt, Greenn, Braip, Yampi, Monetizze, Digistore24 e Stripe.
          Checkout em outro domínio? Informe no script:
        </p>
        <code className="codebox">{scriptDomains}</code>
        <CopyButton text={scriptDomains} label="Copiar" />
        <p className="text-xs text-muted">Ou coloque o atributo <code>data-checkout</code> no link do botão de compra.</p>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2>3. Checkout devolvendo as UTMs</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
          <li><b>Hotmart, Digistore24, Stripe:</b> automático com o script acima.</li>
          <li><b>Kiwify, Perfect Pay, Eduzz, Yampi e outros:</b> eles repassam as UTMs da URL do checkout para o webhook. Use o webhook universal em Integrações.</li>
          <li>Venda sem UTM com ID aparece como “sem rastreio” em Campanhas.</li>
        </ul>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2>Gerador de link com UTM</h2>
        <p className="sub">Para bio, stories, e-mail, WhatsApp ou influenciador. As vendas aparecem no Resumo agrupadas pela origem.</p>
        <UtmBuilder />
      </section>
    </div>
  );
}
