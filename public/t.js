/*!
 * Script de rastreamento do painel.
 * Cole na <head> da sua página de vendas/presell, DEPOIS do pixel da Meta:
 *   <script src="https://SEU-PAINEL/t.js" async></script>
 *
 * O que ele faz:
 * 1. Gera um ID de visitante (vid) e guarda por 90 dias.
 * 2. Registra no painel as UTMs, fbclid, _fbc e _fbp da visita.
 * 3. Adiciona o vid e as UTMs em todos os links de checkout da página:
 *    Hotmart (sck), Digistore24 (custom), Stripe (client_reference_id) e genérico (vid).
 *
 * 4. Com window.painelPixelId = "ID" (código gerado no painel) ou data-pixel="ID" (vários: "ID1,ID2"), também carrega o pixel da Meta — não precisa colar o
 *    código do pixel no site — e envia PageView, ViewContent e InitiateCheckout pelo navegador E pelo
 *    servidor (API de Conversões), com o mesmo event_id para a Meta deduplicar.
 *    O Purchase vai pelo servidor quando o checkout aprova a venda (webhook).
 *
 * Opcional:
 *   data-domains="meucheckout.com,pay.outro.com"  outros domínios de checkout
 *   data-events="PageView,ViewContent"            eventos ao abrir a página (padrão)
 *   data-value="197" data-currency="BRL" data-content-name="Curso X"  dados da oferta nos eventos
 *   window.painelTrack("Lead")                     dispara outro evento (navegador + servidor)
 */
