// Importar planilha de contatos (CSV ou Excel .xlsx) para a aprovação da PHAR.
// Passos: escolher o arquivo → ligar as colunas aos campos → prévia com repetidos e declaração → enviar.
// Nada entra direto na lista: as linhas vão para a fila do banco (importacao_enviar) e só viram contatos
// quando o administrador geral aprova no /admin. O Excel é lido pela SheetJS (vendor/xlsx.mini.min.js),
// carregada só quando alguém escolhe um arquivo .xlsx. O CSV é lido aqui mesmo.
// O app.js chama PPImportar.abrir(ctx) no botão "Importar planilha" e PPImportar.minhas(ctx) ao entrar.
window.PPImportar = (function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast;
  var MAX_LINHAS = 2000, PREVIA = 10, MAX_BYTES = 15 * 1024 * 1024;
  // campo do sistema, nome na tela, títulos de coluna que costumam aparecer nas planilhas (sem acento)
  var CAMPOS = [
    ['empresa', 'Empresa', ['empresa', 'nome fantasia', 'fantasia', 'nome da empresa', 'razao social', 'cliente', 'loja', 'estabelecimento']],
    ['contato', 'Pessoa de contato', ['contato', 'pessoa de contato', 'nome do contato', 'responsavel', 'pessoa', 'nome']],
    ['cargo', 'Cargo', ['cargo', 'funcao']],
    ['telefone', 'Telefone', ['telefone', 'celular', 'whatsapp', 'fone', 'tel']],
    ['email', 'E-mail', ['e-mail', 'email']],
    ['cidade', 'Cidade', ['cidade', 'municipio']],
    ['uf', 'UF', ['uf', 'estado']],
    ['segmento', 'Segmento', ['segmento', 'ramo', 'setor', 'atividade']],
    ['porte', 'Porte', ['porte']],
    ['link', 'Site ou rede social', ['site', 'instagram', 'link', 'url', 'rede social']],
    ['interesse', 'Interesse', ['interesse', 'produto', 'servico']],
    ['observacoes', 'Observações', ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios']],
    ['cnpj', 'CNPJ', ['cnpj']]
  ];
  var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  var ESTADOS = { pendente: 'Aguardando aprovação', aprovada: 'Aprovada', concluida: 'Concluída', recusada: 'Recusada' };
  var ERROS = {
    sem_permissao: 'Você não tem permissão para importar. Fale com o responsável pela conta.',
    sem_declaracao: 'Marque a declaração sobre a origem dos contatos para enviar.',
    linhas_demais: 'A planilha passa de 2.000 linhas. Divida em partes e envie uma de cada vez.',
    pendentes_demais: 'A empresa já tem 3 importações aguardando aprovação. Espere a PHAR analisar antes de enviar outra.',
    sem_espaco: 'Não cabe: com esta planilha a empresa passaria de 10.000 contatos. Exclua contatos antigos ou envie menos linhas.',
    sem_linhas: 'Nenhuma linha tem nome de empresa ou de pessoa de contato.',
    arquivo_invalido: 'Não deu para ler esta planilha. Confira o arquivo e tente de novo.'
  };
  var im = null, ctx = null;

  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function plural(n, um, varios) { return n.toLocaleString('pt-BR') + ' ' + (n === 1 ? um : varios); }

  // ---------- leitura do arquivo ----------
  function decodificar(buf) {
    var t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { t = new TextDecoder('windows-1252').decode(buf); } // CSV salvo pelo Excel no Windows
    return t.charAt(0) === '﻿' ? t.slice(1) : t;
  }
  function lerCsv(texto) {
    var primeira = texto.split(/\r?\n/, 1)[0] || '', sep = ',';
    [';', '\t', ','].some(function (s) { if (primeira.split(s).length > primeira.split(sep).length) sep = s; return false; });
    var linhas = [], linha = [], cel = '', aspas = false, i, c;
    for (i = 0; i < texto.length; i++) {
      c = texto.charAt(i);
      if (aspas) {
        if (c === '"' && texto.charAt(i + 1) === '"') { cel += '"'; i++; }
        else if (c === '"') aspas = false;
        else cel += c;
      } else if (c === '"' && cel === '') aspas = true;
      else if (c === sep) { linha.push(cel); cel = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto.charAt(i + 1) === '\n') i++;
        linha.push(cel); linhas.push(linha); linha = []; cel = '';
      } else cel += c;
    }
    if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
    return linhas;
  }
  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, falha) {
      var s = el('script', { src: '/vendor/xlsx.mini.min.js' });
      s.onload = function () { if (window.XLSX) ok(window.XLSX); else falha(new Error('xlsx')); };
      s.onerror = function () { falha(new Error('xlsx')); };
      document.head.append(s);
    });
  }
  function textoCelula(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
    return String(v);
  }
  function lerArquivo(f) {
    var ext = (f.name || '').split('.').pop().toLowerCase();
    if (f.size > MAX_BYTES) return Promise.reject(new Error('Arquivo grande demais (mais de 15 MB).'));
    if (ext === 'csv' || ext === 'txt') return f.arrayBuffer().then(function (b) { return lerCsv(decodificar(b)); });
    if (ext === 'xlsx') {
      return carregarXlsx().then(function (X) {
        return f.arrayBuffer().then(function (b) {
          var wb = X.read(b, { type: 'array', dense: true });
          return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '', blankrows: false })
            .map(function (l) { return l.map(textoCelula); });
        });
      }, function () { throw new Error('Não deu para abrir arquivos do Excel agora. No Excel: Arquivo > Salvar como > CSV, e envie o CSV.'); });
    }
    if (ext === 'xls') return Promise.reject(new Error('Formato antigo do Excel (.xls). No Excel: Arquivo > Salvar como > Pasta de Trabalho do Excel (.xlsx) ou CSV.'));
    return Promise.reject(new Error('Envie um arquivo .xlsx ou .csv.'));
  }

  // ---------- limpeza (o banco confere de novo ao receber) ----------
  function limpar(r) {
    var o = {}, tel = String(r.telefone || '').replace(/\D/g, ''), email = String(r.email || '').trim().toLowerCase();
    var cnpj = PP.docLimpo(r.cnpj), uf = String(r.uf || '').trim().toUpperCase(), alertas = {};
    if (/^\d{12,13}$/.test(cnpj)) cnpj = cnpj.padStart(14, '0'); // zeros à esquerda que o Excel tira de número
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alertas.email = true; email = ''; }
    if (cnpj && !(cnpj.length === 14 && PP.docValido(cnpj))) { alertas.cnpj = true; cnpj = ''; }
    if (uf && UFS.indexOf(uf) === -1) uf = '';
    CAMPOS.forEach(function (c) { o[c[0]] = String(r[c[0]] || '').trim(); });
    o.telefone = tel; o.email = email; o.cnpj = cnpj; o.uf = uf;
    return { d: o, alertas: alertas };
  }
  function chaves(d) {
    return { cnpj: d.cnpj, tel: d.telefone.length >= 8 ? d.telefone : '', nome: semAcento(d.empresa || d.contato) };
  }

  // ---------- passos ----------
  function corpo() { return $('imp-corpo'); }
  function mostrar(no) { var c = corpo(); c.textContent = ''; c.append(no); }
  function erro(msg) { return el('p', { class: 'erro', role: 'alert', text: msg }); }

  function passoArquivo(msg) {
    var input = el('input', { type: 'file', id: 'imp-arquivo', accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      mostrar(el('p', { class: 'dica', text: 'Lendo a planilha…' }));
      lerArquivo(f).then(function (linhas) {
        linhas = linhas.filter(function (l) { return l.some(function (c) { return String(c).trim() !== ''; }); });
        if (linhas.length < 2) throw new Error('A planilha precisa ter os títulos na primeira linha e pelo menos um contato abaixo.');
        if (linhas.length - 1 > MAX_LINHAS) throw new Error('A planilha tem ' + plural(linhas.length - 1, 'linha', 'linhas') + '. O limite é 2.000 por envio: divida em partes.');
        var n = Math.max.apply(null, linhas.map(function (l) { return l.length; }));
        var titulos = [];
        for (var i = 0; i < n; i++) titulos.push(String(linhas[0][i] || '').trim() || 'Coluna ' + (i + 1));
        im = { arquivo: f.name, titulos: titulos, dados: linhas.slice(1), mapa: adivinhar(titulos) };
        passoColunas();
      }).catch(function (e) { passoArquivo(e && e.message ? e.message : ERROS.arquivo_invalido); });
    });
    mostrar(el('div', { class: 'imp-passo' },
      el('p', { class: 'imp-etapa', text: 'Passo 1 de 3' }),
      el('p', null, 'Escolha uma planilha do Excel (.xlsx) ou um arquivo CSV. A primeira linha precisa ter os títulos das colunas. Até 2.000 contatos por envio.'),
      el('div', { class: 'campo' }, el('label', { for: 'imp-arquivo', text: 'Planilha' }), input),
      el('p', { class: 'dica', text: 'Outro formato? No Excel: Arquivo > Salvar como > CSV. No Google Planilhas: Arquivo > Fazer download > .xlsx.' }),
      el('p', { class: 'dica', text: 'Os contatos só entram na lista depois que a PHAR aprovar o envio.' }),
      msg ? erro(msg) : null));
  }

  function adivinhar(titulos) {
    var norm = titulos.map(semAcento), usado = {}, mapa = {};
    [true, false].forEach(function (exato) {
      CAMPOS.forEach(function (c) {
        if (mapa[c[0]] != null) return;
        c[2].some(function (s) {
          for (var i = 0; i < norm.length; i++) {
            if (usado[i]) continue;
            if (exato ? norm[i] === s : norm[i].indexOf(s) !== -1) { mapa[c[0]] = i; usado[i] = true; return true; }
          }
          return false;
        });
      });
    });
    return mapa;
  }

  function passoColunas(msg) {
    var sels = CAMPOS.map(function (c) {
      var s = el('select', { id: 'imp-map-' + c[0] }, el('option', { value: '', text: 'Não importar' }),
        im.titulos.map(function (t, i) { return el('option', { value: String(i), text: t }); }));
      s.value = im.mapa[c[0]] != null ? String(im.mapa[c[0]]) : '';
      return el('div', { class: 'campo' }, el('label', { for: 'imp-map-' + c[0], text: c[1] }), s);
    });
    var avancar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Ver prévia', onclick: function () {
      im.mapa = {};
      CAMPOS.forEach(function (c) { var v = $('imp-map-' + c[0]).value; if (v !== '') im.mapa[c[0]] = Number(v); });
      if (im.mapa.empresa == null && im.mapa.contato == null) { passoColunas('Escolha a coluna da Empresa ou da Pessoa de contato.'); return; }
      passoPrevia();
    } });
    mostrar(el('div', { class: 'imp-passo' },
      el('p', { class: 'imp-etapa', text: 'Passo 2 de 3' }),
      el('p', null, el('strong', { text: im.arquivo }), ' · ' + plural(im.dados.length, 'linha', 'linhas') + '. Diga de qual coluna da planilha vem cada informação.'),
      el('div', { class: 'grid imp-mapa' }, sels),
      msg ? erro(msg) : null,
      el('div', { class: 'acoes' }, avancar,
        el('button', { class: 'btn btn-sec', type: 'button', text: 'Trocar arquivo', onclick: function () { passoArquivo(); } }))));
  }

  function montar() {
    var itens = ctx.itens(), lista = { cnpj: {}, tel: {}, nome: {} }, visto = { cnpj: {}, tel: {}, nome: {} };
    var r = { linhas: [], semNome: 0, email: 0, cnpj: 0, repLista: 0, repArquivo: 0 };
    itens.forEach(function (p) {
      var k = chaves({ cnpj: p.cnpj || '', telefone: String(p.telefone || '').replace(/\D/g, ''), empresa: p.empresa, contato: p.contato });
      ['cnpj', 'tel', 'nome'].forEach(function (t) { if (k[t]) lista[t][k[t]] = true; });
    });
    im.dados.forEach(function (l) {
      var bruto = {};
      Object.keys(im.mapa).forEach(function (k) { bruto[k] = l[im.mapa[k]]; });
      var x = limpar(bruto), d = x.d;
      if (!d.empresa && !d.contato) { r.semNome++; return; }
      if (x.alertas.email) r.email++;
      if (x.alertas.cnpj) r.cnpj++;
      var k = chaves(d), rep = '';
      ['cnpj', 'tel', 'nome'].forEach(function (t) {
        if (!k[t]) return;
        if (!rep && lista[t][k[t]]) rep = 'lista';
        else if (!rep && visto[t][k[t]]) rep = 'arquivo';
      });
      ['cnpj', 'tel', 'nome'].forEach(function (t) { if (k[t]) visto[t][k[t]] = true; });
      if (rep === 'lista') r.repLista++;
      if (rep === 'arquivo') r.repArquivo++;
      r.linhas.push({ d: d, rep: rep });
    });
    return r;
  }

  function passoPrevia() {
    var r = montar(), campos = CAMPOS.filter(function (c) { return im.mapa[c[0]] != null; });
    var avisos = [];
    if (r.semNome) avisos.push(plural(r.semNome, 'linha sem nome de empresa nem de pessoa fica', 'linhas sem nome de empresa nem de pessoa ficam') + ' de fora.');
    if (r.email) avisos.push(plural(r.email, 'e-mail inválido vai', 'e-mails inválidos vão') + ' em branco.');
    if (r.cnpj) avisos.push(plural(r.cnpj, 'CNPJ inválido vai', 'CNPJs inválidos vão') + ' em branco.');
    if (r.repLista) avisos.push(plural(r.repLista, 'contato parece já estar', 'contatos parecem já estar') + ' na sua lista (mesmo CNPJ, telefone ou nome) e não ' + (r.repLista === 1 ? 'deve entrar.' : 'devem entrar.'));
    if (r.repArquivo) avisos.push(plural(r.repArquivo, 'linha repete', 'linhas repetem') + ' outra da própria planilha; fica só a primeira.');
    var tabela = el('div', { class: 'imp-tabela', tabindex: '0', role: 'region', 'aria-label': 'Prévia das primeiras linhas' },
      el('table', null,
        el('thead', null, el('tr', null, campos.map(function (c) { return el('th', { scope: 'col', text: c[1] }); }), el('th', { scope: 'col', text: '' }))),
        el('tbody', null, r.linhas.slice(0, PREVIA).map(function (x) {
          return el('tr', null, campos.map(function (c) { return el('td', { text: x.d[c[0]] }); }),
            el('td', null, x.rep ? el('span', { class: 'tag imp-rep', text: 'Repetido' }) : null));
        }))));
    var caixa = el('input', { type: 'checkbox', id: 'imp-declaro' });
    var enviar = el('button', { class: 'btn btn-primary', type: 'button', text: 'Enviar para aprovação', disabled: true });
    caixa.addEventListener('change', function () { enviar.disabled = !caixa.checked || !r.linhas.length; });
    var err = el('p', { class: 'erro', role: 'alert', hidden: true });
    enviar.addEventListener('click', function () {
      if (!caixa.checked) return;
      enviar.disabled = true; err.hidden = true;
      var linhas = r.linhas.map(function (x) {
        var o = {}; Object.keys(x.d).forEach(function (k) { if (x.d[k]) o[k] = x.d[k]; }); return o;
      });
      sb.rpc('importacao_enviar', { p_arquivo: im.arquivo, p_linhas: linhas, p_declaro: true }).then(function (res) {
        if (res.error) throw res.error;
        passoEnviado(res.data);
        minhas(ctx);
      }).catch(function (e) {
        err.textContent = ERROS[(e && e.message) || ''] || 'Não deu para enviar agora. Confira sua conexão e tente de novo.';
        err.hidden = false; enviar.disabled = false;
      });
    });
    mostrar(el('div', { class: 'imp-passo' },
      el('p', { class: 'imp-etapa', text: 'Passo 3 de 3' }),
      el('p', null, el('strong', { text: plural(r.linhas.length, 'contato', 'contatos') }), r.linhas.length ? ' para enviar. Veja as primeiras linhas como vão ficar:' : ' para enviar.'),
      r.linhas.length ? tabela : null,
      avisos.length ? el('ul', { class: 'imp-avisos' }, avisos.map(function (a) { return el('li', { text: a }); })) : null,
      el('p', { class: 'dica', text: 'Telefone fica só com números. Na aprovação, a PHAR confere de novo e pula os repetidos. Os contatos entram como "A contatar", com origem "Importação".' }),
      el('label', { class: 'caixa imp-declaro', for: 'imp-declaro' }, caixa,
        el('span', { text: 'Declaro que estes contatos foram obtidos de forma legítima e que posso usá-los para contato comercial.' })),
      err,
      el('div', { class: 'acoes' }, enviar,
        el('button', { class: 'btn btn-sec', type: 'button', text: 'Voltar', onclick: function () { passoColunas(); } }))));
  }

  function passoEnviado(res) {
    var n = (res && res.linhas) || 0;
    mostrar(el('div', { class: 'imp-passo' },
      el('p', { class: 'aviso aviso-ok', text: 'Enviado: ' + plural(n, 'contato aguarda', 'contatos aguardam') + ' a aprovação da PHAR.' }),
      el('p', null, 'Acompanhe em "Minhas importações", na aba Contatos. Depois de aprovados, os contatos aparecem na lista.'),
      el('div', { class: 'acoes' }, el('button', { class: 'btn btn-primary', type: 'button', text: 'Fechar', onclick: function () { $('dlg-importar').close(); } }))));
  }

  // ---------- Minhas importações ----------
  function minhas(c) {
    ctx = c || ctx;
    return sb.rpc('importacoes_minhas').then(function (r) {
      if (r.error) throw r.error;
      desenharMinhas(r.data || []);
    }).catch(function () { /* a lista de importações é um extra: sem ela, a aba Contatos segue normal */ });
  }
  function desenharMinhas(lista) {
    var caixa = $('imp-minhas'), alvo = $('imp-minhas-lista');
    caixa.hidden = !lista.length;
    var pend = lista.filter(function (i) { return i.estado === 'pendente'; }).length;
    $('imp-minhas-resumo').textContent = 'Minhas importações' + (pend ? ' · ' + plural(pend, 'aguardando aprovação', 'aguardando aprovação') : '');
    alvo.textContent = '';
    lista.forEach(function (i) {
      var detalhe = '';
      if (i.estado === 'concluida') detalhe = plural(i.inseridos || 0, 'contato entrou', 'contatos entraram') + (i.pulados ? '; ' + plural(i.pulados, 'repetido ficou', 'repetidos ficaram') + ' de fora.' : '.');
      else if (i.estado === 'recusada') detalhe = 'Motivo: ' + (i.motivo || 'não informado.');
      alvo.append(el('div', { class: 'imp-item' },
        el('div', { class: 'imp-item-topo' },
          el('strong', { text: i.arquivo || 'Planilha sem nome' }),
          el('span', { class: 'tag imp-e-' + i.estado, text: ESTADOS[i.estado] || i.estado })),
        el('div', { class: 'sub', text: 'Enviada em ' + PP.dataHora(i.criado_em) + ' · ' + plural(i.linhas, 'linha', 'linhas') + (ctx && ctx.souDono() ? ' · por ' + i.enviado_por : '') }),
        detalhe ? el('div', { class: 'sub', text: detalhe }) : null));
    });
  }

  function abrir(c) {
    ctx = c; im = null;
    passoArquivo();
    $('dlg-importar').showModal();
  }

  return { abrir: abrir, minhas: minhas };
})();
