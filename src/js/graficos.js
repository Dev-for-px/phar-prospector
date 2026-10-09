// Gráficos do painel, desenhados em SVG sem biblioteca externa.
// rosca(): parte de um todo, até 6 fatias. linha(): total acumulado ao longo do tempo.
// Textos sempre em cor de texto; a cor fica só na marca ao lado. Todo valor também está na legenda ou na tabela.
window.PP.graficos = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', el = window.PP.el;
  var fmtNum = new Intl.NumberFormat('pt-BR');
  var fmtDia = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
  var fmtDiaLongo = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  function s(tag, attrs) {
    var n = document.createElementNS(NS, tag), k;
    for (k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    for (var i = 2; i < arguments.length; i++) if (arguments[i] != null) n.append(arguments[i]);
    return n;
  }
  function dataDe(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function dia(iso) { return fmtDia.format(dataDe(iso)).replace(/\./g, '').replace(/ de /g, ' '); }
  function pct(v, total) { var p = v / total * 100; return (p > 0 && p < 1 ? '<1' : String(Math.round(p))) + '%'; }

  function dica(host) {
    var d = el('div', { class: 'g-dica', role: 'status', hidden: true });
    host.append(d);
    return {
      mostrar: function (valor, rotulo, x, y) {
        d.replaceChildren(el('strong', { text: valor }), el('span', { text: rotulo }));
        d.hidden = false;
        var largura = host.clientWidth, w = d.offsetWidth;
        d.style.left = Math.max(0, Math.min(largura - w, x - w / 2)) + 'px';
        d.style.top = Math.max(0, y - d.offsetHeight - 10) + 'px';
      },
      esconder: function () { d.hidden = true; }
    };
  }

  // ---------- rosca ----------
  // segs: [{ chave, rotulo, valor }]. A classe g-cor-<chave> define a cor no CSS.
  function rosca(host, segs, opts) {
    opts = opts || {};
    host.replaceChildren();
    host.classList.add('g-host');
    var total = segs.reduce(function (a, x) { return a + x.valor; }, 0);
    if (!total) { host.append(el('p', { class: 'dica', text: opts.vazio || 'Ainda não há dados para este gráfico.' })); return; }
    var R = 76, C = 2 * Math.PI * R, visiveis = segs.filter(function (x) { return x.valor > 0; });
    var folga = visiveis.length > 1 ? 2 : 0, acumulado = 0;
    var svg = s('svg', { class: 'g-rosca', viewBox: '0 0 200 200', role: 'img', 'aria-label': opts.titulo || 'Gráfico de rosca' });
    var grupo = s('g', { transform: 'rotate(-90 100 100)' });
    var caixa = el('div', { class: 'g-rosca-caixa' }), tip, marcas = {}, linhas = {};
    var legenda = el('ul', { class: 'g-legenda' });

    function destacar(chave, ligado) {
      if (marcas[chave]) marcas[chave].classList.toggle('ativa', ligado);
      if (linhas[chave]) linhas[chave].classList.toggle('ativa', ligado);
      svg.classList.toggle('com-foco', ligado);
    }
    visiveis.forEach(function (x) {
      var comp = x.valor / total * C;
      var arco = s('circle', {
        class: 'g-fatia g-cor-' + x.chave, cx: 100, cy: 100, r: R, fill: 'none', 'stroke-width': 30,
        'stroke-dasharray': Math.max(0.5, comp - folga) + ' ' + (C - Math.max(0.5, comp - folga)),
        'stroke-dashoffset': -acumulado, tabindex: 0,
        'aria-label': x.rotulo + ': ' + fmtNum.format(x.valor) + ' (' + pct(x.valor, total) + ')'
      });
      var meio = (acumulado + comp / 2) / C * 2 * Math.PI - Math.PI / 2;
      acumulado += comp;
      function entra() {
        destacar(x.chave, true);
        var lado = svg.getBoundingClientRect(), base = host.getBoundingClientRect(), k = lado.width / 200;
        tip.mostrar(fmtNum.format(x.valor) + ' · ' + pct(x.valor, total), x.rotulo,
          lado.left - base.left + (100 + Math.cos(meio) * R) * k, lado.top - base.top + (100 + Math.sin(meio) * R) * k);
      }
      function sai() { destacar(x.chave, false); tip.esconder(); }
      arco.addEventListener('pointerenter', entra); arco.addEventListener('pointerleave', sai);
      arco.addEventListener('focus', entra); arco.addEventListener('blur', sai);
      marcas[x.chave] = arco; grupo.append(arco);
    });
    svg.append(grupo,
      s('text', { class: 'g-total', x: 100, y: 102, 'text-anchor': 'middle' }, fmtNum.format(total)),
      s('text', { class: 'g-total-rotulo', x: 100, y: 122, 'text-anchor': 'middle' }, opts.unidade || 'contatos'));

    segs.forEach(function (x) {
      var li = el('li', { class: x.valor ? null : 'zerada' },
        el('span', { class: 'g-chave g-fundo-' + x.chave, 'aria-hidden': 'true' }),
        el('span', { class: 'g-rotulo', text: x.rotulo }),
        el('span', { class: 'g-valor', text: fmtNum.format(x.valor) }),
        el('span', { class: 'g-pct', text: x.valor ? pct(x.valor, total) : '–' }));
      li.addEventListener('pointerenter', function () { destacar(x.chave, true); });
      li.addEventListener('pointerleave', function () { destacar(x.chave, false); });
      linhas[x.chave] = li; legenda.append(li);
    });
    caixa.append(svg);
    host.append(el('div', { class: 'g-rosca-grade' }, caixa, legenda));
    tip = dica(host);
  }

  // ---------- linha (uma série, total acumulado) ----------
  // pontos: [{ x: 'AAAA-MM-DD', y: número }] em ordem de data.
  function linha(host, pontos, opts) {
    opts = opts || {};
    host.classList.add('g-host');
    if (host._obs) { host._obs.disconnect(); host._obs = null; }
    host.replaceChildren();
    if (!pontos.length || !pontos[pontos.length - 1].y) {
      host.append(el('p', { class: 'dica', text: opts.vazio || 'Ainda não há dados para este gráfico.' }));
      return;
    }
    var unidade = opts.unidade || 'contatos', palco = el('div', { class: 'g-palco' }), tip;
    var tabela = el('details', { class: 'g-tabela' }, el('summary', { text: 'Ver em tabela' }));
    var passo = Math.max(1, Math.ceil(pontos.length / 12)), corpo = el('tbody');
    pontos.forEach(function (p, i) {
      if (i % passo === 0 || i === pontos.length - 1) corpo.append(el('tr', null, el('td', { text: fmtDiaLongo.format(dataDe(p.x)) }), el('td', { text: fmtNum.format(p.y) })));
    });
    tabela.append(el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Data' }), el('th', { text: 'Total de ' + unidade }))), corpo));
    host.append(palco, tabela);
    tip = dica(host);

    function desenhar() {
      var W = Math.max(260, Math.round(palco.clientWidth)), H = 210;
      var ultimo = pontos[pontos.length - 1], rotFim = fmtNum.format(ultimo.y);
      var m = { e: 40, d: 18 + rotFim.length * 8, t: 14, b: 28 }, iw = W - m.e - m.d, ih = H - m.t - m.b;
      var maxY = Math.max.apply(null, pontos.map(function (p) { return p.y; }));
      var bruto = maxY / 3, pot = Math.pow(10, Math.floor(Math.log10(bruto || 1))), n = bruto / pot;
      var grau = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pot), topo = Math.ceil(maxY / grau) * grau;
      function px(i) { return m.e + (pontos.length === 1 ? iw : iw * i / (pontos.length - 1)); }
      function py(v) { return m.t + ih - ih * v / topo; }
      var svg = s('svg', { class: 'g-linha', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', tabindex: 0,
        'aria-label': (opts.titulo || 'Crescimento') + ': ' + rotFim + ' ' + unidade + ' em ' + fmtDiaLongo.format(dataDe(ultimo.x)) });
      for (var v = 0; v <= topo + 0.001; v += grau) {
        svg.append(s('line', { class: 'g-grade', x1: m.e, x2: m.e + iw, y1: py(v), y2: py(v) }),
          s('text', { class: 'g-eixo', x: m.e - 8, y: py(v) + 4, 'text-anchor': 'end' }, fmtNum.format(v)));
      }
      var d = pontos.map(function (p, i) { return (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(p.y).toFixed(1); }).join(' ');
      svg.append(s('path', { class: 'g-area', d: d + ' L' + px(pontos.length - 1).toFixed(1) + ' ' + py(0) + ' L' + px(0).toFixed(1) + ' ' + py(0) + ' Z' }),
        s('path', { class: 'g-traco', d: d, fill: 'none' }));
      var marcasX = pontos.length < 3 ? [0, pontos.length - 1] : [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1], vistos = {};
      marcasX.forEach(function (i, ordem) {
        if (vistos[i]) return; vistos[i] = 1;
        svg.append(s('text', { class: 'g-eixo', x: px(i), y: H - 8, 'text-anchor': ordem === 0 ? 'start' : ordem === marcasX.length - 1 ? 'end' : 'middle' }, dia(pontos[i].x)));
      });
      var guia = s('line', { class: 'g-guia', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
      var ponto = s('circle', { class: 'g-ponto', r: 5, visibility: 'hidden' });
      svg.append(guia,
        s('circle', { class: 'g-ponto', cx: px(pontos.length - 1), cy: py(ultimo.y), r: 5 }),
        s('text', { class: 'g-fim', x: px(pontos.length - 1) + 10, y: py(ultimo.y) + 5 }, rotFim), ponto);
      var atual = pontos.length - 1;
      function mostrar(i) {
        atual = Math.max(0, Math.min(pontos.length - 1, i));
        var p = pontos[atual], x = px(atual), y = py(p.y);
        guia.setAttribute('x1', x); guia.setAttribute('x2', x); guia.setAttribute('visibility', 'visible');
        ponto.setAttribute('cx', x); ponto.setAttribute('cy', y); ponto.setAttribute('visibility', 'visible');
        tip.mostrar(fmtNum.format(p.y) + ' ' + unidade, fmtDiaLongo.format(dataDe(p.x)), palco.offsetLeft + x, palco.offsetTop + y);
      }
      function esconder() { guia.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden'); tip.esconder(); }
      svg.addEventListener('pointermove', function (ev) {
        var r = svg.getBoundingClientRect(), x = ev.clientX - r.left;
        mostrar(pontos.length === 1 ? 0 : Math.round((x - m.e) / iw * (pontos.length - 1)));
      });
      svg.addEventListener('pointerleave', esconder);
      svg.addEventListener('blur', esconder);
      svg.addEventListener('focus', function () { mostrar(pontos.length - 1); });
      svg.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft') { mostrar(atual - 1); ev.preventDefault(); }
        if (ev.key === 'ArrowRight') { mostrar(atual + 1); ev.preventDefault(); }
      });
      palco.replaceChildren(svg);
    }
    desenhar();
    if (window.ResizeObserver) {
      var larguraAnterior = palco.clientWidth;
      host._obs = new ResizeObserver(function () {
        if (Math.abs(palco.clientWidth - larguraAnterior) > 4) { larguraAnterior = palco.clientWidth; desenhar(); }
      });
      host._obs.observe(palco);
    }
  }

  // Transforma contagens por dia em total acumulado, do início dos dados (ou até 90 dias atrás) até hoje.
  // porDia: { 'AAAA-MM-DD': quantos entraram nesse dia }
  function acumulado(porDia, hojeIso) {
    var PP = window.PP, dias = Object.keys(porDia).sort();
    if (!dias.length) return [];
    var inicio = PP.somaDias(hojeIso, -89), primeiro = PP.somaDias(dias[0], -1);
    if (primeiro > inicio) inicio = primeiro;
    if (PP.difDias(inicio, hojeIso) < 13) inicio = PP.somaDias(hojeIso, -13);
    var soma = 0, saida = [], d;
    dias.forEach(function (x) { if (x < inicio) soma += porDia[x]; });
    for (d = inicio; d <= hojeIso; d = PP.somaDias(d, 1)) { soma += porDia[d] || 0; saida.push({ x: d, y: soma }); }
    return saida;
  }

  // Agrupa os 8 status em 6 fatias, na ordem do funil.
  var FATIAS = [
    { chave: 'novo', rotulo: 'A contatar', status: ['novo'] },
    { chave: 'andamento', rotulo: 'Em andamento', status: ['contatado', 'conversa'] },
    { chave: 'proposta', rotulo: 'Reunião ou proposta', status: ['diagnostico', 'proposta'] },
    { chave: 'fechado', rotulo: 'Fechado', status: ['cliente'] },
    { chave: 'depois', rotulo: 'Não é o momento', status: ['depois'] },
    { chave: 'perdido', rotulo: 'Sem interesse', status: ['perdido'] }
  ];
  function fatiasDeStatus(contagem) {
    return FATIAS.map(function (f) {
      return { chave: f.chave, rotulo: f.rotulo, valor: f.status.reduce(function (a, st) { return a + (Number(contagem[st]) || 0); }, 0) };
    });
  }

  return { rosca: rosca, linha: linha, acumulado: acumulado, fatiasDeStatus: fatiasDeStatus };
})();
