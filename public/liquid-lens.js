/*!
 * Oxyhub Liquid Glass v2 — refração de lente nas bordas do vidro.
 * Gera, no navegador, um mapa de deslocamento do tamanho e do arredondamento de cada peça
 * e aplica como filtro do fundo (backdrop-filter: url(#…)), com leve separação de cores na borda.
 * Só roda em navegadores Chromium (Chrome, Edge) no computador/Android; nos demais, o vidro fica
 * com bisel e brilho só em CSS. Respeita "reduzir transparência".
 * Configuração: <script src="/liquid-lens.js" data-selector=".glass, .glass-btn" defer></script>
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__oxyLens) return;
  window.__oxyLens = true;

  var ua = navigator.userAgent || '';
  var chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/CriOS|EdgiOS|FxiOS|Firefox\//.test(ua);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (!chromium || reduce) return;

  var me = document.currentScript;
  var SELECTOR = (me && me.getAttribute('data-selector')) || '.glass, .glass-strong, .glass-btn, .glass-tint';
  var EXTRA = (me && me.getAttribute('data-backdrop')) || 'saturate(160%) brightness(1.05)';
  // data-only-light: em sistemas com tema escuro (classe .dark no <html>), a refração só vale no tema claro
  var ONLY_LIGHT = !!(me && me.hasAttribute('data-only-light'));
  var root = document.documentElement;
  function darkOn() { return ONLY_LIGHT && root.classList.contains('dark'); }
  var NS = 'http://www.w3.org/2000/svg';
  var MAX_SIDE = 2400; // peças maiores ficam só com o bisel em CSS
  var cache = {};
  var defs = null;
  var seq = 0;

  function ensureDefs() {
    if (defs && defs.isConnected) return defs;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);
    return defs;
  }

  // Distância (positiva dentro) até a borda de um retângulo arredondado.
  function sdf(x, y, w, h, r) {
    var qx = Math.abs(x - w / 2) - (w / 2 - r);
    var qy = Math.abs(y - h / 2) - (h / 2 - r);
    return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
  }

  // Mapa em resolução reduzida (o filtro estica): R/G = direção para dentro × intensidade.
  function makeMap(w, h, r, bevel) {
    var k = Math.min(1, 320 / Math.max(w, h));
    var mw = Math.max(8, Math.round(w * k));
    var mh = Math.max(8, Math.round(h * k));
    var c = document.createElement('canvas');
    c.width = mw;
    c.height = mh;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(mw, mh);
    var d = img.data;
    for (var j = 0; j < mh; j++) {
      for (var i = 0; i < mw; i++) {
        var X = (i + 0.5) / k, Y = (j + 0.5) / k;
        var o = (j * mw + i) * 4;
        var dist = sdf(X, Y, w, h, r);
        var R = 128, G = 128;
        if (dist > 0 && dist < bevel) {
          var gx = sdf(X + 1, Y, w, h, r) - sdf(X - 1, Y, w, h, r);
          var gy = sdf(X, Y + 1, w, h, r) - sdf(X, Y - 1, w, h, r);
          var n = Math.hypot(gx, gy) || 1;
          var t = 1 - dist / bevel;
          var s = Math.min(1, (1 - Math.sqrt(Math.max(0, 1 - t * t))) * 1.15); // perfil de lente
          R = Math.round(128 + (gx / n) * s * 127);
          G = Math.round(128 + (gy / n) * s * 127);
        }
        d[o] = R; d[o + 1] = G; d[o + 2] = 128; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    return e;
  }

  function filterFor(w, h, r) {
    var bevel = Math.max(10, Math.min(70, Math.min(w, h) * 0.36));
    var scale = Math.round(bevel * 1.9);
    var key = w + 'x' + h + 'r' + r;
    if (cache[key]) return cache[key];
    var id = 'oxy-lens-' + (++seq);
    var f = el('filter', { id: id, x: '0', y: '0', width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    f.appendChild(el('feImage', { href: makeMap(w, h, r, bevel), x: '0', y: '0', width: w, height: h, preserveAspectRatio: 'none', result: 'map' }));
    f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0.35', result: 'soft' }));
    var ch = [['dr', 'r', 1, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['dg', 'g', 0.93, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['db', 'b', 0.86, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0']];
    ch.forEach(function (c) {
      f.appendChild(el('feDisplacementMap', { in: 'soft', in2: 'map', scale: String(Math.round(scale * c[2])), xChannelSelector: 'R', yChannelSelector: 'G', result: c[0] }));
      f.appendChild(el('feColorMatrix', { in: c[0], type: 'matrix', values: c[3], result: c[1] }));
    });
    f.appendChild(el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
    f.appendChild(el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
    ensureDefs().appendChild(f);
    cache[key] = id;
    return id;
  }

  function clear(node) {
    if (!node.__oxyLensKey) return;
    node.__oxyLensKey = null;
    node.style.removeProperty('backdrop-filter');
    node.style.removeProperty('-webkit-backdrop-filter');
  }

  function apply(node) {
    if (darkOn()) { clear(node); return; }
    var w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight);
    if (w < 24 || h < 24 || w > MAX_SIDE || h > MAX_SIDE) { clear(node); return; }
    var rr = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
    var r = Math.min(rr, w / 2, h / 2);
    var tag = w + 'x' + h + 'r' + Math.round(r);
    if (node.__oxyLensKey === tag) return;
    node.__oxyLensKey = tag;
    var id = filterFor(w, h, Math.round(r));
    node.style.setProperty('backdrop-filter', 'url(#' + id + ') ' + EXTRA, 'important');
    node.style.setProperty('-webkit-backdrop-filter', 'url(#' + id + ') ' + EXTRA, 'important');
  }

  var ro = new ResizeObserver(function (entries) {
    entries.forEach(function (e) { apply(e.target); });
  });
  var seen = new WeakSet();
  var tracked = [];
  function scan() {
    var list;
    try { list = document.querySelectorAll(SELECTOR); } catch (_) { return; }
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!seen.has(n)) { seen.add(n); tracked.push(n); ro.observe(n); }
    }
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; scan(); });
  }
  function start() {
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    if (ONLY_LIGHT) {
      new MutationObserver(function () {
        tracked = tracked.filter(function (n) { return n.isConnected; });
        tracked.forEach(function (n) { n.__oxyLensKey = null; apply(n); });
      }).observe(root, { attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