(function () {
  try {
    var script = document.currentScript || document.querySelector('script[src*="/t.js"]');
    var endpoint = new URL(script.src).origin + "/api/track";
    var extra = (script.getAttribute("data-domains") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);

    var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var CHECKOUT_HOSTS = [
      "pay.hotmart.com", "checkout.hotmart.com", "go.hotmart.com", "digistore24.com", "buy.stripe.com", "checkout.stripe.com",
      "pay.kiwify.com.br", "checkout.perfectpay.com.br", "sun.eduzz.com", "chk.eduzz.com", "pay.cakto.com.br", "checkout.ticto.app",
      "pay.lastlink.com", "checkout.payt.com.br", "pay.greenn.com.br", "pay.braip.com", "seguro.yampi.com.br", "pay.monetizze.com.br"
    ].concat(extra);
    var DAYS = 90;

    function getCookie(n) {
      var m = document.cookie.match(new RegExp("(?:^|; )" + n.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    }
    function setCookie(n, v) {
      var host = location.hostname.split(".");
      var keep = /\.(com|net|org|gov|edu|co)\.[a-z]{2}$/.test(location.hostname) ? 3 : 2;
      var domain = host.length >= keep && !/^\d+$/.test(host[host.length - 1]) ? "." + host.slice(-keep).join(".") : location.hostname;
      document.cookie = n + "=" + encodeURIComponent(v) + ";path=/;max-age=" + DAYS * 86400 + ";domain=" + domain + ";SameSite=Lax";
    }
    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} setCookie(k, v); }
    function read(k) { var v = null; try { v = localStorage.getItem(k); } catch (e) {} return v || getCookie(k); }
    function uid() {
      var a = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }

    var params = new URLSearchParams(location.search);
    var vid = params.get("vid") || read("_pvid");
    if (!vid || !/^[a-zA-Z0-9_-]{8,64}$/.test(vid)) vid = uid();
    store("_pvid", vid);

    // Guarda as UTMs da última visita paga
    var utms = {};
    var hasNew = UTM_KEYS.some(function (k) { return params.get(k); });
    UTM_KEYS.forEach(function (k) {
      if (hasNew) { var v = params.get(k); if (v) store("_p" + k, v); else { try { localStorage.removeItem("_p" + k); } catch (e) {} } }
      var saved = read("_p" + k);
      if (saved) utms[k] = saved;
    });

    var fbclid = params.get("fbclid");
    if (fbclid && !getCookie("_fbc")) setCookie("_fbc", "fb.1." + Date.now() + "." + fbclid);

    // ------------------------------------------------------------ Pixel da Meta (data-pixel)
    var origin = new URL(script.src).origin;
    var rawPixels = script.getAttribute("data-pixel") || window.painelPixelId || "";
    var pixels = (Array.isArray(rawPixels) ? rawPixels.join(",") : String(rawPixels)).split(",").map(function (s) { return s.replace(/\D/g, ""); }).filter(Boolean);
    var offer = {};
    var dv = script.getAttribute("data-value");
    if (dv && !isNaN(Number(dv.replace(",", ".")))) offer.value = Number(dv.replace(",", "."));
    if (offer.value !== undefined) offer.currency = (script.getAttribute("data-currency") || "BRL").toUpperCase();
    if (script.getAttribute("data-content-name")) offer.content_name = script.getAttribute("data-content-name");

    function track(name, data) {
      if (!pixels.length) return;
      var custom = Object.assign({}, offer, data || {});
      var eventId = name + "." + vid + "." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try {
        for (var i = 0; i < pixels.length; i++) window.fbq("trackSingle", pixels[i], name, custom, { eventID: eventId });
      } catch (e) {}
      var body = JSON.stringify({
        vid: vid, pixels: pixels, event_name: name, event_id: eventId, custom_data: custom,
        url: location.href.slice(0, 1000), fbc: getCookie("_fbc"), fbp: getCookie("_fbp")
      });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon(origin + "/api/track/event", new Blob([body], { type: "application/json" }));
        else fetch(origin + "/api/track/event", { method: "POST", body: body, headers: { "Content-Type": "application/json" }, keepalive: true });
      } catch (e) {}
    }

    if (pixels.length) {
      // _fbp criado na hora (mesmo formato da Meta), para o servidor já ter o navegador identificado
      if (!getCookie("_fbp")) setCookie("_fbp", "fb.1." + Date.now() + "." + Math.floor(Math.random() * 1e10));
      if (!window.fbq) {
        var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!window._fbq) window._fbq = n;
        n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
        var fs = document.createElement("script");
        fs.async = true; fs.src = "https://connect.facebook.net/en_US/fbevents.js";
        (document.head || document.documentElement).appendChild(fs);
      }
      var already = [];
      try { already = (window.fbq.getState && window.fbq.getState().pixels || []).map(function (p) { return String(p.id); }); } catch (e) {}
      for (var pi = 0; pi < pixels.length; pi++) {
        if (already.indexOf(pixels[pi]) === -1) window.fbq("init", pixels[pi], { external_id: vid });
      }
      var initial = (script.getAttribute("data-events") || "PageView,ViewContent").split(",");
      for (var ei = 0; ei < initial.length; ei++) { var en = initial[ei].trim(); if (en) track(en); }
    }
    window.painelTrack = track;

    // InitiateCheckout uma vez por página, no clique do link/botão de checkout
    var icSent = false;
    function onCheckout() { if (!icSent) { icSent = true; track("InitiateCheckout"); } }
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("a[data-pv],[data-checkout]") : null;
      if (el) onCheckout();
    }, true);
    document.addEventListener("submit", function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute("data-pv")) onCheckout(); }, true);

    function send() {
      var body = JSON.stringify(Object.assign({
        vid: vid, fbclid: fbclid, fbc: getCookie("_fbc"), fbp: getCookie("_fbp"),
        url: location.href.slice(0, 1000), referrer: document.referrer.slice(0, 1000)
      }, hasNew ? utms : {}));
      if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      else fetch(endpoint, { method: "POST", body: body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
    // Espera o pixel criar o _fbp
    setTimeout(send, 1500);

    function isCheckout(url) {
      if (CHECKOUT_HOSTS.some(function (h) { return url.hostname === h || url.hostname.endsWith("." + h); })) return true;
      return false;
    }

    function decorate(href, force) {
      try {
        var url = new URL(href, location.href);
        if (!force && !isCheckout(url)) return null;
        var h = url.hostname;
        UTM_KEYS.forEach(function (k) { if (utms[k] && !url.searchParams.get(k)) url.searchParams.set(k, utms[k]); });
        if (h.indexOf("hotmart") > -1) {
          url.searchParams.set("sck", vid);
          if (utms.utm_source && !url.searchParams.get("src")) url.searchParams.set("src", utms.utm_source);
        } else if (h.indexOf("digistore24") > -1) {
          url.searchParams.set("custom", vid);
        } else if (h.indexOf("stripe.com") > -1) {
          url.searchParams.set("client_reference_id", vid);
        } else {
          url.searchParams.set("vid", vid);
          url.searchParams.set("sck", vid);
        }
        return url.toString();
      } catch (e) { return null; }
    }

    function run() {
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (a.getAttribute("data-pv") === vid) continue;
        var n = decorate(a.href, a.hasAttribute("data-checkout"));
        if (n) { a.href = n; a.setAttribute("data-pv", vid); }
      }
      var forms = document.querySelectorAll("form[action]");
      for (var j = 0; j < forms.length; j++) {
        var f = forms[j];
        if (f.getAttribute("data-pv") === vid) continue;
        var nf = decorate(f.action, f.hasAttribute("data-checkout"));
        if (nf) { f.action = nf; f.setAttribute("data-pv", vid); }
      }
    }

    window.painelVid = vid;
    window.painelCheckoutUrl = function (href) { onCheckout(); return decorate(href, true) || href; };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
    var tries = 0;
    var t = setInterval(function () { run(); if (++tries > 20) clearInterval(t); }, 1000);
    if (window.MutationObserver) new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
