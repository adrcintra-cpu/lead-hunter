/* Oxyhub · sistema aberto dentro do Hub (hub.oxyhub.com.br/s/…).
   - marca a página com a classe "oxyhub-embed" (o CSS esconde a barra própria do sistema);
   - links para outros endereços (Hub, outros sistemas, sites externos) saem do quadro;
   - avisa o Hub do título e da página atual, para a aba e o endereço acompanharem. */
(function () {
  var HUB = "https://hub.oxyhub.com.br";
  // Sistemas com rotas em "#/…" (OxyProposal) usam data-route="hash" no <script>.
  var script = document.currentScript;
  var hashRoutes = !!(script && script.getAttribute("data-route") === "hash");
  var inFrame = false;
  try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  if (!inFrame) return;
  document.documentElement.classList.add("oxyhub-embed");
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target) return;
    try {
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin && /^https?:$/.test(u.protocol)) a.target = "_top";
    } catch (err) { /* ignora */ }
  }, true);
  var last = "";
  function send() {
    var path = hashRoutes ? (location.hash.replace(/^#/, "") || "/") : location.pathname + location.search;
    var key = document.title + "|" + path;
    if (key === last) return;
    last = key;
    try { window.parent.postMessage({ type: "oxyhub:page", title: document.title, path: path }, HUB); } catch (err) { /* ignora */ }
  }
  setInterval(send, 700);
  window.addEventListener("hashchange", send);
  window.addEventListener("popstate", send);
  send();
})();
