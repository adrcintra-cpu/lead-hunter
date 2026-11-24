/* Oxyhub · sistema aberto dentro do Hub (hub.oxyhub.com.br/s/…).
   - marca a página com a classe "oxyhub-embed" (o CSS esconde a barra própria do sistema);
   - links para outros endereços (Hub, outros sistemas, sites externos) saem do quadro;
   - avisa o Hub do título e da página atual, para a aba e o endereço acompanharem;
   - menu do sistema no menu do Hub (como na Vercel): manda os itens marcados com
     data-oxyhub-nav / data-oxyhub-section / data-oxyhub-item; o Hub mostra e, quando alguém
     clica, pede para abrir o item aqui. Só depois que o Hub confirma, o menu próprio some
     (classe "oxyhub-nav-hub"). */
(function () {
  var HUB = "https://hub.oxyhub.com.br";
  // Sistemas com rotas em "#/…" (OxyProposal) usam data-route="hash" no <script>.
  var script = document.currentScript;
  var hashRoutes = !!(script && script.getAttribute("data-route") === "hash");
  var inFrame = false;
  try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  if (!inFrame) return;
  var root = document.documentElement;
  root.classList.add("oxyhub-embed");
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target) return;
    try {
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin && /^https?:$/.test(u.protocol)) a.target = "_top";
    } catch (err) { /* ignora */ }
  }, true);

  function post(msg) {
    try { window.parent.postMessage(msg, HUB); } catch (err) { /* ignora */ }
  }

  function navItems() {
    var box = document.querySelector("[data-oxyhub-nav]");
    if (!box) return [];
    var els = box.querySelectorAll("[data-oxyhub-item]");
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var sec = el.closest("[data-oxyhub-section]");
      var svg = el.querySelector("svg");
      var badge = el.querySelector("[data-oxyhub-badge], .oxy-nav-badge, .nav-count");
      var cls = typeof el.className === "string" ? el.className : "";
      out.push({
        s: sec ? sec.getAttribute("data-oxyhub-section") || "" : "",
        l: el.getAttribute("data-oxyhub-item") || "",
        i: svg ? svg.outerHTML.slice(0, 4000) : "",
        b: badge ? (badge.textContent || "").trim().slice(0, 6) : "",
        a: el.getAttribute("aria-current") === "page" || el.getAttribute("data-active") === "true" || /(^|\s)(active|is-active)(\s|$)/.test(cls),
        x: el.tagName === "A" && (function () { try { return new URL(el.href, location.href).origin !== location.origin; } catch (err) { return false; } })(),
      });
    }
    return out;
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== HUB || e.source !== window.parent) return;
    var d = e.data || {};
    if (d.type === "oxyhub:nav-ack") root.classList.add("oxyhub-nav-hub");
    if (d.type === "oxyhub:go" && typeof d.index === "number") {
      var box = document.querySelector("[data-oxyhub-nav]");
      var el = box && box.querySelectorAll("[data-oxyhub-item]")[d.index];
      if (el) el.click();
    }
  });

  var last = "";
  var lastNav = "";
  function send() {
    var path = hashRoutes ? (location.hash.replace(/^#/, "") || "/") : location.pathname + location.search;
    var key = document.title + "|" + path;
    if (key !== last) {
      last = key;
      post({ type: "oxyhub:page", title: document.title, path: path });
    }
    var items = navItems();
    var nav = JSON.stringify(items);
    if (nav !== lastNav) {
      lastNav = nav;
      post({ type: "oxyhub:nav", items: items });
    }
  }
  setInterval(send, 700);
  window.addEventListener("hashchange", send);
  window.addEventListener("popstate", send);
  document.addEventListener("click", function () { setTimeout(send, 60); });
  send();
})();
