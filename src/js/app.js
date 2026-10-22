// O sistema: painel com gráficos, lista de contatos, registro de conversas, equipe e cadastro da empresa.
// Só abre para quem tem login em uma empresa ativa. Todos os usuários da empresa veem a mesma lista.
(function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast, G = PP.graficos;
  var parse = PP.parse, hoje = PP.hoje, somaDias = PP.somaDias, difDias = PP.difDias;
  var dataCurta = PP.dataCurta, dataLonga = PP.dataLonga;

  var STATUS = [
    { id: 'novo',        nome: 'A contatar',             retorno: 7,    ativo: true },
    { id: 'contatado',   nome: 'Contato feito',          retorno: 7,    ativo: true },
    { id: 'conversa',    nome: 'Em conversa',            retorno: 7,    ativo: true },
    { id: 'diagnostico', nome: 'Reunião ou diagnóstico', curto: 'Reunião', retorno: 7, ativo: true },
    { id: 'proposta',    nome: 'Proposta enviada',       retorno: 7,    ativo: true },
    { id: 'depois',      nome: 'Não é o momento',        retorno: 90,   ativo: true },
    { id: 'cliente',     nome: 'Fechado',                retorno: null, ativo: false },
    { id: 'perdido',     nome: 'Sem interesse',          retorno: null, ativo: false }
  ];
  var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  var CAMPOS_TEXTO = ['empresa', 'contato', 'cargo', 'telefone', 'email', 'cidade', 'uf', 'segmento', 'porte', 'origem', 'link', 'interesse'];
  var VISOES = ['painel', 'contatos', 'buscar', 'equipe', 'empresa'];
  var CAMPOS_EMP = ['nome', 'razao_social', 'documento', 'segmento', 'telefone', 'email', 'site', 'instagram', 'descricao', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

  // permissões que o responsável marca para cada colaborador (as mesmas chaves do banco)
  var PERMS = [
    { grupo: 'O que pode ver', itens: [
      ['ver_painel', 'Painel com os gráficos'],
      ['ver_todos', 'Contatos de toda a equipe', 'Desmarcado: vê só os contatos que ela mesma cadastrou ou dos quais é responsável.'],
      ['ver_equipe', 'Quem faz parte da equipe'],
      ['ver_empresa', 'Dados da empresa (CNPJ, endereço)']] },
    { grupo: 'O que pode fazer', itens: [
      ['criar', 'Cadastrar contatos'],
      ['buscar_leads', 'Buscar leads na base da Receita', 'Para adicionar os achados à lista, precisa também de "Cadastrar contatos".'],
      ['editar', 'Editar contatos e registrar conversas'],
      ['excluir', 'Excluir contatos'],
      ['exportar', 'Baixar a planilha de contatos (CSV)']] }
  ];
  var PERM_PADRAO = { ver_painel: true, ver_todos: true, ver_equipe: true, ver_empresa: true, criar: true, editar: true, excluir: false, exportar: false, buscar_leads: true };

  var st = {
    items: [], modo: 'carregando', visao: 'painel', filtro: 'todos', q: '', status: '', resp: '', ordem: 'proximo',
    modoContatos: 'lista', kbLimite: {}, kbFechadas: { cliente: true, perdido: true }, arrastando: '',
    editId: null, logId: null, intTocado: false, sel: {}, excIds: [],
    usuario: null, empresa: null, simulando: false,
    equipe: null, nomes: {}, removendo: '', editandoPerm: '', cadastro: null, cadastroErro: false, perm: {}
  };
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
    if (c === '42501') return 'Você não tem permissão para isso, ou a conta não está ativa. Fale com o responsável pela conta.';
    if (c === 'P0001') return 'A empresa chegou ao limite de contatos. Exclua contatos antigos para salvar novos.';
    if (c === '23514') return 'Algum campo passou do tamanho permitido. Encurte o texto e tente de novo.';
    if (s === 401 || c === 'PGRST301') return 'Sua sessão expirou. Entre de novo.';
    return 'Não deu para salvar agora. Confira sua conexão e tente de novo.';
  }
  function pode(k) { return st.perm[k] !== false; }
  // preferências da tela, guardadas só neste navegador e por usuário
  function chaveLocal(k) { return 'pp-' + k + ':' + (st.usuario ? st.usuario.id : ''); }
  function lerLocal(k) { try { return JSON.parse(localStorage.getItem(chaveLocal(k))); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(chaveLocal(k), JSON.stringify(v)); } catch (e) { /* navegador sem armazenamento */ } }
  function checar(r) { if (r.error) { r.error.status = r.status; throw r.error; } return r.data; }

  // ---------- banco: conversão e chamadas ----------
  function paraApp(r) {
    var p = { id: r.id, status: r.status, proximoContato: r.proximo_contato || '', ultimoContato: r.ultimo_contato || '',
      observacoes: r.observacoes || '', historico: Array.isArray(r.historico) ? r.historico : [],
      criadoEm: r.criado_em || '', userId: r.user_id || '', responsavel: r.responsavel || '', clienteDesde: r.cliente_desde || '',
      cnpj: r.cnpj || '', razaoSocial: r.razao_social || '', cnae: r.cnae || '', endereco: r.endereco || '', abertura: r.abertura || '' };
    CAMPOS_TEXTO.forEach(function (k) { p[k] = r[k] || ''; });
    return p;
  }
  function carregar() {
    var todos = [], TAM = 1000;
    function pagina(i) {
      return sb.from('prospects').select('*').order('criado_em', { ascending: false }).order('id')
        .range(i * TAM, i * TAM + TAM - 1).then(function (r) {
          var linhas = checar(r);
          todos = todos.concat(linhas);
          if (linhas.length === TAM && i < 9) return pagina(i + 1);
          return todos.map(paraApp);
        });
    }
    return pagina(0);
  }
  function guardar(linhaBanco) {
    var p = paraApp(linhaBanco), i;
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
      if (st.resp && p.responsavel !== (st.resp === 'eu' ? st.usuario.id : st.resp)) return false;
      if (q) {
        var alvo = semAcento([p.empresa, p.contato, p.cidade, p.uf, p.segmento, p.telefone, p.email, p.interesse, p.observacoes, p.razaoSocial, p.cnpj].join(' '));
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

  // menu "…" de um contato (linha da lista e cartão do kanban): por enquanto, só Excluir
  function menuMais(p) {
    if (!pode('excluir')) return null;
    return el('details', { class: 'menu-mais' },
      el('summary', { 'aria-label': 'Mais ações para ' + nomeDe(p), title: 'Mais ações' }, '…'),
      el('div', { class: 'menu-itens' },
        el('button', { class: 'menu-item menu-perigo', type: 'button', text: 'Excluir', onclick: function () { this.closest('details').open = false; abrirExclusao([p.id]); } })));
  }
  function linha(p, hj, comSel) {
    var s = statusDe(p.status);
    var pessoa = [p.contato && p.empresa ? p.contato : '', p.cargo].filter(Boolean).join(' · ');
    var local = [[p.cidade, p.uf].filter(Boolean).join('/'), p.segmento].filter(Boolean).join(' · ');
    var wa = linkWhats(p.telefone);
    var telNode = p.telefone
      ? el('div', { class: 'sub' }, p.telefone, wa ? ' · ' : null, wa ? el('a', { href: wa, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp' }) : null)
      : (p.email ? el('div', { class: 'sub', text: p.email }) : null);
    var caixa = comSel ? el('input', { type: 'checkbox', class: 'sel-caixa', 'aria-label': 'Selecionar ' + nomeDe(p),
      onchange: function () { if (this.checked) st.sel[p.id] = true; else delete st.sel[p.id]; atualizarSelecao(); } }) : null;
    if (caixa) caixa.checked = !!st.sel[p.id];
    return el('div', { class: 'linha' + (comSel && st.sel[p.id] ? ' marcada' : ''), role: 'listitem', 'data-id': p.id },
      el('div', { class: 'c-nome' + (caixa ? ' com-caixa' : '') }, caixa,
        el('div', null,
          el('button', { class: 'nome', type: 'button', text: nomeDe(p), onclick: function () { abrirFicha(p.id); } }),
          pessoa ? el('div', { class: 'sub', text: pessoa }) : null)),
      el('div', { class: 'c-local' }, local ? el('div', { class: 'sub', text: local }) : null, telNode),
      el('div', { class: 'c-status' }, el('span', { class: 'tag s-' + s.id, text: s.curto || s.nome, title: s.nome })),
      celProximo(p, hj),
      el('div', { class: 'c-acao' },
        el('div', { class: 'acao-linha' },
          pode('editar') ? el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Registrar contato', onclick: function () { abrirLog(p.id); } }) : null,
          menuMais(p))));
  }

  // ---------- kanban ----------
  // Uma coluna por status. Desenha no máximo 50 cartões por coluna (mais com "Ver mais").
  // No computador, arrastar muda o status; em qualquer tela, o menu "Mover para…" do cartão faz o mesmo.
  var POR_COLUNA = 50;
  function quemCuida(p) {
    var resp = st.nomes[p.responsavel], autor = st.nomes[p.userId];
    if (resp && autor && p.userId !== p.responsavel) return resp + ' · cadastrado por ' + autor;
    return resp || (autor ? 'Cadastrado por ' + autor : '');
  }
  function cartao(p, hj, arrasta) {
    var pessoa = [p.contato && p.empresa ? p.contato : '', p.cargo].filter(Boolean).join(' · ');
    var local = [p.cidade, p.uf].filter(Boolean).join('/'), quem = quemCuida(p);
    var menu = arrasta ? el('select', { class: 'kb-mover', 'aria-label': 'Mover ' + nomeDe(p) + ' para outra etapa', onchange: function () { moverPara(p.id, this.value); } },
      el('option', { value: '', text: 'Mover para…' }),
      STATUS.filter(function (s) { return s.id !== p.status; }).map(function (s) { return el('option', { value: s.id, text: s.nome }); })) : null;
    return el('div', { class: 'kb-card', role: 'listitem', draggable: arrasta ? 'true' : null, 'data-id': p.id },
      el('div', { class: 'kb-topo' },
        el('button', { class: 'nome', type: 'button', text: nomeDe(p), onclick: function () { abrirFicha(p.id); } }),
        menuMais(p)),
      pessoa ? el('div', { class: 'sub', text: pessoa }) : null,
      local ? el('div', { class: 'sub', text: local }) : null,
      ativo(p) || parse(p.proximoContato) ? celProximo(p, hj) : null,
      quem ? el('div', { class: 'kb-quem', text: quem }) : null,
      menu);
  }
  function renderKanban(vis, hj) {
    var quadro = $('kanban'), grupos = {}, arrasta = pode('editar');
    STATUS.forEach(function (s) { grupos[s.id] = []; });
    vis.forEach(function (p) { grupos[statusDe(p.status).id].push(p); });
    STATUS.forEach(function (s) {
      if (st.status && st.status !== s.id) return;
      var itens = grupos[s.id], fechada = !!st.kbFechadas[s.id], lim = st.kbLimite[s.id] || POR_COLUNA, corpo = null, mais = null;
      var cab = el('button', { class: 'kb-cab', type: 'button', 'aria-expanded': String(!fechada),
        onclick: function () { st.kbFechadas[s.id] = !fechada; gravarLocal('kanban-fechadas', st.kbFechadas); render(); } },
        el('span', { class: 'kb-titulo', text: s.curto || s.nome, title: s.nome }),
        el('span', { class: 'kb-n', text: String(itens.length) }),
        el('span', { class: 'kb-seta', 'aria-hidden': 'true', text: fechada ? '+' : '−' }));
      if (!fechada) {
        corpo = itens.length
          ? el('div', { class: 'kb-corpo', role: 'list', 'aria-label': s.nome }, itens.slice(0, lim).map(function (p) { return cartao(p, hj, arrasta); }))
          : el('p', { class: 'kb-vazio', text: arrasta ? 'Nenhum contato. Arraste um cartão para cá.' : 'Nenhum contato.' });
        if (itens.length > lim) mais = el('button', { class: 'linkbtn kb-mais', type: 'button', text: 'Ver mais (faltam ' + (itens.length - lim) + ')',
          onclick: function () { st.kbLimite[s.id] = lim + POR_COLUNA; render(); } });
      }
      quadro.append(el('section', { class: 'kb-col kb-c-' + s.id + (fechada ? ' kb-fechada' : ''), 'data-status': s.id, 'aria-label': s.nome + ': ' + itens.length }, cab, corpo, mais));
    });
  }
  function moverPara(id, status) {
    var p = achar(id), antes;
    if (!p || !status || p.status === status || !pode('editar')) { render(); return; }
    antes = p.status; p.status = status; render();
    sb.from('prospects').update({ status: status }).eq('id', id).select().single().then(function (r) {
      guardar(checar(r)); toast('Movido para ' + statusDe(status).nome);
    }).catch(function (e) { p.status = antes; render(); toast(msgErro(e)); });
  }
  function trocarModo(m) { st.modoContatos = m; st.sel = {}; gravarLocal('visao-contatos', m); render(); }

  // ---------- excluir (menu "…" e em lote) ----------
  // Um contato: apaga direto na tabela (como a ficha). Vários: função prospects_excluir_lote, que grava na auditoria.
  // Acima de 50, pede para digitar EXCLUIR. Se houver clientes fechados, oferece excluir só os que não são clientes.
  var LIMITE_DIGITAR = 50;
  function selecionados() { return Object.keys(st.sel); }
  function atualizarSelecao(vis) {
    var n = selecionados().length, total = vis ? vis.length : document.querySelectorAll('#lista .sel-caixa').length, todos = $('sel-todos');
    $('sel-n').textContent = n === 1 ? '1 selecionado' : n + ' selecionados';
    $('sel-n').hidden = !n; $('sel-excluir').hidden = !n; $('sel-limpar').hidden = !n;
    $('selecao').classList.toggle('ativa', n > 0);
    $('sel-todos-txt').textContent = 'Marcar todos os ' + total + ' visíveis';
    todos.checked = n > 0 && n === total; todos.indeterminate = n > 0 && n < total;
    document.querySelectorAll('#lista .linha[data-id]').forEach(function (l) { l.classList.toggle('marcada', !!st.sel[l.dataset.id]); });
  }
  function idsExclusao() {
    var ids = st.excIds, r = document.querySelector('input[name="exc-qual"]:checked');
    if (ids.length > 1 && r && r.value === 'nao-clientes') ids = ids.filter(function (id) { var p = achar(id); return !p || p.status !== 'cliente'; });
    return ids;
  }
  function resumoExclusao() {
    var ids = idsExclusao(), n = ids.length, btn = $('exc-sim'), digitar = n > LIMITE_DIGITAR;
    $('exc-digitar').hidden = !digitar;
    btn.textContent = n === 1 ? 'Excluir contato' : 'Excluir ' + n + ' contatos';
    btn.disabled = !n || (digitar && $('exc-palavra').value.trim().toUpperCase() !== 'EXCLUIR');
  }
  function abrirExclusao(ids) {
    ids = ids.filter(function (id) { return !!achar(id); });
    if (!ids.length || !pode('excluir')) return;
    var clientes = ids.filter(function (id) { return achar(id).status === 'cliente'; }).length, outros = ids.length - clientes;
    st.excIds = ids;
    $('exc-titulo').textContent = ids.length === 1 ? 'Excluir ' + nomeDe(achar(ids[0])) + '?' : 'Excluir ' + ids.length + ' contatos?';
    $('exc-cliente-um').hidden = !(ids.length === 1 && clientes);
    $('exc-clientes').hidden = !(ids.length > 1 && clientes);
    $('exc-clientes-txt').textContent = clientes === 1 ? 'Inclui 1 cliente fechado.' : 'Inclui ' + clientes + ' clientes fechados.';
    $('exc-so-nao-txt').textContent = outros ? 'Excluir só os ' + outros + ' que não são clientes' : 'Não excluir nenhum (todos são clientes)';
    $('exc-todos-txt').textContent = 'Excluir todos os ' + ids.length + ', inclusive os clientes';
    $('exc-so-nao').checked = true;
    $('exc-palavra').value = '';
    $('exc-erro').hidden = true;
    resumoExclusao();
    $('dlg-excluir').showModal();
  }
  function tirarDaLista(ids) {
    var fora = {}; ids.forEach(function (id) { fora[id] = true; delete st.sel[id]; });
    st.items = st.items.filter(function (p) { return !fora[p.id]; });
  }
  function confirmarExclusao(ev) {
    ev.preventDefault();
    var ids = idsExclusao(), btn = $('exc-sim'), err = $('exc-erro'), op;
    resumoExclusao(); if (btn.disabled) return;
    btn.disabled = true; err.hidden = true;
    if (ids.length === 1) {
      op = sb.from('prospects').delete().eq('id', ids[0]).select('id').then(function (r) {
        if (!checar(r).length) throw { code: '42501' };
        tirarDaLista(ids); toast('Contato excluído');
      });
    } else {
      op = sb.rpc('prospects_excluir_lote', { p_ids: ids }).then(function (r) {
        var res = checar(r) || {}, feitos = res.excluidos || 0, pulados = res.pulados || 0;
        toast((feitos === 1 ? '1 contato excluído' : feitos + ' contatos excluídos') +
          (pulados === 1 ? '. 1 não pôde ser excluído (sem permissão)' : pulados ? '. ' + pulados + ' não puderam ser excluídos (sem permissão)' : ''));
        if (pulados) { st.sel = {}; return iniciarLista(); }
        tirarDaLista(ids);
      });
    }
    op.then(function () { if (ids.length > 1) st.sel = {}; $('dlg-excluir').close(); render(); })
      .catch(function (e) { err.textContent = msgErro(e); err.hidden = false; })
      .then(function () { resumoExclusao(); });
  }

  function vazio(titulo, texto, botao, acao) {
    return el('div', { class: 'vazio' },
      el('h2', { text: titulo }), el('p', { text: texto }),
      botao ? el('button', { class: 'btn btn-primary', type: 'button', text: botao, onclick: acao }) : null);
  }

  // ---------- painel ----------
  function renderPainel(hj) {
    var caixaVazia = $('painel-vazio'), conteudo = $('painel-conteudo');
    $('aviso-cadastro').hidden = !(podeEditarEmpresa() && st.cadastro && !cadastroCompleto(st.cadastro));
    caixaVazia.replaceChildren();
    if (st.modo !== 'ok' || !st.items.length) {
      conteudo.hidden = true; caixaVazia.hidden = false;
      if (st.modo === 'carregando') caixaVazia.append(el('p', { class: 'dica', text: 'Carregando o painel…' }));
      else if (st.modo === 'erro') caixaVazia.append(vazio('Não deu para carregar', 'Confira sua conexão e tente de novo.', 'Tentar de novo', iniciarLista));
      else caixaVazia.append(vazio('Comece pelo primeiro contato', 'Anote quem você abordou, o status e quando voltar a falar. Os gráficos aparecem aqui assim que houver contatos.', pode('criar') ? 'Novo contato' : '', function () { abrirFicha(null); }));
      return;
    }
    caixaVazia.hidden = true; conteudo.hidden = false;

    var contagem = {}, porDia = {};
    st.items.forEach(function (p) {
      contagem[p.status] = (contagem[p.status] || 0) + 1;
      var d = p.criadoEm ? PP.iso(new Date(p.criadoEm)) : '';
      if (parse(d)) porDia[d] = (porDia[d] || 0) + 1;
    });
    G.rosca($('graf-status'), G.fatiasDeStatus(contagem), { titulo: 'Contatos por status', unidade: st.items.length === 1 ? 'contato' : 'contatos' });
    G.linha($('graf-crescimento'), G.acumulado(porDia, hj), { titulo: 'Crescimento da base', unidade: 'contatos' });

    var lista = $('lista-hoje'), urgentes = st.items.filter(function (p) { var k = classe(p, hj).tipo; return k === 'atrasado' || k === 'hoje'; });
    urgentes.sort(function (a, b) { return a.proximoContato < b.proximoContato ? -1 : a.proximoContato > b.proximoContato ? 1 : colator.compare(nomeDe(a), nomeDe(b)); });
    lista.replaceChildren(); lista.removeAttribute('role');
    if (!urgentes.length) { lista.append(el('p', { class: 'dica mt-16', text: 'Nenhum retorno atrasado ou marcado para hoje.' })); return; }
    lista.setAttribute('role', 'list');
    urgentes.slice(0, 8).forEach(function (p) { lista.append(linha(p, hj)); });
    if (urgentes.length > 8) lista.append(el('p', { class: 'dica mt-16', text: 'E mais ' + (urgentes.length - 8) + ' na aba Contatos.' }));
  }

  // ---------- render geral ----------
  function render() {
    var hj = hoje(), lista = $('lista'), n = { atrasados: 0, hoje: 0, semana: 0, sem: 0 };
    st.items.forEach(function (p) {
      var k = classe(p, hj).tipo;
      if (k === 'atrasado') n.atrasados++; else if (k === 'hoje') n.hoje++; else if (k === 'semana') n.semana++;
      else if (k === 'sem' && ativo(p)) n.sem++;
    });
    var pronto = st.modo === 'ok';
    ['atrasados', 'hoje', 'semana', 'sem'].forEach(function (k) { $('n-' + k).textContent = pronto ? n[k] : '–'; });
    document.querySelectorAll('.stat').forEach(function (b) { b.setAttribute('aria-pressed', String(st.visao === 'contatos' && b.dataset.filtro === st.filtro)); });
    $('btn-csv').hidden = !(pronto && st.items.length && pode('exportar'));
    $('dica-proprios').hidden = pode('ver_todos');

    VISOES.forEach(function (v) {
      $('v-' + v).hidden = st.visao !== v;
      $('aba-' + v).hidden = !visaoLiberada(v);
      $('aba-' + v).setAttribute('aria-selected', String(st.visao === v));
    });
    if (st.visao === 'painel') { renderPainel(hj); return; }
    if (st.visao === 'equipe') { renderEquipe(); return; }
    if (st.visao === 'empresa') return;
    if (st.visao === 'buscar') return;

    var kb = st.modoContatos === 'kanban', quadro = $('kanban');
    $('modo-lista').setAttribute('aria-pressed', String(!kb));
    $('modo-kanban').setAttribute('aria-pressed', String(kb));
    $('lista-head').hidden = kb;
    quadro.replaceChildren(); quadro.hidden = true;
    $('selecao').hidden = true;
    lista.replaceChildren();
    lista.removeAttribute('role');
    $('btn-limpar').hidden = true;
    if (st.modo === 'carregando') { $('contagem').textContent = 'Carregando os contatos…'; return; }
    if (st.modo === 'erro') {
      $('contagem').textContent = '';
      lista.append(vazio('Não deu para carregar', 'Confira sua conexão e tente de novo.', 'Tentar de novo', iniciarLista));
      return;
    }
    if (!st.items.length) {
      $('contagem').textContent = 'Nenhum contato cadastrado';
      lista.append(pode('criar')
        ? vazio('Comece pelo primeiro contato', 'Anote quem você abordou, o status e quando voltar a falar. No dia marcado, o contato aparece no topo.', 'Novo contato', function () { abrirFicha(null); })
        : vazio('Nenhum contato para mostrar', 'Quando houver contatos liberados para você, eles aparecem aqui.', '', null));
      return;
    }
    var vis = visiveis(hj), filtrando = st.filtro !== 'todos' || st.status || st.resp || st.q.trim();
    $('contagem').textContent = filtrando
      ? 'Mostrando ' + vis.length + ' de ' + st.items.length + (st.items.length === 1 ? ' contato' : ' contatos')
      : (st.items.length === 1 ? '1 contato' : st.items.length + ' contatos');
    $('btn-limpar').hidden = !filtrando;
    // a seleção vale só para o que está na tela: mudar busca ou filtro desmarca o que sumiu
    var naTela = {}; vis.forEach(function (p) { naTela[p.id] = true; });
    selecionados().forEach(function (id) { if (!naTela[id] || kb) delete st.sel[id]; });
    if (!vis.length) { lista.append(vazio('Nenhum contato neste filtro', 'Mude a busca ou limpe os filtros para ver a lista inteira.', 'Limpar filtros', limpar)); return; }
    if (kb) { $('lista-head').hidden = true; quadro.hidden = false; renderKanban(vis, hj); return; }
    var comSel = pode('excluir');
    lista.setAttribute('role', 'list');
    vis.forEach(function (p) { lista.append(linha(p, hj, comSel)); });
    if (comSel) { $('selecao').hidden = false; atualizarSelecao(vis); }
  }
  function limpar() { st.filtro = 'todos'; st.status = ''; st.resp = ''; st.q = ''; $('q').value = ''; $('filtro-status').value = ''; $('filtro-resp').value = ''; render(); }
  // filtro "Responsável": Todos, Meus contatos e, se a pessoa enxerga a equipe, cada colega
  function preencherFiltroResp() {
    var sel = $('filtro-resp'), membros = (st.equipe && st.equipe.membros) || [];
    while (sel.options.length > 2) sel.remove(2);
    if (membros.length > 1) membros.forEach(function (m) {
      if (st.usuario && m.id !== st.usuario.id) sel.append(el('option', { value: m.id, text: m.nome || m.email }));
    });
    if (st.resp && st.resp !== 'eu' && !membros.some(function (m) { return m.id === st.resp; })) st.resp = '';
    sel.value = st.resp;
  }
  function visaoLiberada(v) {
    return v === 'contatos' || (v === 'painel' && pode('ver_painel')) || (v === 'buscar' && pode('buscar_leads') && !!window.PPBuscar && (!!PP.cfg.receita || !!(st.usuario && st.usuario.is_admin))) || (v === 'equipe' && pode('ver_equipe')) || (v === 'empresa' && pode('ver_empresa'));
  }
  function visaoInicial(v) { return VISOES.indexOf(v) !== -1 && visaoLiberada(v) ? v : (pode('ver_painel') ? 'painel' : 'contatos'); }
  function irVisao(v) {
    st.visao = visaoInicial(v);
    try { history.replaceState(null, '', st.visao === 'painel' ? window.location.pathname : '#' + st.visao); } catch (e) { /* sem histórico */ }
    if (st.visao === 'equipe' && !st.equipe) carregarEquipe();
    if (st.visao === 'buscar') abrirBusca();
    render();
  }

  // ---------- buscar leads (código em buscar.js) ----------
  function abrirBusca() {
    window.PPBuscar.abrir({ pode: pode, msgErro: msgErro, recarregar: iniciarLista });
  }

  // ---------- ficha ----------
  function resumoFicha() {
    var v = $('f-proximo').value;
    $('f-resumo').textContent = parse(v) ? 'Retorno em ' + dataLonga(v) + '.' : 'Sem data de retorno. Este contato não entra nos lembretes.';
  }
  // responsável do contato: só o responsável pela conta (ou o admin simulando) troca; o banco confere
  function podeTrocarResp() { return podeEditarEmpresa(); }
  function opcoesResp(atual) {
    var sel = $('f-resp'), membros = (st.equipe && st.equipe.membros) || [], tem = false;
    sel.replaceChildren();
    membros.forEach(function (m) { if (m.id === atual) tem = true; sel.append(el('option', { value: m.id, text: m.nome || m.email })); });
    if (atual && !tem) sel.append(el('option', { value: atual, text: st.nomes[atual] || (st.usuario && atual === st.usuario.id ? st.usuario.nome || 'Você' : 'Outra pessoa da equipe') }));
    if (!atual) sel.prepend(el('option', { value: '', text: 'Sem responsável' }));
    sel.value = atual || '';
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
    opcoesResp(p ? p.responsavel : (st.usuario && st.usuario.id));
    resumoFicha();
    var leitura = !!p && !pode('editar');
    $('form-ficha').querySelectorAll('.dlg-body input, .dlg-body select, .dlg-body textarea, #f-atalhos button').forEach(function (c) { c.disabled = leitura; });
    $('f-resp').disabled = leitura || !podeTrocarResp();
    $('f-resp-dica').hidden = leitura || podeTrocarResp();
    $('ficha-erro').hidden = true;
    $('ficha-excluir').hidden = !p || !pode('excluir');
    $('ficha-confirma').hidden = true;
    $('ficha-registrar').hidden = !p || leitura;
    $('ficha-salvar').hidden = leitura;
    $('ficha-salvar').disabled = false;

    var rap = $('ficha-rapido'); rap.replaceChildren();
    if (p) {
      var wa = linkWhats(p.telefone), site = linkSite(p.link), autor = st.nomes[p.userId];
      if (wa) rap.append(el('a', { href: wa, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir WhatsApp' }));
      if (site) rap.append(el('a', { href: site, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir site ou Instagram' }));
      if (p.ultimoContato) rap.append(el('span', { text: 'Último contato: ' + dataCurta(p.ultimoContato) }));
      if (autor) rap.append(el('span', { text: 'Cadastrado por ' + autor }));
      if (p.clienteDesde) rap.append(el('span', { text: 'Cliente desde ' + dataCurta(p.clienteDesde) }));
      if (p.cnpj) rap.append(el('span', { text: 'CNPJ ' + PP.docFormatado(p.cnpj) + (p.razaoSocial && p.razaoSocial !== p.empresa ? ' · ' + p.razaoSocial : '') }));
      if (p.endereco) rap.append(el('span', { text: p.endereco }));
    }
    rap.hidden = !rap.childNodes.length;

    var hist = p ? p.historico : [], ul = $('ficha-hist'); ul.replaceChildren();
    hist.forEach(function (h) {
      ul.append(el('li', null,
        el('div', { class: 'meta' }, el('b', { text: dataCurta(h.data) || 'Sem data' }),
          h.canal ? ' · ' + h.canal : '', h.status ? ' · ' + statusDe(h.status).nome : '', h.por ? ' · ' + h.por : ''),
        h.nota ? el('div', { class: 'nota', text: h.nota }) : null));
    });
    $('ficha-hist-secao').hidden = !hist.length;
    $('dlg-ficha').showModal();
  }

  function salvarFicha(ev) {
    ev.preventDefault();
    var err = $('ficha-erro'), d = {}, prox = $('f-proximo').value;
    if (st.editId ? !pode('editar') : !pode('criar')) return;
    CAMPOS_TEXTO.forEach(function (k) { d[k] = $('f-' + k).value.trim(); });
    if (!d.empresa && !d.contato) { err.textContent = 'Preencha a empresa ou a pessoa de contato.'; err.hidden = false; $('f-empresa').focus(); return; }
    d.status = $('f-status').value;
    d.proximo_contato = parse(prox) ? prox : null;
    d.observacoes = $('f-obs').value.trim();
    if (podeTrocarResp() && $('f-resp').value) d.responsavel = $('f-resp').value;
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
    var p = achar(id); if (!p || !pode('editar')) return;
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
    var entrada = { data: data, canal: canal ? canal.value : '', nota: $('l-nota').value.trim(), status: $('l-status').value, por: (st.usuario && st.usuario.nome) || '' };
    var antigo = p.historico.map(function (h) { return { data: h.data || '', canal: h.canal || '', nota: h.nota || '', status: h.status || '', por: h.por || '' }; });
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
      ['Último contato', 'ultimoContato'], ['Próximo contato', 'proximoContato'], ['Observações', 'observacoes'], ['Histórico', 'historico'], ['Cadastrado por', 'userId'], ['Responsável', 'responsavel'], ['Cliente desde', 'clienteDesde']];
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
        else if (c[1] === 'userId' || c[1] === 'responsavel') v = st.nomes[v] || '';
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

  // ---------- equipe ----------
  var ERROS_EQUIPE = {
    email_invalido: 'Confira o e-mail digitado.',
    ja_membro: 'Esta pessoa já faz parte da equipe.',
    ja_convidado: 'Este e-mail já está na lista de quem falta se cadastrar.',
    indisponivel: 'Este e-mail já usa o sistema em outra empresa. Fale com a PHAR para mover a conta.',
    limite_equipe: 'A equipe chegou ao limite de 20 pessoas.',
    sem_permissao: 'Só o responsável pela conta pode alterar a equipe.',
    nao_encontrado: 'Não deu para remover esta pessoa.',
    nome_invalido: 'Informe o nome da empresa.'
  };
  function erroEquipe(e) { return ERROS_EQUIPE[(e && e.message) || ''] || 'Não deu para concluir agora. Tente de novo.'; }
  function carregarEquipe() {
    return sb.rpc('equipe_listar').then(function (r) {
      st.equipe = checar(r); st.nomes = {};
      st.equipe.membros.forEach(function (m) { st.nomes[m.id] = m.nome || m.email; });
      preencherFiltroResp();
      if (st.visao === 'equipe') renderEquipe();
      else if (st.visao === 'contatos') render();
    }).catch(function () { st.equipe = st.equipe || { membros: [], convites: [], pode_gerenciar: false, erro: true }; if (st.visao === 'equipe') renderEquipe(); });
  }
  // caixinhas de permissão: devolve o bloco pronto; ler com lerPermissoes(bloco)
  function caixasPermissao(prefixo, valores) {
    var v = valores || PERM_PADRAO;
    return el('div', { class: 'perms' }, PERMS.map(function (g) {
      return el('fieldset', null, el('legend', { text: g.grupo }), g.itens.map(function (it) {
        var caixa = el('input', { type: 'checkbox', id: prefixo + '-' + it[0], 'data-perm': it[0] });
        caixa.checked = v[it[0]] !== false && (v[it[0]] === true || PERM_PADRAO[it[0]]);
        return el('label', { class: 'caixa', for: prefixo + '-' + it[0] }, caixa,
          el('span', null, it[1], it[2] ? el('small', { text: it[2] }) : null));
      }));
    }));
  }
  function lerPermissoes(bloco) {
    var p = {};
    bloco.querySelectorAll('input[data-perm]').forEach(function (c) { p[c.dataset.perm] = c.checked; });
    return p;
  }
  function resumoPermissoes(v) {
    var ve = [], faz = [];
    if (!v) return '';
    ve.push(v.ver_todos ? 'os contatos de toda a equipe' : 'só os contatos que cadastrou ou dos quais é responsável');
    if (v.ver_painel) ve.push('o painel');
    if (v.ver_equipe) ve.push('a equipe');
    if (v.ver_empresa) ve.push('os dados da empresa');
    if (v.criar) faz.push('cadastrar');
    if (v.editar) faz.push('editar');
    if (v.excluir) faz.push('excluir');
    if (v.exportar) faz.push('baixar a planilha');
    if (v.buscar_leads) faz.push('buscar leads');
    function lista(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a[0]; }
    return 'Vê ' + lista(ve) + '. ' + (faz.length ? 'Pode ' + lista(faz) + '.' : 'Não altera nada.');
  }
  function editorPermissoes(chave, valores, salvar) {
    var bloco = caixasPermissao('perm-' + chave, valores), btn;
    btn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Salvar permissões', onclick: function () {
      btn.disabled = true;
      salvar(lerPermissoes(bloco)).then(function (r) { checar(r); st.editandoPerm = ''; toast('Permissões atualizadas'); return carregarEquipe(); })
        .catch(function (e) { toast(erroEquipe(e)); btn.disabled = false; });
    } });
    return el('div', { class: 'eq-editor' }, bloco,
      el('div', { class: 'acoes' }, btn,
        el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Cancelar', onclick: function () { st.editandoPerm = ''; renderEquipe(); } })));
  }
  function renderEquipe() {
    var membros = $('eq-membros'), convites = $('eq-convites'), eq = st.equipe;
    membros.replaceChildren(); convites.replaceChildren();
    if (!eq) { membros.append(el('p', { class: 'dica', text: 'Carregando a equipe…' })); return; }
    if (eq.erro) { membros.append(el('p', { class: 'erro', text: 'Não deu para carregar a equipe. Recarregue a página.' })); return; }
    eq.membros.forEach(function (m) {
      var eu = st.usuario && m.id === st.usuario.id, acoes = null, editando = st.editandoPerm === 'm' + m.id;
      var gerenciavel = eq.pode_gerenciar && !eu && m.papel !== 'dono';
      if (gerenciavel) {
        acoes = st.removendo === m.id
          ? el('div', { class: 'eq-acoes' }, el('span', { text: 'Tirar o acesso?' }),
              el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Sim, remover', onclick: function () { remover(m); } }),
              el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Manter', onclick: function () { st.removendo = ''; renderEquipe(); } }))
          : el('div', { class: 'eq-acoes' },
              el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Permissões', 'aria-expanded': String(editando), onclick: function () { st.editandoPerm = editando ? '' : 'm' + m.id; renderEquipe(); } }),
              el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Remover', onclick: function () { st.removendo = m.id; renderEquipe(); } }));
      }
      membros.append(el('div', { class: 'eq-linha' },
        el('div', null,
          el('div', { class: 'nome' }, m.nome || 'Sem nome', eu ? ' (você)' : '',
            el('span', { class: 'tag tag-papel', text: m.papel === 'dono' ? 'Responsável' : 'Colaborador' })),
          el('div', { class: 'sub', text: m.email + (m.ultimo_acesso ? ' · último acesso em ' + PP.dataHora(m.ultimo_acesso) : ' · ainda não entrou') }),
          m.papel === 'dono' ? (eq.pode_gerenciar ? el('div', { class: 'eq-perm-resumo', text: 'Vê e pode tudo.' }) : null)
            : m.permissoes ? el('div', { class: 'eq-perm-resumo', text: resumoPermissoes(m.permissoes) }) : null),
        acoes,
        gerenciavel && editando ? editorPermissoes('m' + m.id, m.permissoes, function (p) { return sb.rpc('equipe_permissoes', { p_permissoes: p, p_usuario: m.id }); }) : null));
    });
    $('eq-gerenciar').hidden = !eq.pode_gerenciar;
    $('eq-dica').textContent = eq.pode_gerenciar
      ? 'Você define o que cada pessoa pode ver e fazer. Clique em Permissões para mudar.'
      : 'O responsável pela conta define o que cada pessoa pode ver e fazer.';
    if (eq.pode_gerenciar && !$('eq-perms-novo').childNodes.length) $('eq-perms-novo').append(caixasPermissao('novo', eq.padrao));
    if (eq.convites.length) {
      convites.append(el('p', { class: 'dica', text: 'Autorizados, aguardando o cadastro:' }));
      eq.convites.forEach(function (c) {
        var editando = st.editandoPerm === 'c' + c.id;
        convites.append(el('div', { class: 'eq-linha' },
          el('div', null, el('div', { class: 'sub', text: c.email }), el('div', { class: 'sub', text: 'Autorizado em ' + PP.dataHora(c.criado_em) }),
            c.permissoes ? el('div', { class: 'eq-perm-resumo', text: resumoPermissoes(c.permissoes) }) : null),
          el('div', { class: 'eq-acoes' },
            el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Permissões', 'aria-expanded': String(editando), onclick: function () { st.editandoPerm = editando ? '' : 'c' + c.id; renderEquipe(); } }),
            el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Cancelar autorização', onclick: function () { cancelarConvite(c); } })),
          editando ? editorPermissoes('c' + c.id, c.permissoes, function (p) { return sb.rpc('equipe_permissoes', { p_permissoes: p, p_convite: c.id }); }) : null));
      });
    }
  }
  function remover(m) {
    st.removendo = '';
    sb.rpc('equipe_remover', { p_usuario: m.id }).then(function (r) { checar(r); toast('Acesso removido'); return carregarEquipe(); })
      .catch(function (e) { toast(erroEquipe(e)); renderEquipe(); });
  }
  function cancelarConvite(c) {
    sb.rpc('equipe_cancelar_convite', { p_id: c.id }).then(function (r) { checar(r); toast('Autorização cancelada'); return carregarEquipe(); })
      .catch(function (e) { toast(erroEquipe(e)); });
  }
  function convidar(ev) {
    ev.preventDefault();
    var email = $('eq-email').value.trim().toLowerCase(), err = $('eq-erro'), btn = $('eq-convidar');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = ERROS_EQUIPE.email_invalido; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    sb.rpc('equipe_autorizar', { p_email: email, p_permissoes: lerPermissoes($('eq-perms-novo')) }).then(function (r) {
      checar(r); $('eq-email').value = ''; $('eq-perms-novo').replaceChildren(); toast('E-mail autorizado. Peça para a pessoa criar a conta.'); return carregarEquipe();
    }).catch(function (e) { err.textContent = erroEquipe(e); err.hidden = false; })
      .then(function () { btn.disabled = false; });
  }
  // ---------- cadastro da empresa ----------
  var ERROS_EMP = {
    nome_invalido: 'Informe o nome da empresa.',
    documento_invalido: 'Confira o CNPJ ou CPF: o número não é válido.',
    cep_invalido: 'O CEP precisa ter 8 números.',
    uf_invalida: 'Escolha o estado na lista.',
    email_invalido: 'Confira o e-mail comercial.',
    sem_permissao: 'Só o responsável pela conta pode alterar os dados da empresa.'
  };
  function podeEditarEmpresa() { return !!st.usuario && (st.usuario.papel === 'dono' || st.simulando); }
  function cadastroCompleto(c) { return !!(c && c.nome && c.documento && c.telefone && c.cidade && c.uf); }
  function preencherEmpresa() {
    var c = st.cadastro || { nome: st.empresa ? st.empresa.nome : '' }, pode = podeEditarEmpresa() && !st.cadastroErro;
    CAMPOS_EMP.forEach(function (k) {
      var campo = $('emp-' + k), v = c[k] || '';
      if (k === 'documento') v = PP.docFormatado(v); else if (k === 'cep') v = PP.cepFormatado(v);
      campo.value = v; campo.disabled = !pode; campo.removeAttribute('aria-invalid');
    });
    $('emp-acoes').hidden = !pode;
    $('emp-erro').hidden = true;
    $('emp-dica').textContent = st.cadastroErro
      ? 'Não deu para carregar os dados da empresa. Recarregue a página.'
      : pode ? 'Preencha os dados completos da empresa. Toda a equipe pode ver; só o responsável pela conta altera.'
        : 'Estes são os dados da empresa. Só o responsável pela conta pode alterar.';
    $('emp-atualizado').textContent = c.dados_em ? 'Atualizado em ' + PP.dataHora(c.dados_em) : '';
  }
  function carregarEmpresa() {
    return sb.from('empresas').select('*').maybeSingle().then(function (r) {
      st.cadastro = checar(r) || null; st.cadastroErro = !st.cadastro;
    }).catch(function () { st.cadastroErro = true; })
      .then(function () { preencherEmpresa(); if (st.visao === 'painel') render(); });
  }
  function salvarEmpresa(ev) {
    ev.preventDefault();
    var dados = {}, err = $('emp-erro'), btn = $('emp-salvar'), ruim = '';
    CAMPOS_EMP.forEach(function (k) { dados[k] = $('emp-' + k).value.trim(); $('emp-' + k).removeAttribute('aria-invalid'); });
    dados.documento = PP.docLimpo(dados.documento);
    dados.cep = dados.cep.replace(/\D/g, '');
    dados.email = dados.email.toLowerCase();
    if (!dados.nome) ruim = 'nome';
    else if (dados.documento && !PP.docValido(dados.documento)) ruim = 'documento';
    else if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) ruim = 'email';
    else if (dados.cep && dados.cep.length !== 8) ruim = 'cep';
    if (ruim) {
      err.textContent = ERROS_EMP[{ nome: 'nome_invalido', documento: 'documento_invalido', email: 'email_invalido', cep: 'cep_invalido' }[ruim]];
      err.hidden = false; $('emp-' + ruim).setAttribute('aria-invalid', 'true'); $('emp-' + ruim).focus(); return;
    }
    err.hidden = true; btn.disabled = true;
    sb.rpc('empresa_salvar', { p: dados }).then(function (r) {
      checar(r);
      st.cadastro = Object.assign({}, st.cadastro || {}, dados, { dados_em: new Date().toISOString() });
      st.empresa.nome = dados.nome; $('topo-empresa').textContent = dados.nome; $('simulando-nome').textContent = dados.nome;
      preencherEmpresa();
      toast(cadastroCompleto(st.cadastro) ? 'Dados da empresa salvos' : 'Dados salvos. Ainda faltam CNPJ ou CPF, telefone, cidade ou estado.');
    }).catch(function (e) {
      err.textContent = ERROS_EMP[(e && e.message) || ''] || 'Não deu para salvar agora. Confira sua conexão e tente de novo.'; err.hidden = false;
    }).then(function () { btn.disabled = false; });
  }
  function copiarLink() {
    var link = window.location.origin + '/entrar?modo=criar';
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copiado'); })
      .catch(function () { toast('Link de cadastro: ' + link); });
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
      return PP.sessaoApp().then(function (ses) {
        var u = ses && ses.usuario, emp = ses && ses.empresa;
        var primeiro = u && u.nome ? u.nome.split(' ')[0] : '';
        if (!u) { estado('Conta não encontrada', 'Saia e entre de novo. Se continuar, fale com a PHAR Consultoria.', true); return; }
        if (u.status !== 'ativa') { estado('Acesso removido', 'Seu acesso a esta empresa foi removido. Fale com o responsável pela conta.', false); return; }
        if (!emp) { estado('Conta sem empresa', 'Sua conta ainda não está ligada a uma empresa. Fale com quem te convidou ou com a PHAR Consultoria.', true); return; }
        if (!ses.simulando && emp.status === 'bloqueada') { estado('Acesso suspenso', 'O acesso da ' + emp.nome + ' está suspenso. Fale com a PHAR Consultoria para reativar.', false); return; }
        if (!ses.simulando && emp.status !== 'ativa') {
          estado('Aguardando liberação', (primeiro ? primeiro + ', recebemos' : 'Recebemos') + ' o cadastro da ' + emp.nome + '. Assim que a conta for liberada, você entra direto no sistema por esta página.', true);
          return;
        }
        st.usuario = u; st.empresa = emp; st.simulando = !!ses.simulando; st.perm = ses.permissoes || {};
        st.modoContatos = lerLocal('visao-contatos') === 'kanban' ? 'kanban' : 'lista';
        var fechadas = lerLocal('kanban-fechadas');
        if (fechadas && typeof fechadas === 'object') st.kbFechadas = fechadas;
        $('btn-novo').hidden = !pode('criar');
        $('topo-empresa').textContent = emp.nome;
        $('topo-nome').textContent = u.nome || u.email || '';
        $('link-admin').hidden = !u.is_admin;
        $('faixa-simulando').hidden = !st.simulando;
        $('simulando-nome').textContent = emp.nome;
        var inicial = (window.location.hash || '').replace('#', '');
        st.visao = visaoInicial(inicial);
        if (st.visao === 'buscar') abrirBusca();
        tela('app'); preencherEmpresa(); iniciarLista(); carregarEquipe();
        if (pode('ver_empresa')) carregarEmpresa();
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
  document.querySelectorAll('.aba-app').forEach(function (b) { b.addEventListener('click', function () { irVisao(b.dataset.visao); }); });
  document.querySelectorAll('.stat').forEach(function (b) {
    b.addEventListener('click', function () {
      st.filtro = (st.visao === 'contatos' && st.filtro === b.dataset.filtro) ? 'todos' : b.dataset.filtro;
      irVisao('contatos');
    });
  });
  $('btn-ver-retornos').addEventListener('click', function () { st.filtro = 'todos'; irVisao('contatos'); });
  $('q').addEventListener('input', function () { st.q = this.value; render(); });
  $('filtro-status').addEventListener('change', function () { st.status = this.value; render(); });
  $('filtro-resp').addEventListener('change', function () { st.resp = this.value; render(); });
  $('modo-lista').addEventListener('click', function () { trocarModo('lista'); });
  $('modo-kanban').addEventListener('click', function () { trocarModo('kanban'); });
  // arrastar e soltar do kanban (HTML5, só no computador; os cartões só ficam arrastáveis com "editar")
  var quadro = $('kanban');
  function limparArraste() { quadro.querySelectorAll('.kb-arrastando,.kb-alvo').forEach(function (n) { n.classList.remove('kb-arrastando', 'kb-alvo'); }); }
  quadro.addEventListener('dragstart', function (ev) {
    var c = ev.target.closest && ev.target.closest('.kb-card[draggable]'); if (!c) return;
    st.arrastando = c.dataset.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', c.dataset.id);
    c.classList.add('kb-arrastando');
  });
  quadro.addEventListener('dragend', function () { st.arrastando = ''; limparArraste(); });
  quadro.addEventListener('dragover', function (ev) {
    var col = st.arrastando && ev.target.closest && ev.target.closest('.kb-col'); if (!col) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
    if (!col.classList.contains('kb-alvo')) { quadro.querySelectorAll('.kb-alvo').forEach(function (n) { n.classList.remove('kb-alvo'); }); col.classList.add('kb-alvo'); }
  });
  quadro.addEventListener('drop', function (ev) {
    var col = st.arrastando && ev.target.closest && ev.target.closest('.kb-col'); if (!col) return;
    ev.preventDefault();
    var id = st.arrastando; st.arrastando = ''; limparArraste(); moverPara(id, col.dataset.status);
  });
  $('ordem').addEventListener('change', function () { st.ordem = this.value; render(); });
  $('btn-limpar').addEventListener('click', limpar);
  $('btn-csv').addEventListener('click', csv);
  $('sel-todos').addEventListener('change', function () {
    var marcar = this.checked;
    document.querySelectorAll('#lista .linha[data-id]').forEach(function (l) {
      var c = l.querySelector('.sel-caixa'); if (!c) return;
      c.checked = marcar; if (marcar) st.sel[l.dataset.id] = true; else delete st.sel[l.dataset.id];
    });
    atualizarSelecao();
  });
  $('sel-limpar').addEventListener('click', function () { st.sel = {}; render(); });
  $('sel-excluir').addEventListener('click', function () { abrirExclusao(selecionados()); });
  $('form-excluir').addEventListener('submit', confirmarExclusao);
  $('exc-palavra').addEventListener('input', resumoExclusao);
  document.querySelectorAll('input[name="exc-qual"]').forEach(function (r) { r.addEventListener('change', resumoExclusao); });
  // fecha o menu "…" aberto ao clicar fora dele
  document.addEventListener('click', function (ev) {
    document.querySelectorAll('details.menu-mais[open]').forEach(function (d) { if (!d.contains(ev.target)) d.open = false; });
  });
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  document.querySelectorAll('[data-sair]').forEach(function (b) { b.addEventListener('click', PP.sair); });
  $('estado-atualizar').addEventListener('click', function () { tela('carregando'); entrar(); });
  $('btn-sair-simulacao').addEventListener('click', function () {
    sb.rpc('admin_simular', { alvo: null }).then(function (r) { checar(r); PP.irPara('/admin'); })
      .catch(function () { toast('Não deu para sair da simulação. Tente de novo.'); });
  });

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

  $('form-convite').addEventListener('submit', convidar);
  $('form-empresa').addEventListener('submit', salvarEmpresa);
  $('emp-documento').addEventListener('blur', function () { this.value = PP.docFormatado(this.value); });
  $('emp-cep').addEventListener('blur', function () { this.value = PP.cepFormatado(this.value); });
  $('btn-completar').addEventListener('click', function () { irVisao('empresa'); });
  $('eq-copiar').addEventListener('click', copiarLink);

  sb.auth.onAuthStateChange(function (evento) { if (evento === 'SIGNED_OUT') PP.irPara('/entrar'); });
  entrar();
})();
