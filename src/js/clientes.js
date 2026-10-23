// Aba "Clientes": contatos que viraram "Fechado", com a ficha de cliente (o que contratou, situação, datas,
// valores, atendimentos e próxima ação). A ficha nasce no banco quando o contato fecha (gatilho) e é a mesma
// pessoa da lista de contatos: nome, telefone e responsável vêm do contato.
// Valores ficam em clientes_financeiro e só chegam para quem tem ver_financeiro (o banco decide).
// Duas visões: Lista ou Kanban (colunas por situação). No topo, o painel de clientes (ativos, receita mensal,
// renovações e cancelamentos do mês), calculado aqui com as fichas que a pessoa enxerga.
// O app.js chama PPClientes.abrir(ctx) ao entrar na aba e PPClientes.render() a cada desenho.
window.PPClientes = (function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast;
  var SITUACOES = [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['cancelado', 'Cancelado']];
  var TAM = 1000;
  var cs = { fichas: [], fin: {}, modo: 'carregando', q: '', sit: 'abertos', resp: '', renova: false, num: '', editId: null, atendId: null,
    visao: 'lista', kbLimite: {}, kbFechadas: { cancelado: true }, arrastando: '', cancelarId: null };
  var POR_COLUNA = 50;
  var ctx = null, ligado = false;
  var reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var colator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

  // ---------- utilidades ----------
  function checar(r) { if (r.error) { r.error.status = r.status; throw r.error; } return r.data; }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function nomeSit(id) { for (var i = 0; i < SITUACOES.length; i++) if (SITUACOES[i][0] === id) return SITUACOES[i][1]; return id; }
  function nomeDe(p) { return (p.empresa || p.contato || 'Sem nome').trim(); }
  function fmtReais(v) { return v == null || v === '' ? '' : reais.format(Number(v)); }
  // aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234" e devolve número (ou null se vazio; NaN se inválido)
  function lerReais(t) {
    t = String(t || '').replace(/R\$|\s/g, '');
    if (!t) return null;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    var n = Number(t);
    return n < 1e10 ? Math.round(n * 100) / 100 : NaN;
  }
  function valorTexto(f) {
    if (!f || f.valor == null) return '';
    return fmtReais(f.valor) + (f.tipo_valor === 'contrato' ? ' (contrato)' : '/mês');
  }
  function podeEditar() { return ctx.pode('editar_clientes'); }
  function podeFin() { return ctx.pode('ver_financeiro'); }
  // preferências da tela, só neste navegador e por usuário
  function chaveLocal(k) { return 'pp-clientes-' + k + ':' + (ctx && ctx.usuario() ? ctx.usuario().id : ''); }
  function lerLocal(k) { try { return JSON.parse(localStorage.getItem(chaveLocal(k))); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(chaveLocal(k), JSON.stringify(v)); } catch (e) { /* navegador sem armazenamento */ } }
  function mesAtual() { return PP.hoje().slice(0, 7); }
  function ficha(id) { for (var i = 0; i < cs.fichas.length; i++) if (cs.fichas[i].id === id) return cs.fichas[i]; return null; }

  // ---------- banco ----------
  function paginado(tabela) {
    var todos = [];
    function pagina(i) {
      return sb.from(tabela).select('*').order(tabela === 'clientes' ? 'id' : 'cliente_id').range(i * TAM, i * TAM + TAM - 1).then(function (r) {
        var linhas = checar(r);
        todos = todos.concat(linhas);
        return linhas.length === TAM && i < 9 ? pagina(i + 1) : todos;
      });
    }
    return pagina(0);
  }
  function carregar() {
    cs.modo = 'carregando'; render();
    return Promise.all([paginado('clientes'), podeFin() ? paginado('clientes_financeiro') : Promise.resolve([])]).then(function (r) {
      cs.fichas = r[0]; cs.fin = {};
      r[1].forEach(function (f) { cs.fin[f.cliente_id] = f; });
      cs.modo = 'ok'; render();
    }).catch(function () { cs.modo = 'erro'; render(); });
  }

  // ---------- lista ----------
  // só aparecem as fichas de contatos que estão em "Fechado"; as outras ficam guardadas
  function comContato() {
    var out = [];
    cs.fichas.forEach(function (c) { var p = ctx.achar(c.prospect_id); if (p && p.status === 'cliente') out.push({ c: c, p: p }); });
    return out;
  }
  function diasAte(data) { return PP.parse(data) ? PP.difDias(PP.hoje(), data) : null; }
  function visiveis(todos) {
    var q = semAcento(cs.q.trim()), eu = ctx.usuario().id;
    return todos.filter(function (x) {
      var c = x.c, p = x.p;
      if (cs.num === 'ativos' && c.situacao !== 'ativo') return false;
      if (cs.num === 'renovam' && !(c.situacao !== 'cancelado' && String(c.renovacao || '').slice(0, 7) === mesAtual())) return false;
      if (cs.num === 'cancelados' && !(c.situacao === 'cancelado' && String(c.cancelado_em || '').slice(0, 7) === mesAtual())) return false;
      // no Kanban as colunas já separam a situação; na lista vale o filtro (o número clicado tem prioridade)
      if (!cs.num && cs.visao === 'lista') {
        if (cs.sit === 'abertos' && c.situacao === 'cancelado') return false;
        if (cs.sit !== 'abertos' && cs.sit !== 'todos' && c.situacao !== cs.sit) return false;
      }
      if (cs.resp && p.responsavel !== (cs.resp === 'eu' ? eu : cs.resp)) return false;
      if (cs.renova) { var d = diasAte(c.renovacao); if (d == null || d > 30 || c.situacao === 'cancelado') return false; }
      if (q && semAcento([p.empresa, p.contato, p.cidade, p.telefone, c.contratou, c.observacoes].join(' ')).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var da = PP.parse(a.c.proxima_acao) ? a.c.proxima_acao : '', db = PP.parse(b.c.proxima_acao) ? b.c.proxima_acao : '';
      if (da && db && da !== db) return da < db ? -1 : 1;
      if (da && !db) return -1;
      if (db && !da) return 1;
      return colator.compare(nomeDe(a.p), nomeDe(b.p));
    });
  }
  function celRenovacao(c) {
    var f = cs.fin[c.id], d = diasAte(c.renovacao), alerta = null;
    if (d != null && c.situacao !== 'cancelado') {
      if (d < 0) alerta = el('strong', { class: 'cl-venceu', text: d === -1 ? 'Venceu ontem' : 'Venceu há ' + (-d) + ' dias' });
      else if (d === 0) alerta = el('strong', { class: 'cl-renova', text: 'Renova hoje' });
      else if (d <= 30) alerta = el('strong', { class: 'cl-renova', text: d === 1 ? 'Renova amanhã' : 'Renova em ' + d + ' dias' });
    }
    return el('div', { class: 'c-local' },
      alerta,
      el('div', { class: 'sub', text: c.renovacao ? 'Renovação: ' + PP.dataCurta(c.renovacao) : 'Sem data de renovação' }),
      podeFin() && valorTexto(f) ? el('div', { class: 'sub cl-valor', text: valorTexto(f) }) : null);
  }
  function celProxima(c) {
    var d = diasAte(c.proxima_acao), rot, tipo;
    if (d == null) return el('div', { class: 'c-prox prox prox-sem' }, c.situacao === 'cancelado' ? '—' : 'Sem próxima ação');
    if (d < 0) { tipo = 'atrasado'; rot = d === -1 ? 'Atrasada 1 dia' : 'Atrasada ' + (-d) + ' dias'; }
    else if (d === 0) { tipo = 'hoje'; rot = 'Hoje'; }
    else { tipo = d <= 7 ? 'semana' : 'futuro'; rot = d === 1 ? 'Amanhã' : 'Em ' + d + ' dias'; }
    return el('div', { class: 'c-prox prox prox-' + tipo },
      el('strong', null, rot),
      el('span', { class: 'data', text: PP.dataCurta(c.proxima_acao) + (c.proxima_acao_nota ? ' · ' + c.proxima_acao_nota : '') }));
  }
  function linha(x) {
    var c = x.c, p = x.p, resp = ctx.nomes()[p.responsavel];
    var sub = [p.contato && p.empresa ? p.contato : '', c.contratou].filter(Boolean).join(' · ');
    return el('div', { class: 'linha', role: 'listitem' },
      el('div', { class: 'c-nome' },
        el('button', { class: 'nome', type: 'button', text: nomeDe(p), onclick: function () { abrirFicha(c.id); } }),
        sub ? el('div', { class: 'sub', text: sub }) : null,
        resp ? el('div', { class: 'sub', text: 'Responsável: ' + resp }) : null),
      celRenovacao(c),
      el('div', { class: 'c-status' }, el('span', { class: 'tag cl-' + c.situacao, text: nomeSit(c.situacao) })),
      celProxima(c),
      el('div', { class: 'c-acao' },
        podeEditar() ? el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Registrar atendimento', onclick: function () { abrirAtendimento(c.id); } }) : null));
  }
  function vazio(titulo, texto, botao, acao) {
    return el('div', { class: 'vazio' }, el('h2', { text: titulo }), el('p', { text: texto }),
      botao ? el('button', { class: 'btn btn-primary', type: 'button', text: botao, onclick: acao }) : null);
  }
  function limpar() { cs.q = ''; cs.sit = 'abertos'; cs.resp = ''; cs.renova = false; cs.num = ''; $('cl-q').value = ''; $('cl-sit').value = 'abertos'; $('cl-resp').value = ''; $('cl-renova').checked = false; render(); }
  function preencherResp() {
    var sel = $('cl-resp'), membros = ctx.membros(), eu = ctx.usuario().id;
    while (sel.options.length > 2) sel.remove(2);
    if (membros.length > 1) membros.forEach(function (m) { if (m.id !== eu) sel.append(el('option', { value: m.id, text: m.nome || m.email })); });
    sel.value = cs.resp;
    if (sel.value !== cs.resp) { cs.resp = ''; sel.value = ''; }
  }

  // ---------- painel de clientes ----------
  function renderPainel(todos) {
    var mes = mesAtual(), ativos = 0, renovam = 0, cancelados = 0, receita = 0, comMensal = 0, contratos = 0, nContratos = 0;
    todos.forEach(function (x) {
      var c = x.c, f = cs.fin[c.id];
      if (c.situacao === 'ativo') {
        ativos++;
        if (f && f.valor != null) {
          if (f.tipo_valor === 'contrato') { contratos += Number(f.valor); nContratos++; }
          else { receita += Number(f.valor); comMensal++; }
        }
      }
      if (c.situacao !== 'cancelado' && String(c.renovacao || '').slice(0, 7) === mes) renovam++;
      if (c.situacao === 'cancelado' && String(c.cancelado_em || '').slice(0, 7) === mes) cancelados++;
    });
    $('cl-painel').hidden = false;
    $('cl-painel-aviso').hidden = ctx.pode('ver_todos');
    $('cl-n-ativos').textContent = ativos;
    $('cl-n-renovam').textContent = renovam;
    $('cl-n-cancelados').textContent = cancelados;
    $('cl-receita-caixa').hidden = !podeFin();
    $('cl-contratos-caixa').hidden = !podeFin();
    $('cl-n-receita').textContent = fmtReais(receita);
    $('cl-n-receita-sub').textContent = comMensal === 1 ? '1 cliente ativo com valor por mês' : comMensal + ' clientes ativos com valor por mês';
    $('cl-n-contratos').textContent = fmtReais(contratos);
    $('cl-n-contratos-sub').textContent = nContratos === 1 ? '1 cliente ativo com valor do contrato' : nContratos + ' clientes ativos com valor do contrato';
    document.querySelectorAll('#cl-painel [data-num]').forEach(function (b) { b.setAttribute('aria-pressed', String(cs.num === b.dataset.num)); });
  }

  // ---------- kanban ----------
  function cartao(x, arrasta) {
    var c = x.c, p = x.p, f = cs.fin[c.id], resp = ctx.nomes()[p.responsavel], d = diasAte(c.renovacao), alerta = null;
    if (d != null && c.situacao !== 'cancelado' && d <= 30) {
      alerta = el('div', { class: d < 0 ? 'cl-venceu' : 'cl-renova', text: d < 0 ? (d === -1 ? 'Venceu ontem' : 'Venceu há ' + (-d) + ' dias') : d === 0 ? 'Renova hoje' : d === 1 ? 'Renova amanhã' : 'Renova em ' + d + ' dias' });
    }
    var menu = arrasta ? el('select', { class: 'kb-mover', 'aria-label': 'Mover ' + nomeDe(p) + ' para outra situação', onchange: function () { moverPara(c.id, this.value); } },
      el('option', { value: '', text: 'Mover para…' }),
      SITUACOES.filter(function (s) { return s[0] !== c.situacao; }).map(function (s) { return el('option', { value: s[0], text: s[1] }); })) : null;
    return el('div', { class: 'kb-card', role: 'listitem', draggable: arrasta ? 'true' : null, 'data-id': c.id },
      el('button', { class: 'nome', type: 'button', text: nomeDe(p), onclick: function () { abrirFicha(c.id); } }),
      c.contratou ? el('div', { class: 'sub', text: c.contratou }) : null,
      alerta,
      podeFin() && valorTexto(f) ? el('div', { class: 'sub cl-valor', text: valorTexto(f) }) : null,
      c.situacao === 'cancelado'
        ? (c.motivo_cancelamento ? el('div', { class: 'sub', text: 'Motivo: ' + c.motivo_cancelamento }) : null)
        : (PP.parse(c.proxima_acao) ? celProxima(c) : null),
      resp ? el('div', { class: 'kb-quem', text: resp }) : null,
      menu);
  }
  function renderKanban(vis) {
    var quadro = $('cl-kanban'), grupos = {}, arrasta = podeEditar();
    SITUACOES.forEach(function (s) { grupos[s[0]] = []; });
    vis.forEach(function (x) { (grupos[x.c.situacao] || grupos.ativo).push(x); });
    SITUACOES.forEach(function (s) {
      var id = s[0], itens = grupos[id], fechada = !!cs.kbFechadas[id], lim = cs.kbLimite[id] || POR_COLUNA, corpo = null, mais = null;
      var cab = el('button', { class: 'kb-cab', type: 'button', 'aria-expanded': String(!fechada),
        onclick: function () { cs.kbFechadas[id] = !fechada; gravarLocal('fechadas', cs.kbFechadas); render(); } },
        el('span', { class: 'kb-titulo', text: s[1] }),
        el('span', { class: 'kb-n', text: String(itens.length) }),
        el('span', { class: 'kb-seta', 'aria-hidden': 'true', text: fechada ? '+' : '−' }));
      if (!fechada) {
        corpo = itens.length
          ? el('div', { class: 'kb-corpo', role: 'list', 'aria-label': s[1] }, itens.slice(0, lim).map(function (x) { return cartao(x, arrasta); }))
          : el('p', { class: 'kb-vazio', text: arrasta ? 'Nenhum cliente. Arraste um cartão para cá.' : 'Nenhum cliente.' });
        if (itens.length > lim) mais = el('button', { class: 'linkbtn kb-mais', type: 'button', text: 'Ver mais (faltam ' + (itens.length - lim) + ')',
          onclick: function () { cs.kbLimite[id] = lim + POR_COLUNA; render(); } });
      }
      quadro.append(el('section', { class: 'kb-col cl-kb-' + id + (fechada ? ' kb-fechada' : ''), 'data-status': id, 'aria-label': s[1] + ': ' + itens.length }, cab, corpo, mais));
    });
  }
  // mudar a situação pelo Kanban; cancelar pede o motivo (o banco exige)
  function moverPara(id, sit) {
    var c = ficha(id);
    if (!c || !sit || c.situacao === sit || !podeEditar()) { render(); return; }
    if (sit === 'cancelado') { abrirCancelar(id); render(); return; }
    gravarSituacao(c, { situacao: sit, motivo_cancelamento: '' });
  }
  function gravarSituacao(c, dados) {
    var antes = { situacao: c.situacao, motivo_cancelamento: c.motivo_cancelamento, cancelado_em: c.cancelado_em };
    Object.assign(c, dados); render();
    return sb.from('clientes').update(dados).eq('id', c.id).select().single().then(function (r) {
      Object.assign(c, checar(r)); render(); toast('Movido para ' + nomeSit(c.situacao));
    }).catch(function (e) { Object.assign(c, antes); render(); toast(ctx.msgErro(e)); throw e; });
  }
  function abrirCancelar(id) {
    var c = ficha(id), p = c && ctx.achar(c.prospect_id);
    if (!c || !p) return;
    cs.cancelarId = id;
    $('can-titulo').textContent = nomeDe(p);
    $('can-motivo').value = '';
    $('can-erro').hidden = true;
    $('dlg-cancelar').showModal();
    $('can-motivo').focus();
  }
  function confirmarCancelar(ev) {
    ev.preventDefault();
    var c = ficha(cs.cancelarId), motivo = $('can-motivo').value.trim(), err = $('can-erro'), btn = $('can-salvar');
    if (!c) return;
    if (!motivo) { err.textContent = 'Escreva o motivo do cancelamento.'; err.hidden = false; $('can-motivo').focus(); return; }
    btn.disabled = true;
    gravarSituacao(c, { situacao: 'cancelado', motivo_cancelamento: motivo }).then(function () { $('dlg-cancelar').close(); })
      .catch(function (e) { err.textContent = ctx.msgErro(e); err.hidden = false; })
      .then(function () { btn.disabled = false; });
  }
  function trocarVisao(v) { cs.visao = v; gravarLocal('visao', v); render(); }

  function render() {
    if (!ctx) return;
    preencherResp();
    var lista = $('cl-lista'), quadro = $('cl-kanban'), kb = cs.visao === 'kanban';
    lista.replaceChildren(); lista.removeAttribute('role');
    quadro.replaceChildren(); quadro.hidden = true;
    $('cl-modo-lista').setAttribute('aria-pressed', String(!kb));
    $('cl-modo-kanban').setAttribute('aria-pressed', String(kb));
    $('cl-sit-campo').hidden = kb;
    $('cl-painel').hidden = true; $('cl-painel-aviso').hidden = true;
    $('cl-csv').hidden = !(cs.modo === 'ok' && ctx.pode('exportar') && ctx.exportacaoLiberada() && comContato().length);
    $('cl-limpar').hidden = true;
    $('cl-dica').hidden = ctx.pode('ver_todos');
    $('cl-head').hidden = kb;
    if (cs.modo === 'carregando' || !ctx.pronto()) { $('cl-contagem').textContent = 'Carregando os clientes…'; return; }
    if (cs.modo === 'erro') {
      $('cl-contagem').textContent = '';
      lista.append(vazio('Não deu para carregar', 'Confira sua conexão e tente de novo.', 'Tentar de novo', carregar));
      return;
    }
    var todos = comContato();
    if (!todos.length) {
      $('cl-contagem').textContent = 'Nenhum cliente ainda';
      $('cl-head').hidden = true;
      lista.append(vazio('Nenhum cliente ainda', 'Quando um contato for para "Fechado", ele aparece aqui com a ficha de cliente: o que contratou, renovação, atendimentos e próxima ação.', '', null));
      return;
    }
    renderPainel(todos);
    var vis = visiveis(todos), filtrando = cs.q.trim() || (!kb && cs.sit !== 'abertos') || cs.resp || cs.renova || cs.num;
    $('cl-contagem').textContent = (filtrando ? 'Mostrando ' + vis.length + ' de ' + todos.length : String(todos.length)) + (todos.length === 1 ? ' cliente' : ' clientes');
    $('cl-limpar').hidden = !filtrando;
    if (!vis.length) { $('cl-head').hidden = true; lista.append(vazio('Nenhum cliente neste filtro', 'Mude a busca ou limpe os filtros.', 'Limpar filtros', limpar)); return; }
    if (kb) { $('cl-head').hidden = true; quadro.hidden = false; renderKanban(vis); return; }
    lista.setAttribute('role', 'list');
    vis.forEach(function (x) { lista.append(linha(x)); });
  }

  // ---------- ficha ----------
  function mostrarMotivo() { $('cl-motivo-campo').hidden = $('cl-situacao').value !== 'cancelado'; }
  function desenharAtendimentos(c) {
    var alvo = $('cl-atend-lista'), lista = Array.isArray(c.atendimentos) ? c.atendimentos : [];
    alvo.replaceChildren();
    alvo.hidden = !lista.length; $('cl-atend-vazio').hidden = !!lista.length;
    lista.forEach(function (a) {
      alvo.append(el('li', null,
        el('div', { class: 'meta' }, el('b', { text: PP.dataCurta(a.data) }), [a.canal, a.por].filter(Boolean).map(function (t) { return ' · ' + t; }).join('')),
        a.nota ? el('p', { text: a.nota }) : null));
    });
  }
  function abrirFicha(id) {
    var c = ficha(id), p = c && ctx.achar(c.prospect_id), f = cs.fin[id] || {};
    if (!c || !p) return;
    var leitura = !podeEditar();
    cs.editId = id;
    $('cl-titulo').textContent = nomeDe(p);
    $('cl-sub').textContent = [p.contato && p.empresa ? p.contato : '', p.telefone, ctx.nomes()[p.responsavel] ? 'Responsável: ' + ctx.nomes()[p.responsavel] : ''].filter(Boolean).join(' · ');
    $('cl-contratou').value = c.contratou || '';
    $('cl-situacao').value = c.situacao;
    $('cl-motivo').value = c.motivo_cancelamento || '';
    $('cl-desde').value = p.clienteDesde || '';
    $('cl-desde').max = PP.hoje();
    $('cl-inicio').value = c.inicio || '';
    $('cl-renovacao').value = c.renovacao || '';
    $('cl-proxima').value = c.proxima_acao || '';
    $('cl-proxima-nota').value = c.proxima_acao_nota || '';
    $('cl-obs').value = c.observacoes || '';
    $('cl-fin').hidden = !podeFin();
    $('cl-valor').value = f.valor != null ? fmtReais(f.valor) : '';
    $('cl-tipo').value = f.tipo_valor || 'mensal';
    $('cl-cobranca').value = f.forma_cobranca || '';
    mostrarMotivo();
    $('form-cliente').querySelectorAll('.dlg-body input, .dlg-body select, .dlg-body textarea').forEach(function (n) { n.disabled = leitura; });
    $('cl-salvar').hidden = leitura;
    $('cl-registrar').hidden = leitura;
    $('cl-leitura').hidden = !leitura;
    $('cl-erro').hidden = true;
    desenharAtendimentos(c);
    $('dlg-cliente').showModal();
  }
  function salvarFicha(ev) {
    ev.preventDefault();
    var c = ficha(cs.editId), p = c && ctx.achar(c.prospect_id), err = $('cl-erro'), btn = $('cl-salvar');
    if (!c || !p) return;
    err.hidden = true;
    var sit = $('cl-situacao').value, motivo = $('cl-motivo').value.trim(), desde = $('cl-desde').value;
    function falha(msg, campo) { err.textContent = msg; err.hidden = false; if (campo) $(campo).focus(); }
    if (sit === 'cancelado' && !motivo) return falha('Escreva o motivo do cancelamento.', 'cl-motivo');
    if (desde && (!PP.parse(desde) || desde > PP.hoje())) return falha('A data "Cliente desde" não pode ser no futuro.', 'cl-desde');
    var valor = podeFin() ? lerReais($('cl-valor').value) : null;
    if (podeFin() && Number.isNaN(valor)) return falha('Valor inválido. Use o formato 1.234,56.', 'cl-valor');
    var dados = {
      contratou: $('cl-contratou').value.trim(), situacao: sit, motivo_cancelamento: sit === 'cancelado' ? motivo : '',
      inicio: $('cl-inicio').value || null, renovacao: $('cl-renovacao').value || null,
      proxima_acao: $('cl-proxima').value || null, proxima_acao_nota: $('cl-proxima-nota').value.trim(),
      observacoes: $('cl-obs').value.trim()
    };
    btn.disabled = true;
    var ops = [sb.from('clientes').update(dados).eq('id', c.id).select().single().then(function (r) { Object.assign(c, checar(r)); })];
    if (podeFin()) {
      ops.push(sb.from('clientes_financeiro').update({ valor: valor, tipo_valor: $('cl-tipo').value, forma_cobranca: $('cl-cobranca').value.trim() })
        .eq('cliente_id', c.id).select().single().then(function (r) { cs.fin[c.id] = checar(r); }));
    }
    if (desde && desde !== p.clienteDesde) {
      ops.push(sb.rpc('cliente_desde_alterar', { p_prospect: p.id, p_data: desde }).then(function (r) { checar(r); p.clienteDesde = desde; }));
    }
    Promise.all(ops).then(function () { $('dlg-cliente').close(); toast('Ficha de cliente salva'); render(); })
      .catch(function (e) { falha(ctx.msgErro(e)); })
      .then(function () { btn.disabled = false; });
  }

  // ---------- atendimento ----------
  function abrirAtendimento(id) {
    var c = ficha(id), p = c && ctx.achar(c.prospect_id);
    if (!c || !p || !podeEditar()) return;
    cs.atendId = id;
    $('at-titulo').textContent = nomeDe(p);
    $('at-data').value = PP.hoje(); $('at-data').max = PP.hoje();
    document.querySelectorAll('input[name="at-canal"]').forEach(function (r) { r.checked = false; });
    $('at-nota').value = '';
    $('at-proxima').value = c.proxima_acao && c.proxima_acao >= PP.hoje() ? c.proxima_acao : '';
    $('at-proxima-nota').value = c.proxima_acao && c.proxima_acao >= PP.hoje() ? c.proxima_acao_nota || '' : '';
    $('at-erro').hidden = true;
    $('dlg-atend').showModal();
    $('at-nota').focus();
  }
  function salvarAtendimento(ev) {
    ev.preventDefault();
    var c = ficha(cs.atendId), err = $('at-erro'), btn = $('at-salvar');
    if (!c) return;
    var data = $('at-data').value, nota = $('at-nota').value.trim(), canal = document.querySelector('input[name="at-canal"]:checked');
    err.hidden = true;
    if (!PP.parse(data) || data > PP.hoje()) { err.textContent = 'Informe a data do atendimento (hoje ou antes).'; err.hidden = false; return; }
    if (!nota) { err.textContent = 'Conte o que foi feito.'; err.hidden = false; $('at-nota').focus(); return; }
    var u = ctx.usuario(), item = { data: data, canal: canal ? canal.value : '', nota: nota, por: u.nome || u.email || '' };
    var antigos = (Array.isArray(c.atendimentos) ? c.atendimentos : []).map(function (a) { return { data: a.data || '', canal: a.canal || '', nota: a.nota || '', por: a.por || '' }; });
    var lista = [item].concat(antigos).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); }).slice(0, 200);
    btn.disabled = true;
    sb.from('clientes').update({ atendimentos: lista, proxima_acao: $('at-proxima').value || null, proxima_acao_nota: $('at-proxima-nota').value.trim() })
      .eq('id', c.id).select().single().then(function (r) {
        Object.assign(c, checar(r));
        $('dlg-atend').close(); toast('Atendimento registrado'); render();
        if ($('dlg-cliente').open && cs.editId === c.id) {
          desenharAtendimentos(c);
          $('cl-proxima').value = c.proxima_acao || ''; $('cl-proxima-nota').value = c.proxima_acao_nota || '';
        }
      }).catch(function (e) { err.textContent = ctx.msgErro(e); err.hidden = false; })
      .then(function () { btn.disabled = false; });
  }

  // ---------- planilha de clientes (mesma trava de exportação dos contatos) ----------
  function csv() {
    var cols = [['Empresa', 'empresa'], ['Pessoa de contato', 'contato'], ['Telefone', 'telefone'], ['E-mail', 'email'], ['Cidade', 'cidade'], ['UF', 'uf'],
      ['CNPJ', 'cnpj'], ['Responsável', 'responsavel'], ['Cliente desde', 'cliente_desde'], ['O que contratou', 'contratou'], ['Situação', 'situacao'],
      ['Motivo do cancelamento', 'motivo_cancelamento'], ['Cancelado em', 'cancelado_em'], ['Início', 'inicio'], ['Renovação ou fim', 'renovacao'], ['Valor', 'valor'], ['Tipo de valor', 'tipo_valor'],
      ['Forma de cobrança', 'forma_cobranca'], ['Próxima ação', 'proxima_acao'], ['O que fazer', 'proxima_acao_nota'], ['Observações', 'observacoes'], ['Atendimentos', 'atendimentos']];
    function cel(v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var btn = $('cl-csv'); btn.disabled = true;
    sb.rpc('exportar_clientes').then(function (r) {
      var dados = checar(r) || [], linhas = [cols.map(function (c) { return cel(c[0]); }).join(';')];
      dados.forEach(function (x) {
        linhas.push(cols.map(function (c) {
          var v = x[c[1]];
          if (c[1] === 'situacao') v = nomeSit(v);
          else if (c[1] === 'tipo_valor') v = x.valor == null ? '' : v === 'contrato' ? 'Contrato inteiro' : 'Mensal';
          else if (c[1] === 'valor') v = v == null ? '' : Number(v).toFixed(2).replace('.', ',');
          else if (c[1] === 'atendimentos') v = (Array.isArray(v) ? v : []).map(function (a) { return [a.data, a.canal, a.nota].filter(Boolean).join(' - '); }).join(' | ');
          return cel(v);
        }).join(';'));
      });
      var url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      var a = el('a', { href: url, download: 'clientes-' + PP.hoje() + '.csv' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Planilha baixada: ' + dados.length + (dados.length === 1 ? ' cliente' : ' clientes'));
    }).catch(function (e) {
      if (e && e.message === 'exportacao_bloqueada') { toast('A exportação não está liberada para a empresa. Fale com a PHAR Consultoria.'); ctx.exportacaoBloqueada(); render(); }
      else toast('Não deu para baixar a planilha agora');
    }).then(function () { btn.disabled = false; });
  }

  // ---------- ligações (uma vez) ----------
  function ligar() {
    if (ligado) return;
    ligado = true;
    $('cl-q').addEventListener('input', function () { cs.q = this.value; render(); });
    $('cl-sit').addEventListener('change', function () { cs.sit = this.value; render(); });
    $('cl-resp').addEventListener('change', function () { cs.resp = this.value; render(); });
    $('cl-renova').addEventListener('change', function () { cs.renova = this.checked; render(); });
    $('cl-limpar').addEventListener('click', limpar);
    $('cl-csv').addEventListener('click', csv);
    $('cl-situacao').addEventListener('change', mostrarMotivo);
    $('cl-valor').addEventListener('blur', function () { var v = lerReais(this.value); if (v != null && !Number.isNaN(v)) this.value = fmtReais(v); });
    $('form-cliente').addEventListener('submit', salvarFicha);
    $('cl-registrar').addEventListener('click', function () { abrirAtendimento(cs.editId); });
    $('cl-abrir-contato').addEventListener('click', function () {
      var c = ficha(cs.editId); if (!c) return;
      $('dlg-cliente').close(); ctx.abrirContato(c.prospect_id);
    });
    $('form-atend').addEventListener('submit', salvarAtendimento);
    $('form-cancelar').addEventListener('submit', confirmarCancelar);
    $('cl-modo-lista').addEventListener('click', function () { trocarVisao('lista'); });
    $('cl-modo-kanban').addEventListener('click', function () { trocarVisao('kanban'); });
    document.querySelectorAll('#cl-painel [data-num]').forEach(function (b) {
      b.addEventListener('click', function () { cs.num = cs.num === b.dataset.num ? '' : b.dataset.num; render(); });
    });
    // arrastar e soltar no Kanban (computador); no celular, o menu "Mover para…" do cartão
    var quadro = $('cl-kanban');
    function limparArraste() { quadro.querySelectorAll('.kb-arrastando,.kb-alvo').forEach(function (n) { n.classList.remove('kb-arrastando', 'kb-alvo'); }); }
    quadro.addEventListener('dragstart', function (ev) {
      var c = ev.target.closest && ev.target.closest('.kb-card[draggable]'); if (!c) return;
      cs.arrastando = c.dataset.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', c.dataset.id);
      c.classList.add('kb-arrastando');
    });
    quadro.addEventListener('dragend', function () { cs.arrastando = ''; limparArraste(); });
    quadro.addEventListener('dragover', function (ev) {
      var col = cs.arrastando && ev.target.closest && ev.target.closest('.kb-col'); if (!col) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
      if (!col.classList.contains('kb-alvo')) { limparArraste(); quadro.querySelector('[data-id="' + cs.arrastando + '"]').classList.add('kb-arrastando'); col.classList.add('kb-alvo'); }
    });
    quadro.addEventListener('drop', function (ev) {
      var col = cs.arrastando && ev.target.closest && ev.target.closest('.kb-col'); if (!col) return;
      ev.preventDefault();
      var id = cs.arrastando; cs.arrastando = ''; limparArraste(); moverPara(id, col.dataset.status);
    });
  }

  function abrir(c) {
    var primeira = !ctx;
    ctx = c; ligar(); preencherResp();
    if (primeira) {
      cs.visao = lerLocal('visao') === 'kanban' ? 'kanban' : 'lista';
      var f = lerLocal('fechadas'); if (f && typeof f === 'object') cs.kbFechadas = f;
    }
    return carregar();
  }
  // a exclusão de contatos pergunta se há ficha de cliente guardada
  function temFicha(prospectId) { return cs.fichas.some(function (c) { return c.prospect_id === prospectId; }); }
  function esquecer(ids) {
    var fora = {}; ids.forEach(function (id) { fora[id] = true; });
    cs.fichas = cs.fichas.filter(function (c) { return !fora[c.prospect_id]; });
  }

  return { abrir: abrir, render: render, temFicha: temFicha, esquecer: esquecer, lerReais: lerReais };
})();
