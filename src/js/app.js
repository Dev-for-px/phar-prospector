// O sistema: lista de contatos, ficha, registro de conversas e retornos programados.
// Só abre para quem tem login e conta ativa. Cada conta enxerga apenas os próprios contatos.
(function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast;
  var parse = PP.parse, hoje = PP.hoje, somaDias = PP.somaDias, difDias = PP.difDias;
  var dataCurta = PP.dataCurta, dataLonga = PP.dataLonga;

  var STATUS = [
    { id: 'novo',        nome: 'A contatar',             retorno: 7,    ativo: true },
    { id: 'contatado',   nome: 'Contato feito',          retorno: 7,    ativo: true },
    { id: 'conversa',    nome: 'Em conversa',            retorno: 7,    ativo: true },
    { id: 'diagnostico', nome: 'Reunião ou diagnóstico', retorno: 7,    ativo: true },
    { id: 'proposta',    nome: 'Proposta enviada',       retorno: 7,    ativo: true },
    { id: 'depois',      nome: 'Não é o momento',        retorno: 90,   ativo: true },
    { id: 'cliente',     nome: 'Fechado',                retorno: null, ativo: false },
    { id: 'perdido',     nome: 'Sem interesse',          retorno: null, ativo: false }
  ];
  var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  var CAMPOS_TEXTO = ['empresa', 'contato', 'cargo', 'telefone', 'email', 'cidade', 'uf', 'segmento', 'porte', 'origem', 'link', 'interesse'];

  var st = { items: [], modo: 'carregando', filtro: 'todos', q: '', status: '', ordem: 'proximo', editId: null, logId: null, intTocado: false };
  var colator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

  // ---------- utilidades ----------
  function statusDe(id) { for (var i = 0; i < STATUS.length; i++) if (STATUS[i].id === id) return STATUS[i]; return STATUS[0]; }
  function ativo(p) { return statusDe(p.status).ativo; }
  function nomeDe(p) { return (p.empresa || p.contato || 'Sem nome').trim(); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function achar(id) { for (var i = 0; i < st.items.length; i++) if (st.items[i].id === id) return st.items[i]; return null; }
  function linkWhats(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return (d.length === 12 || d.length === 13) ? 'https://wa.me/' + d : '';
  }
  function linkSite(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (s.charAt(0) === '@') return 'https://instagram.com/' + encodeURIComponent(s.slice(1));
    if (/^https?:\/\//i.test(s)) return s;
    return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? 'https://' + s : '';
  }
  function classe(p, hj) {
    if (!parse(p.proximoContato)) return { tipo: 'sem', dias: null };
    var n = difDias(hj, p.proximoContato);
    if (n < 0) return { tipo: 'atrasado', dias: n };
    if (n === 0) return { tipo: 'hoje', dias: 0 };
    if (n <= 7) return { tipo: 'semana', dias: n };
    return { tipo: 'futuro', dias: n };
  }
  function msgErro(e) {
    var c = e && e.code, s = e && e.status;
    if (c === '42501') return 'Sua conta não está ativa para gravar. Saia e entre de novo; se continuar, fale com a PHAR.';
    if (c === 'P0001') return 'Você chegou ao limite de contatos desta conta. Exclua contatos antigos para salvar novos.';
    if (c === '23514') return 'Algum campo passou do tamanho permitido. Encurte o texto e tente de novo.';
    if (s === 401 || c === 'PGRST301') return 'Sua sessão expirou. Entre de novo.';
    return 'Não deu para salvar agora. Confira sua conexão e tente de novo.';
  }

  // ---------- banco: conversão e chamadas ----------
  function paraApp(r) {
    var p = { id: r.id, status: r.status, proximoContato: r.proximo_contato || '', ultimoContato: r.ultimo_contato || '',
      observacoes: r.observacoes || '', historico: Array.isArray(r.historico) ? r.historico : [], criadoEm: r.criado_em || '' };
    CAMPOS_TEXTO.forEach(function (k) { p[k] = r[k] || ''; });
    return p;
  }
  function checar(r) { if (r.error) { r.error.status = r.status; throw r.error; } return r.data; }
  function carregar() {
    var todos = [], TAM = 1000;
    function pagina(i) {
      return sb.from('prospects').select('*').order('criado_em', { ascending: false }).order('id')
        .range(i * TAM, i * TAM + TAM - 1).then(function (r) {
          var linhas = checar(r);
          todos = todos.concat(linhas);
          if (linhas.length === TAM && i < 5) return pagina(i + 1);
          return todos.map(paraApp);
        });
    }
    return pagina(0);
  }
  function guardar(linha) {
    var p = paraApp(linha), i;
    for (i = 0; i < st.items.length; i++) if (st.items[i].id === p.id) { st.items[i] = p; render(); return; }
    st.items.unshift(p); render();
  }

  // ---------- lista ----------
  function visiveis(hj) {
    var q = semAcento(st.q.trim()), qd = q.replace(/\D/g, '');
    var out = st.items.filter(function (p) {
      var k = classe(p, hj).tipo;
      if (st.filtro === 'atrasados' && k !== 'atrasado') return false;
      if (st.filtro === 'hoje' && k !== 'hoje') return false;
      if (st.filtro === 'semana' && k !== 'semana') return false;
      if (st.filtro === 'sem' && !(k === 'sem' && ativo(p))) return false;
      if (st.status && p.status !== st.status) return false;
      if (q) {
        var alvo = semAcento([p.empresa, p.contato, p.cidade, p.uf, p.segmento, p.telefone, p.email, p.interesse, p.observacoes].join(' '));
        var tel = String(p.telefone || '').replace(/\D/g, '');
        if (alvo.indexOf(q) === -1 && !(qd.length >= 3 && tel.indexOf(qd) !== -1)) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (st.ordem === 'nome') return colator.compare(nomeDe(a), nomeDe(b));
      if (st.ordem === 'recentes') return String(b.criadoEm).localeCompare(String(a.criadoEm));
      var da = parse(a.proximoContato) ? a.proximoContato : '', db = parse(b.proximoContato) ? b.proximoContato : '';
      if (da && db) return da < db ? -1 : da > db ? 1 : colator.compare(nomeDe(a), nomeDe(b));
      if (da) return -1;
      if (db) return 1;
      if (ativo(a) !== ativo(b)) return ativo(a) ? -1 : 1;
      return colator.compare(nomeDe(a), nomeDe(b));
    });
    return out;
  }

  function celProximo(p, hj) {
    var k = classe(p, hj), d = k.dias, rot;
    if (k.tipo === 'sem') return el('div', { class: 'c-prox prox prox-sem' }, ativo(p) ? 'Sem data' : '—');
    if (k.tipo === 'atrasado') rot = d === -1 ? 'Atrasado 1 dia' : 'Atrasado ' + (-d) + ' dias';
    else if (k.tipo === 'hoje') rot = 'Hoje';
    else if (d === 1) rot = 'Amanhã';
    else rot = 'Em ' + d + ' dias';
    return el('div', { class: 'c-prox prox prox-' + k.tipo },
      el('strong', null, k.tipo === 'hoje' ? el('span', { class: 'ponto', 'aria-hidden': 'true' }) : null, rot),
      el('span', { class: 'data', text: dataCurta(p.proximoContato) }));
  }

  function linha(p, hj) {
    var s = statusDe(p.status);
    var pessoa = [p.contato && p.empresa ? p.contato : '', p.cargo].filter(Boolean).join(' · ');
    var local = [[p.cidade, p.uf].filter(Boolean).join('/'), p.segmento].filter(Boolean).join(' · ');
    var wa = linkWhats(p.telefone);
    var telNode = p.telefone
      ? el('div', { class: 'sub' }, p.telefone, wa ? ' · ' : null, wa ? el('a', { href: wa, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp' }) : null)
      : (p.email ? el('div', { class: 'sub', text: p.email }) : null);
    return el('div', { class: 'linha', role: 'listitem' },
      el('div', { class: 'c-nome' },
        el('button', { class: 'nome', type: 'button', text: nomeDe(p), onclick: function () { abrirFicha(p.id); } }),
        pessoa ? el('div', { class: 'sub', text: pessoa }) : null),
      el('div', { class: 'c-local' }, local ? el('div', { class: 'sub', text: local }) : null, telNode),
      el('div', { class: 'c-status' }, el('span', { class: 'tag s-' + s.id, text: s.nome })),
      celProximo(p, hj),
      el('div', { class: 'c-acao' },
        el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Registrar contato', onclick: function () { abrirLog(p.id); } })));
  }

  function vazio(titulo, texto, botao, acao) {
    return el('div', { class: 'vazio' },
      el('h2', { text: titulo }), el('p', { text: texto }),
      botao ? el('button', { class: 'btn btn-primary', type: 'button', text: botao, onclick: acao }) : null);
  }

  function render() {
    var hj = hoje(), lista = $('lista'), n = { atrasados: 0, hoje: 0, semana: 0, sem: 0 };
    st.items.forEach(function (p) {
      var k = classe(p, hj).tipo;
      if (k === 'atrasado') n.atrasados++; else if (k === 'hoje') n.hoje++; else if (k === 'semana') n.semana++;
      else if (k === 'sem' && ativo(p)) n.sem++;
    });
    var pronto = st.modo === 'ok';
    ['atrasados', 'hoje', 'semana', 'sem'].forEach(function (k) { $('n-' + k).textContent = pronto ? n[k] : '–'; });
    document.querySelectorAll('.stat').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filtro === st.filtro)); });
    $('btn-csv').hidden = !(pronto && st.items.length);

    lista.replaceChildren();
    lista.removeAttribute('role');
    $('btn-limpar').hidden = true;
    if (st.modo === 'carregando') { $('contagem').textContent = 'Carregando seus contatos…'; return; }
    if (st.modo === 'erro') {
      $('contagem').textContent = '';
      lista.append(vazio('Não deu para carregar', 'Confira sua conexão e tente de novo.', 'Tentar de novo', iniciarLista));
      return;
    }
    if (!st.items.length) {
      $('contagem').textContent = 'Nenhum contato cadastrado';
      lista.append(vazio('Comece pelo primeiro contato', 'Anote quem você abordou, o status e quando voltar a falar. No dia marcado, o contato aparece no topo desta página.', 'Novo contato', function () { abrirFicha(null); }));
      return;
    }
    var vis = visiveis(hj), filtrando = st.filtro !== 'todos' || st.status || st.q.trim();
    $('contagem').textContent = filtrando
      ? 'Mostrando ' + vis.length + ' de ' + st.items.length + (st.items.length === 1 ? ' contato' : ' contatos')
      : (st.items.length === 1 ? '1 contato' : st.items.length + ' contatos');
    $('btn-limpar').hidden = !filtrando;
    if (!vis.length) { lista.append(vazio('Nenhum contato neste filtro', 'Mude a busca ou limpe os filtros para ver a lista inteira.', 'Limpar filtros', limpar)); return; }
    lista.setAttribute('role', 'list');
    vis.forEach(function (p) { lista.append(linha(p, hj)); });
  }
  function limpar() { st.filtro = 'todos'; st.status = ''; st.q = ''; $('q').value = ''; $('filtro-status').value = ''; render(); }

  // ---------- ficha ----------
  function resumoFicha() {
    var v = $('f-proximo').value;
    $('f-resumo').textContent = parse(v) ? 'Retorno em ' + dataLonga(v) + '.' : 'Sem data de retorno. Este contato não entra nos lembretes.';
  }
  function abrirFicha(id) {
    var p = id ? achar(id) : null;
    if (id && !p) return;
    st.editId = id;
    $('ficha-titulo').textContent = p ? nomeDe(p) : 'Novo contato';
    CAMPOS_TEXTO.forEach(function (k) { $('f-' + k).value = p ? p[k] || '' : ''; });
    $('f-status').value = p ? statusDe(p.status).id : 'novo';
    $('f-proximo').value = p && parse(p.proximoContato) ? p.proximoContato : '';
    $('f-obs').value = p ? p.observacoes || '' : '';
    resumoFicha();
    $('ficha-erro').hidden = true;
    $('ficha-excluir').hidden = !p;
    $('ficha-confirma').hidden = true;
    $('ficha-registrar').hidden = !p;
    $('ficha-salvar').disabled = false;

    var rap = $('ficha-rapido'); rap.replaceChildren();
    if (p) {
      var wa = linkWhats(p.telefone), site = linkSite(p.link);
      if (wa) rap.append(el('a', { href: wa, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir WhatsApp' }));
      if (site) rap.append(el('a', { href: site, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir site ou Instagram' }));
      if (p.ultimoContato) rap.append(el('span', { text: 'Último contato: ' + dataCurta(p.ultimoContato) }));
    }
    rap.hidden = !rap.childNodes.length;

    var hist = p ? p.historico : [], ul = $('ficha-hist'); ul.replaceChildren();
    hist.forEach(function (h) {
      ul.append(el('li', null,
        el('div', { class: 'meta' }, el('b', { text: dataCurta(h.data) || 'Sem data' }),
          h.canal ? ' · ' + h.canal : '', h.status ? ' · ' + statusDe(h.status).nome : ''),
        h.nota ? el('div', { class: 'nota', text: h.nota }) : null));
    });
    $('ficha-hist-secao').hidden = !hist.length;
    $('dlg-ficha').showModal();
  }

  function salvarFicha(ev) {
    ev.preventDefault();
    var err = $('ficha-erro'), d = {}, prox = $('f-proximo').value;
    CAMPOS_TEXTO.forEach(function (k) { d[k] = $('f-' + k).value.trim(); });
    if (!d.empresa && !d.contato) { err.textContent = 'Preencha a empresa ou a pessoa de contato.'; err.hidden = false; $('f-empresa').focus(); return; }
    d.status = $('f-status').value;
    d.proximo_contato = parse(prox) ? prox : null;
    d.observacoes = $('f-obs').value.trim();
    var id = st.editId, btn = $('ficha-salvar');
    var op = id ? sb.from('prospects').update(d).eq('id', id).select().single()
                : sb.from('prospects').insert(d).select().single();
    btn.disabled = true; err.hidden = true;
    op.then(function (r) { guardar(checar(r)); $('dlg-ficha').close(); toast(id ? 'Contato atualizado' : 'Contato salvo'); })
      .catch(function (e) { err.textContent = msgErro(e); err.hidden = false; })
      .then(function () { btn.disabled = false; });
  }

  function excluir() {
    var id = st.editId; if (!id) return;
    var b = $('ficha-excluir-sim'); b.disabled = true;
    sb.from('prospects').delete().eq('id', id).then(function (r) {
      checar(r);
      st.items = st.items.filter(function (p) { return p.id !== id; });
      render(); $('dlg-ficha').close(); toast('Contato excluído');
    }).catch(function (e) { var err = $('ficha-erro'); err.textContent = msgErro(e); err.hidden = false; })
      .then(function () { b.disabled = false; });
  }

  // ---------- registrar contato ----------
  function intervaloSel() { var r = document.querySelector('input[name="l-int"]:checked'); return r ? r.value : 'nenhum'; }
  function proximoDoLog() {
    var v = intervaloSel();
    if (v === 'nenhum') return '';
    if (v === 'data') return parse($('l-proximo').value) ? $('l-proximo').value : '';
    return somaDias(parse($('l-data').value) ? $('l-data').value : hoje(), Number(v));
  }
  function resumoLog() {
    var v = intervaloSel(), prox = proximoDoLog();
    $('l-proximo').hidden = v !== 'data';
    $('l-resumo').textContent = prox ? 'Retorno em ' + dataLonga(prox) + '.'
      : v === 'data' ? 'Escolha a data do próximo contato.' : 'Sem retorno marcado. Este contato sai dos lembretes.';
  }
  function sugerirIntervalo() {
    var r = statusDe($('l-status').value).retorno;
    $(r == null ? 'l-int-nenhum' : 'l-int-' + r).checked = true;
    resumoLog();
  }
  function abrirLog(id) {
    var p = achar(id); if (!p) return;
    st.logId = id; st.intTocado = false;
    $('log-titulo').textContent = nomeDe(p);
    $('l-data').value = hoje();
    $('l-status').value = p.status === 'novo' ? 'contatado' : statusDe(p.status).id;
    document.querySelectorAll('input[name="l-canal"]').forEach(function (r) { r.checked = false; });
    $('l-nota').value = '';
    $('l-proximo').value = '';
    $('log-erro').hidden = true;
    $('log-salvar').disabled = false;
    sugerirIntervalo();
    $('dlg-log').showModal();
  }
  function salvarLog(ev) {
    ev.preventDefault();
    var p = achar(st.logId), err = $('log-erro'); if (!p) return;
    var data = parse($('l-data').value) ? $('l-data').value : hoje();
    if (intervaloSel() === 'data' && !proximoDoLog()) { err.textContent = 'Escolha a data do próximo contato.'; err.hidden = false; $('l-proximo').focus(); return; }
    var canal = document.querySelector('input[name="l-canal"]:checked');
    var entrada = { data: data, canal: canal ? canal.value : '', nota: $('l-nota').value.trim(), status: $('l-status').value };
    var antigo = p.historico.map(function (h) { return { data: h.data || '', canal: h.canal || '', nota: h.nota || '', status: h.status || '' }; });
    var hist = [entrada].concat(antigo).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); }).slice(0, 200);
    var prox = proximoDoLog();
    var d = { status: entrada.status, ultimo_contato: hist[0].data || null, proximo_contato: prox || null, historico: hist };
    var btn = $('log-salvar'); btn.disabled = true; err.hidden = true;
    sb.from('prospects').update(d).eq('id', p.id).select().single().then(function (r) {
      guardar(checar(r)); $('dlg-log').close();
      toast(prox ? 'Registrado. Retorno em ' + dataCurta(prox) : 'Registrado, sem retorno marcado');
    }).catch(function (e) { err.textContent = msgErro(e); err.hidden = false; })
      .then(function () { btn.disabled = false; });
  }

  // ---------- planilha ----------
  function csv() {
    var cols = [['Empresa', 'empresa'], ['Contato', 'contato'], ['Cargo', 'cargo'], ['Telefone', 'telefone'], ['E-mail', 'email'], ['Cidade', 'cidade'], ['UF', 'uf'],
      ['Segmento', 'segmento'], ['Porte', 'porte'], ['Origem', 'origem'], ['Site ou Instagram', 'link'], ['Interesse', 'interesse'], ['Status', 'status'],
      ['Último contato', 'ultimoContato'], ['Próximo contato', 'proximoContato'], ['Observações', 'observacoes'], ['Histórico', 'historico']];
    function cel(v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;   // evita que a planilha trate o texto como fórmula
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var linhas = [cols.map(function (c) { return cel(c[0]); }).join(';')];
    st.items.forEach(function (p) {
      linhas.push(cols.map(function (c) {
        var v = p[c[1]];
        if (c[1] === 'status') v = statusDe(v).nome;
        else if (c[1] === 'historico') v = v.map(function (h) { return [h.data, h.canal, h.nota].filter(Boolean).join(' - '); }).join(' | ');
        return cel(v);
      }).join(';'));
    });
    var url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    var a = el('a', { href: url, download: 'prospeccao-' + hoje() + '.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('Planilha baixada');
  }

  // ---------- telas de acesso ----------
  function tela(qual) {
    $('tela-carregando').hidden = qual !== 'carregando';
    $('tela-estado').hidden = qual !== 'estado';
    $('tela-app').hidden = qual !== 'app';
  }
  function estado(titulo, texto, podeAtualizar) {
    $('estado-titulo').textContent = titulo; $('estado-texto').textContent = texto;
    $('estado-atualizar').hidden = !podeAtualizar; tela('estado');
  }
  function iniciarLista() {
    st.modo = 'carregando'; render();
    carregar().then(function (itens) { st.items = itens; st.modo = 'ok'; render(); })
      .catch(function (e) {
        if (e && (e.status === 401 || e.code === 'PGRST301')) { PP.irPara('/entrar'); return; }
        st.modo = 'erro'; render();
      });
  }
  function entrar() {
    PP.sessao().then(function (s) {
      if (!s) { PP.irPara('/entrar'); return null; }
      return PP.perfil().then(function (perfil) {
        var status = perfil ? perfil.status : 'pendente';
        var primeiro = perfil && perfil.nome ? perfil.nome.split(' ')[0] : '';
        if (status === 'bloqueada') { estado('Conta bloqueada', 'O acesso desta conta está suspenso. Fale com a PHAR Consultoria para reativar.', false); return; }
        if (status !== 'ativa') {
          estado('Conta aguardando liberação', (primeiro ? primeiro + ', recebemos' : 'Recebemos') + ' seu cadastro. Assim que a conta for liberada, você entra direto no sistema por esta página.', true);
          return;
        }
        $('topo-nome').textContent = perfil.nome || s.user.email || '';
        $('link-admin').hidden = !perfil.is_admin;
        tela('app'); iniciarLista();
      });
    }).catch(function () {
      estado('Não deu para carregar', 'Confira sua conexão e tente de novo.', true);
    });
  }

  // ---------- ligações ----------
  STATUS.forEach(function (s) {
    $('filtro-status').append(el('option', { value: s.id, text: s.nome }));
    $('f-status').append(el('option', { value: s.id, text: s.nome }));
    $('l-status').append(el('option', { value: s.id, text: s.nome }));
  });
  UFS.forEach(function (u) { $('f-uf').append(el('option', { value: u, text: u })); });

  $('btn-novo').addEventListener('click', function () { if (st.modo === 'ok') abrirFicha(null); else toast('Aguarde: os contatos ainda estão carregando'); });
  document.querySelectorAll('.stat').forEach(function (b) {
    b.addEventListener('click', function () { st.filtro = st.filtro === b.dataset.filtro ? 'todos' : b.dataset.filtro; render(); });
  });
  $('q').addEventListener('input', function () { st.q = this.value; render(); });
  $('filtro-status').addEventListener('change', function () { st.status = this.value; render(); });
  $('ordem').addEventListener('change', function () { st.ordem = this.value; render(); });
  $('btn-limpar').addEventListener('click', limpar);
  $('btn-csv').addEventListener('click', csv);
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  document.querySelectorAll('[data-sair]').forEach(function (b) { b.addEventListener('click', PP.sair); });
  $('estado-atualizar').addEventListener('click', function () { tela('carregando'); entrar(); });

  $('form-ficha').addEventListener('submit', salvarFicha);
  $('f-proximo').addEventListener('input', resumoFicha);
  $('f-atalhos').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-dias]'); if (!b) return;
    $('f-proximo').value = b.dataset.dias === '' ? '' : somaDias(hoje(), Number(b.dataset.dias));
    resumoFicha();
  });
  $('ficha-registrar').addEventListener('click', function () { var id = st.editId; $('dlg-ficha').close(); abrirLog(id); });
  $('ficha-excluir').addEventListener('click', function () { $('ficha-excluir').hidden = true; $('ficha-confirma').hidden = false; $('ficha-excluir-nao').focus(); });
  $('ficha-excluir-nao').addEventListener('click', function () { $('ficha-confirma').hidden = true; $('ficha-excluir').hidden = false; });
  $('ficha-excluir-sim').addEventListener('click', excluir);

  $('form-log').addEventListener('submit', salvarLog);
  $('l-status').addEventListener('change', function () { if (!st.intTocado) sugerirIntervalo(); });
  document.querySelectorAll('input[name="l-int"]').forEach(function (r) { r.addEventListener('change', function () { st.intTocado = true; resumoLog(); }); });
  $('l-data').addEventListener('input', resumoLog);
  $('l-proximo').addEventListener('input', resumoLog);

  sb.auth.onAuthStateChange(function (evento) { if (evento === 'SIGNED_OUT') PP.irPara('/entrar'); });
  entrar();
})();
