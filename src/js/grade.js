// Grade de alcance da marca PHAR: malha de pontos com o ponto dourado (o cliente) no centro.
// Desenha em todo <svg data-grade>. data-cx e data-cy dizem em que coluna e linha fica o centro.
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', PASSO = 32, COLS = 11, LINS = 7;
  function c(svg, cls, x, y, r) {
    var n = document.createElementNS(NS, 'circle');
    n.setAttribute('class', cls); n.setAttribute('cx', x); n.setAttribute('cy', y); n.setAttribute('r', r);
    svg.appendChild(n);
  }
  document.querySelectorAll('svg[data-grade]').forEach(function (svg) {
    var col = Number(svg.getAttribute('data-cx') || 7), lin = Number(svg.getAttribute('data-cy') || 3);
    var cx = 16 + col * PASSO, cy = 16 + lin * PASSO, i, j, x, y, d;
    svg.setAttribute('viewBox', '0 0 ' + (COLS * PASSO) + ' ' + (LINS * PASSO));
    c(svg, 'g-anel', cx, cy, 48); c(svg, 'g-anel', cx, cy, 96);
    for (j = 0; j < LINS; j++) for (i = 0; i < COLS; i++) {
      x = 16 + i * PASSO; y = 16 + j * PASSO;
      if (x === cx && y === cy) continue;
      d = Math.hypot(x - cx, y - cy);
      if (d < 80) c(svg, 'g-perto', x, y, 2.5); else c(svg, 'g-ponto', x, y, 2);
    }
    c(svg, 'g-centro', cx, cy, 7);
  });
})();
