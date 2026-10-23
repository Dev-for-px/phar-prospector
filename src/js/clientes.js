// Aba "Clientes": contatos que viraram "Fechado", com a ficha de cliente (o que contratou, situação, datas,
// valores, atendimentos e próxima ação). A ficha nasce no banco quando o contato fecha (gatilho) e é a mesma
// pessoa da lista de contatos: nome, telefone e responsável vêm do contato.
// Valores ficam em clientes_financeiro e só chegam para quem tem ver_financeiro (o banco decide).
// O app.js chama PPClientes.abrir(ctx) ao entrar na aba e PPClientes.render() a cada desenho.
window.PPClientes = (function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast;
  var SITUACOES = [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['cancelado', 'Cancelado']];
  var TAM = 1000;
  var cs = { fichas: [], fin: {}, modo: 'carregando', q: '', sit: 'abertos', resp: '', renova: false, editId: null, atendId: null };
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
      if (cs.sit === 'abertos' && c.situacao === 'cancelado') return false;
      if (cs.sit !== 'abertos' && cs.sit !== 'todos' && c.situacao !== cs.sit) return false;
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
  function limpar() { cs.q = ''; cs.sit = 'abertos'; cs.resp = ''; cs.renova = false; $('cl-q').value = ''; $('cl-sit').value = 'abertos'; $('cl-resp').value = ''; $('cl-renova').checked = false; render(); }
  function preencherResp() {
    var sel = $('cl-resp'), membros = ctx.membros(), eu = ctx.usuario().id;
    while (sel.options.length > 2) sel.remove(2);
    if (membros.length > 1) membros.forEach(function (m) { if (m.id !== eu) sel.append(el('option', { value: m.id, text: m.nome || m.email })); });
    sel.value = cs.resp;
    if (sel.value !== cs.resp) { cs.resp = ''; sel.value = ''; }
  }

  function render() {
    if (!ctx) return;
    preencherResp();
    var lista = $('cl-lista');
    lista.replaceChildren(); lista.removeAttribute('role');
    $('cl-csv').hidden = !(cs.modo === 'ok' && ctx.pode('exportar') && ctx.exportacaoLiberada() && comContato().length);
    $('cl-limpar').hidden = true;
    $('cl-dica').hidden = ctx.pode('ver_todos');
    $('cl-head').hidden = false;
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
    var vis = visiveis(todos), filtrando = cs.q.trim() || cs.sit !== 'abertos' || cs.resp || cs.renova;
    $('cl-contagem').textContent = (filtrando ? 'Mostrando ' + vis.length + ' de ' + todos.length : String(todos.length)) + (todos.length === 1 ? ' cliente' : ' clientes');
    $('cl-limpar').hidden = !filtrando;
    if (!vis.length) { $('cl-head').hidden = true; lista.append(vazio('Nenhum cliente neste filtro', 'Mude a busca ou limpe os filtros.', 'Limpar filtros', limpar)); return; }
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
      ['Motivo do cancelamento', 'motivo_cancelamento'], ['Início', 'inicio'], ['Renovação ou fim', 'renovacao'], ['Valor', 'valor'], ['Tipo de valor', 'tipo_valor'],
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
  }

  function abrir(c) {
    ctx = c; ligar(); preencherResp();
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
