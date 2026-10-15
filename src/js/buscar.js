// Aba "Buscar leads": busca empresas na base pública de CNPJ da Receita Federal e adiciona as escolhidas
// à lista de contatos. A base fica em arquivos Parquet no Hugging Face (um por UF, ordenado por município
// e CNAE) e o navegador lê só os pedaços necessários. Nada da base passa pelo Supabase: só os contatos adicionados.
// O app.js chama PPBuscar.abrir(ctx) quando a aba é aberta.
window.PPBuscar = (function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast, PQ = window.PPParquet;
  var BASE = PP.cfg.receita || '';
  var POR_PAGINA = 50, LOTE = 200;
  var PORTES = [['MEI', 'MEI'], ['ME', 'Microempresa (ME)'], ['EPP', 'Pequeno porte (EPP)'], ['DEMAIS', 'Demais']];
  var COLS = ['cnpj', 'fantasia', 'razao', 'cnae', 'cnaes2', 'mun', 'bairro', 'logradouro', 'numero', 'complemento',
    'cep', 'tel1', 'tel2', 'email', 'abertura', 'porte', 'simples'];
  // apelidos comuns que não aparecem nos nomes oficiais dos CNAEs (vale para qualquer ramo)
  var APELIDOS = {
    "academia":["9313100"],
    "dentista":["8630504","8630505"],
    "advogado":["6911701"],
    "advocacia":["6911701"],
    "contador":["6920601"],
    "contabilidade":["6920601"],
    "cabeleireiro":["9602501"],
    "salao de beleza":["9602501","9602502"],
    "manicure":["9602501"],
    "estetica":["9602502"],
    "pet shop":["4789004"],
    "veterinario":["7500100"],
    "padaria":["1091102","4721102"],
    "mecanica":["4520001"],
    "oficina":["4520001"],
    "farmacia":["4771701"],
    "drogaria":["4771701"],
    "imobiliaria":["6821801","6821802"],
    "corretor de imoveis":["6821801"],
    "medico":["8630503","8630502"],
    "clinica":["8630503","8630502","8630501"],
    "escola":["8513900","8520100","8531700"],
    "creche":["8512100"],
    "autoescola":["8599601"],
    "restaurante":["5611201"],
    "lanchonete":["5611203"],
    "bar":["5611205"],
    "mercado":["4711302","4712100"],
    "supermercado":["4711302"],
    "oculos":["4774100"],
    "otica":["4774100"],
    "loja de roupas":["4781400"],
    "material de construcao":["4744099","4744005"],
    "nutricionista":["8650002"],
    "psicologo":["8650003"],
    "fisioterapeuta":["8650004"],
    "fonoaudiologo":["8650006"],
    "personal":["9313100"],
    "pilates":["9313100","8650004"],
    "hotel":["5510801"],
    "pousada":["5590601"],
    "grafica":["1813001","1813099"],
    "transportadora":["4930202","4930201"],
    "marketing":["7319004","7311400"],
    "informatica":["6201501","6209100","9511800"],
    "software":["6201501","6202300","6203100"],
    "engenharia":["7112000"],
    "arquitetura":["7111100"],
    "igreja":["9491000"]
  };
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  var b = {
    ctx: null, iniciado: false, atual: null, municipios: {}, cnaes: [], cnaeNome: {}, arquivos: {}, cache: {},
    bytes: 0, cidades: [], ramos: [], res: null, pagina: 0, linhasPagina: [], marcados: {}, naLista: {}, ocupado: false
  };

  // ---------- utilidades ----------
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function soNumeros(s) { return String(s || '').replace(/\D/g, ''); }
  function cnaeFmt(c) { c = String(c || ''); return c.length === 7 ? c.slice(0, 4) + '-' + c.slice(4, 5) + '/' + c.slice(5) : c; }
  function telFmt(t) {
    t = soNumeros(t);
    if (t.length === 11) return '(' + t.slice(0, 2) + ') ' + t.slice(2, 7) + '-' + t.slice(7);
    if (t.length === 10) return '(' + t.slice(0, 2) + ') ' + t.slice(2, 6) + '-' + t.slice(6);
    return t;
  }
  // celular: 11 números com 9 depois do DDD, ou o formato antigo de 10 números começando com 6 a 9
  // (muito comum na Receita); para o WhatsApp, o formato antigo ganha o 9 na frente.
  function whatsapp(t) {
    t = soNumeros(t);
    if (t.length === 11 && t.charAt(2) === '9') return t;
    if (t.length === 10 && /[6-9]/.test(t.charAt(2))) return t.slice(0, 2) + '9' + t.slice(2);
    return '';
  }
  function dataIso(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.slice(0, 10);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function nomeEmpresa(r) { return (r.fantasia || r.razao || 'Sem nome').trim(); }
  function nomeCidade(uf, cod) {
    var l = b.municipios[uf] || [];
    for (var i = 0; i < l.length; i++) if (l[i].cod === cod) return l[i].nome;
    return cod;
  }
  function endereco(r, uf) {
    var rua = [r.logradouro, r.numero].filter(Boolean).join(', ');
    return [rua, r.complemento, r.bairro, nomeCidade(uf, r.mun) + '/' + uf, r.cep ? PP.cepFormatado(r.cep) : ''].filter(Boolean).join(' · ');
  }
  function erro(msg) { var e = $('bz-erro'); e.textContent = msg || ''; e.hidden = !msg; }
  function status(msg) { $('bz-status').textContent = msg || ''; }
  function getJson(caminho) {
    return fetch(BASE + caminho, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('base ' + r.status);
      return r.json();
    });
  }

  // ---------- leitura do Parquet por faixa de bytes ----------
  // O Hugging Face redireciona para o CDN; guardamos o endereço final para não repetir o redirecionamento.
  function arquivo(uf) {
    if (b.arquivos[uf]) return b.arquivos[uf];
    var url = BASE + b.atual.mes + '/uf=' + uf + '.parquet', final = null, total = b.atual.ufs[uf].bytes;
    function pedir(ini, fim, tentativa) {
      return fetch(final || url, { headers: { Range: 'bytes=' + ini + '-' + (fim - 1) } }).then(function (r) {
        if (r.status !== 206 && r.status !== 200) {
          if (final && !tentativa) { final = null; return pedir(ini, fim, 1); } // endereço do CDN expirou
          throw new Error('leitura ' + r.status);
        }
        if (r.url && r.url !== url) final = r.url;
        return r.arrayBuffer().then(function (buf) {
          b.bytes += buf.byteLength;
          return r.status === 200 ? buf.slice(ini, fim) : buf;
        });
      });
    }
    var file = { byteLength: total, slice: function (ini, fim) { return pedir(ini, fim === undefined ? total : fim, 0); } };
    b.arquivos[uf] = PQ.metadados(file).then(function (meta) { return { file: file, meta: meta }; });
    b.arquivos[uf].catch(function () { delete b.arquivos[uf]; });
    return b.arquivos[uf];
  }
  // linhas [ini, fim) só das colunas pedidas; guarda em memória enquanto a página está aberta
  function ler(uf, ini, fim, colunas) {
    var chave = uf + '|' + ini + '|' + fim + '|' + colunas.join(',');
    if (!b.cache[chave]) {
      b.cache[chave] = arquivo(uf).then(function (a) {
        return PQ.lerObjetos({ file: a.file, metadata: a.meta, rowStart: ini, rowEnd: fim, columns: colunas, compressors: PQ.compressores });
      });
      b.cache[chave].catch(function () { delete b.cache[chave]; });
    }
    return b.cache[chave];
  }

  // ---------- início: lê atual.json, municípios e CNAEs ----------
  function iniciar() {
    if (b.iniciado) return Promise.resolve();
    if (!BASE || !PQ) return Promise.reject(new Error('sem base'));
    return getJson('atual.json').then(function (atual) {
      b.atual = atual;
      return Promise.all([getJson(atual.mes + '/municipios.json'), getJson(atual.mes + '/cnaes.json')]);
    }).then(function (r) {
      b.municipios = r[0]; b.cnaes = r[1];
      b.cnaes.forEach(function (c) { b.cnaeNome[c.cod] = c.nome; });
      var ufs = Object.keys(b.atual.ufs).sort(), sel = $('bz-uf');
      sel.replaceChildren();
      ufs.forEach(function (u) { sel.append(el('option', { value: u, text: u })); });
      var p = b.atual.mes.split('-'), total = 0;
      ufs.forEach(function (u) { total += b.atual.ufs[u].linhas; });
      $('bz-base').textContent = 'Base da Receita de ' + MESES[Number(p[1]) - 1] + ' de ' + p[0] + ' · ' +
        ufs.join(', ') + ' · ' + total.toLocaleString('pt-BR') + ' empresas ativas.';
      var dl = $('bz-ramos'); dl.replaceChildren();
      Object.keys(APELIDOS).forEach(function (k) { dl.append(el('option', { value: k })); });
      b.cnaes.forEach(function (c) { dl.append(el('option', { value: cnaeFmt(c.cod) + ' ' + c.nome })); });
      trocarUf();
      b.iniciado = true;
      $('bz-buscar').disabled = false;
    });
  }
  function trocarUf() {
    var dl = $('bz-cidades'); dl.replaceChildren();
    (b.municipios[$('bz-uf').value] || []).forEach(function (m) { dl.append(el('option', { value: m.nome })); });
    b.cidades = []; desenharEscolhas();
  }

  // ---------- cidades e ramos escolhidos (chips com botão de tirar) ----------
  function escolherCidade() {
    var v = semAcento($('bz-cidade').value.trim()); if (!v) return;
    var l = b.municipios[$('bz-uf').value] || [], achou = null, i;
    for (i = 0; i < l.length; i++) if (semAcento(l[i].nome) === v) { achou = l[i]; break; }
    if (!achou) { toast('Escolha uma cidade da lista'); return; }
    if (!b.cidades.some(function (c) { return c.cod === achou.cod; })) b.cidades.push(achou);
    $('bz-cidade').value = ''; desenharEscolhas();
  }
  function escolherRamo() {
    var v = $('bz-ramo').value.trim(); if (!v) return;
    var cod = soNumeros(v.split(' ')[0]), achados;
    if (cod.length === 7 && b.cnaeNome[cod]) achados = [cod];
    else if (APELIDOS[semAcento(v)]) achados = APELIDOS[semAcento(v)].filter(function (c) { return b.cnaeNome[c]; });
    else {
      // cada palavra digitada precisa começar uma palavra do nome ("condicionamento" não pega "acondicionamento")
      var palavras = semAcento(v).split(/\s+/).filter(Boolean);
      achados = b.cnaes.filter(function (c) {
        var nome = ' ' + semAcento(c.nome).replace(/[^a-z0-9]+/g, ' ');
        return palavras.every(function (p) { return nome.indexOf(' ' + p) !== -1; }) || (cod.length >= 4 && c.cod.indexOf(cod) === 0);
      })
        .map(function (c) { return c.cod; });
    }
    if (!achados.length) { toast('Nenhuma atividade com esse nome ou código'); return; }
    if (achados.length > 40) { toast('Achei ' + achados.length + ' atividades. Seja mais específico.'); return; }
    achados.forEach(function (c) { if (b.ramos.indexOf(c) === -1) b.ramos.push(c); });
    $('bz-ramo').value = ''; desenharEscolhas();
  }
  function chip(texto, tirar) {
    return el('button', { class: 'chip bz-chip', type: 'button', title: 'Tirar', 'aria-label': 'Tirar ' + texto, onclick: tirar }, texto, el('span', { 'aria-hidden': 'true', text: ' ×' }));
  }
  function desenharEscolhas() {
    $('bz-cidades-escolhidas').replaceChildren.apply($('bz-cidades-escolhidas'), b.cidades.map(function (c) {
      return chip(c.nome + ' (' + c.n.toLocaleString('pt-BR') + ')', function () {
        b.cidades = b.cidades.filter(function (x) { return x !== c; }); desenharEscolhas();
      });
    }));
    $('bz-ramos-escolhidos').replaceChildren.apply($('bz-ramos-escolhidos'), b.ramos.map(function (c) {
      return chip(cnaeFmt(c) + ' ' + (b.cnaeNome[c] || ''), function () {
        b.ramos = b.ramos.filter(function (x) { return x !== c; }); desenharEscolhas();
      });
    }));
  }

  // ---------- busca ----------
  function filtros() {
    var portes = [];
    document.querySelectorAll('#bz-portes input:checked').forEach(function (c) { portes.push(c.value); });
    return {
      uf: $('bz-uf').value, cidades: b.cidades.slice(), ramos: b.ramos.slice(), secundario: $('bz-secundario').checked,
      nome: semAcento($('bz-nome').value.trim()), cnpj: PP.docLimpo($('bz-cnpj').value), bairro: semAcento($('bz-bairro').value.trim()),
      de: $('bz-de').value, ate: $('bz-ate').value, portes: portes, tel: $('bz-tel').checked, email: $('bz-email').checked
    };
  }
  // colunas que os filtros precisam (fase 1 lê só estas, que são leves)
  function colunasFiltro(f) {
    var c = ['cnae'];
    if (f.ramos.length && f.secundario) c.push('cnaes2');
    if (f.nome) c.push('fantasia', 'razao');
    if (f.cnpj) c.push('cnpj');
    if (f.bairro) c.push('bairro');
    if (f.de || f.ate) c.push('abertura');
    if (f.portes.length) c.push('porte');
    if (f.tel) c.push('tel1');
    if (f.email) c.push('email');
    return c;
  }
  function passa(r, f, ramos) {
    if (f.ramos.length) {
      var ok = ramos[r.cnae];
      if (!ok && f.secundario && r.cnaes2) ok = r.cnaes2.split(',').some(function (c) { return ramos[c.trim()]; });
      if (!ok) return false;
    }
    if (f.cnpj && r.cnpj !== f.cnpj) return false;
    if (f.nome && semAcento((r.fantasia || '') + ' ' + (r.razao || '')).indexOf(f.nome) === -1) return false;
    if (f.bairro && semAcento(r.bairro).indexOf(f.bairro) === -1) return false;
    if (f.de || f.ate) {
      var d = dataIso(r.abertura);
      if (!d || (f.de && d < f.de) || (f.ate && d > f.ate)) return false;
    }
    if (f.portes.length && f.portes.indexOf(r.porte || '') === -1) return false;
    if (f.tel && !r.tel1) return false;
    if (f.email && !r.email) return false;
    return true;
  }
  // Com CNAE só principal, a cidade está ordenada por CNAE: lê primeiro só a coluna cnae
  // e estreita a faixa para os trechos daquele ramo antes de ler o resto.
  function faixasDaCidade(uf, c, f, ramos) {
    var ini = c.i, fim = c.i + c.n;
    if (!f.ramos.length || f.secundario) return Promise.resolve([[ini, fim]]);
    return ler(uf, ini, fim, ['cnae']).then(function (linhas) {
      var faixas = [], a = -1;
      for (var k = 0; k <= linhas.length; k++) {
        var dentro = k < linhas.length && ramos[linhas[k].cnae];
        if (dentro && a < 0) a = k;
        if (!dentro && a >= 0) { faixas.push([ini + a, ini + k]); a = -1; }
      }
      return faixas;
    });
  }
  function buscar(ev) {
    if (ev) ev.preventDefault();
    if (b.ocupado) return;
    erro('');
    var f = filtros();
    if (!f.cidades.length && !f.cnpj) { erro('Escolha pelo menos uma cidade (ou informe um CNPJ).'); return; }
    if (f.cnpj && !PP.docValido(f.cnpj)) { erro('Esse CNPJ não é válido. Confira os números.'); return; }
    b.ocupado = true; $('bz-buscar').disabled = true; $('bz-resultado').hidden = true;
    var inicioBytes = b.bytes, t0 = Date.now();
    status('Buscando…');
    var cidades = f.cidades;
    var passo = Promise.resolve();
    if (!cidades.length) {
      // só CNPJ: a BrasilAPI diz em que cidade ele está (código de município da própria Receita)
      passo = fetch('https://brasilapi.com.br/api/cnpj/v1/' + f.cnpj).then(function (r) {
        if (r.status === 404) throw new Error('cnpj-nao-existe');
        if (!r.ok) throw new Error('brasilapi');
        return r.json();
      }).then(function (d) {
        var cod = String(d.codigo_municipio || '').padStart(4, '0'), uf = d.uf;
        var lista = b.municipios[uf];
        if (!lista) throw new Error('uf-fora:' + uf);
        f.uf = uf;
        cidades = lista.filter(function (m) { return m.cod === cod; });
        if (!cidades.length) throw new Error('cnpj-fora');
      });
    }
    var ramos = {};
    f.ramos.forEach(function (c) { ramos[c] = true; });
    passo.then(function () {
      var cols = colunasFiltro(f);
      return Promise.all(cidades.map(function (c) {
        return faixasDaCidade(f.uf, c, f, ramos).then(function (faixas) {
          return Promise.all(faixas.map(function (fx) {
            return ler(f.uf, fx[0], fx[1], cols).then(function (linhas) {
              var idx = [];
              for (var k = 0; k < linhas.length; k++) if (passa(linhas[k], f, ramos)) idx.push(fx[0] + k);
              return idx;
            });
          }));
        });
      }));
    }).then(function (porCidade) {
      var idx = [];
      porCidade.forEach(function (fs) { fs.forEach(function (l) { idx = idx.concat(l); }); });
      b.res = { uf: f.uf, idx: idx };
      b.pagina = 0; b.marcados = {};
      return mostrarPagina();
    }).then(function () {
      status('Pronto em ' + ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s · ' + kb(b.bytes - inicioBytes) + ' lidos da base.');
    }).catch(function (e) {
      var m = String(e && e.message || '');
      status('');
      if (m === 'cnpj-nao-existe') erro('Esse CNPJ não existe na Receita.');
      else if (m === 'cnpj-fora') erro('Esse CNPJ não está na base: a empresa não está ativa.');
      else if (m.indexOf('uf-fora:') === 0) erro('Esse CNPJ é de ' + m.slice(8) + ', que ainda não está na base. Hoje a base cobre ' + Object.keys(b.atual.ufs).join(', ') + '.');
      else if (m === 'brasilapi') erro('A consulta de CNPJ não respondeu. Tente de novo ou escolha a cidade.');
      else erro('Não deu para ler a base agora. Confira sua conexão e tente de novo.');
    }).then(function () { b.ocupado = false; $('bz-buscar').disabled = !b.iniciado; });
  }

  // ---------- página de resultado ----------
  // lê as colunas completas só das linhas desta página, juntando linhas próximas numa leitura só
  function mostrarPagina() {
    var r = b.res, ini = b.pagina * POR_PAGINA, idx = r.idx.slice(ini, ini + POR_PAGINA), trechos = [], t = null;
    idx.forEach(function (i) {
      if (t && i - t[1] <= 500) t[1] = i + 1; else { t = [i, i + 1]; trechos.push(t); }
    });
    return Promise.all(trechos.map(function (tr) { return ler(r.uf, tr[0], tr[1], COLS); })).then(function (partes) {
      var porIdx = {};
      trechos.forEach(function (tr, k) { partes[k].forEach(function (linha, j) { porIdx[tr[0] + j] = linha; }); });
      b.linhasPagina = idx.map(function (i) { return porIdx[i]; }).filter(Boolean);
      var cnpjs = b.linhasPagina.map(function (l) { return l.cnpj; });
      if (!cnpjs.length) return null;
      return sb.rpc('prospects_cnpjs_existentes', { p_cnpjs: cnpjs }).then(function (res) {
        if (!res.error) (res.data || []).forEach(function (c) { b.naLista[c] = true; });
      });
    }).then(desenharResultado);
  }
  function desenharResultado() {
    var r = b.res, total = r.idx.length, lista = $('bz-lista'), uf = r.uf;
    $('bz-resultado').hidden = false;
    lista.replaceChildren();
    if (!total) {
      $('bz-contagem').textContent = 'Nenhuma empresa com esses filtros.';
      lista.append(el('div', { class: 'vazio' }, el('h2', { text: 'Nada encontrado' }), el('p', { text: 'Tire algum filtro ou escolha mais cidades.' })));
    } else {
      var ini = b.pagina * POR_PAGINA;
      $('bz-contagem').textContent = total.toLocaleString('pt-BR') + (total === 1 ? ' empresa' : ' empresas') +
        ' · mostrando ' + (ini + 1) + '–' + (ini + b.linhasPagina.length);
      lista.setAttribute('role', 'list');
      b.linhasPagina.forEach(function (l) { lista.append(linhaResultado(l, uf)); });
    }
    var paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    $('bz-pagina').textContent = 'Página ' + (b.pagina + 1) + ' de ' + paginas.toLocaleString('pt-BR');
    $('bz-anterior').disabled = b.pagina === 0;
    $('bz-proxima').disabled = b.pagina + 1 >= paginas;
    $('bz-paginas').hidden = paginas <= 1;
    atualizarBotoes();
  }
  function linhaResultado(l, uf) {
    var ja = !!b.naLista[l.cnpj];
    var caixa = el('input', { type: 'checkbox', 'aria-label': 'Marcar ' + nomeEmpresa(l), disabled: ja || !b.ctx.pode('criar') });
    caixa.checked = !!b.marcados[l.cnpj];
    caixa.addEventListener('change', function () {
      if (caixa.checked) b.marcados[l.cnpj] = { linha: l, uf: uf }; else delete b.marcados[l.cnpj];
      atualizarBotoes();
    });
    var tels = [l.tel1, l.tel2].filter(Boolean).map(function (t) {
      var w = whatsapp(t);
      return w
        ? el('span', null, telFmt(t), ' · ', el('a', { href: 'https://wa.me/55' + w, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp' }))
        : el('span', { text: telFmt(t) });
    });
    var aberta = dataIso(l.abertura);
    return el('div', { class: 'bz-linha' + (ja ? ' bz-ja' : ''), role: 'listitem' },
      el('div', { class: 'bz-marca' }, caixa),
      el('div', { class: 'bz-dados' },
        el('div', { class: 'bz-nome' },
          el('span', { class: 'nome', text: nomeEmpresa(l) }),
          l.porte === 'MEI' ? el('span', { class: 'tag bz-mei', text: 'MEI', title: 'Pessoa física: telefone e e-mail são dado pessoal' }) : null,
          l.porte && l.porte !== 'MEI' ? el('span', { class: 'tag bz-porte', text: l.porte === 'DEMAIS' ? 'Demais' : l.porte }) : null,
          ja ? el('span', { class: 'tag bz-tag-ja', text: 'Já na lista' }) : null),
        l.fantasia && l.razao && l.fantasia !== l.razao ? el('div', { class: 'sub', text: l.razao }) : null,
        el('div', { class: 'sub', text: 'CNPJ ' + PP.docFormatado(l.cnpj) + (aberta ? ' · aberta em ' + PP.dataCurta(aberta) : '') }),
        el('div', { class: 'sub', text: cnaeFmt(l.cnae) + ' ' + (b.cnaeNome[l.cnae] || '') }),
        el('div', { class: 'sub', text: endereco(l, uf) })),
      el('div', { class: 'bz-contato' },
        tels.length ? el('div', { class: 'sub' }, tels.reduce(function (acc, n, i) { if (i) acc.push(el('br')); acc.push(n); return acc; }, [])) : el('div', { class: 'sub', text: 'Sem telefone' }),
        l.email ? el('div', { class: 'sub', text: l.email }) : null));
  }
  function atualizarBotoes() {
    var n = Object.keys(b.marcados).length, btn = $('bz-adicionar');
    btn.disabled = !n || b.ocupado;
    btn.hidden = !b.ctx.pode('criar');
    btn.textContent = n ? 'Adicionar à minha lista (' + n + ')' : 'Adicionar à minha lista';
    var livres = b.linhasPagina.filter(function (l) { return !b.naLista[l.cnpj]; });
    $('bz-todos').checked = livres.length > 0 && livres.every(function (l) { return b.marcados[l.cnpj]; });
    $('bz-todos').disabled = !livres.length || !b.ctx.pode('criar');
  }
  function marcarTodos() {
    var marcar = $('bz-todos').checked, uf = b.res.uf;
    b.linhasPagina.forEach(function (l) {
      if (b.naLista[l.cnpj]) return;
      if (marcar) b.marcados[l.cnpj] = { linha: l, uf: uf }; else delete b.marcados[l.cnpj];
    });
    desenharResultado();
  }

  // ---------- adicionar à lista ----------
  function paraContato(m) {
    var l = m.linha, uf = m.uf, nomeCnae = b.cnaeNome[l.cnae] || '';
    return {
      empresa: nomeEmpresa(l).slice(0, 120), telefone: telFmt(l.tel1 || l.tel2 || ''), email: l.email || '',
      cidade: nomeCidade(uf, l.mun), uf: uf, segmento: nomeCnae.slice(0, 80),
      porte: ({ MEI: 'MEI', ME: 'Microempresa', EPP: 'Pequeno porte', DEMAIS: 'Demais' })[l.porte] || '',
      origem: 'Base da Receita', cnpj: l.cnpj, razao_social: l.razao || '', cnae: l.cnae || '', situacao: 'ATIVA',
      abertura: dataIso(l.abertura) || null, porte_receita: l.porte || '', endereco: endereco(l, uf).slice(0, 250)
    };
  }
  function adicionar() {
    var lista = Object.keys(b.marcados).map(function (k) { return b.marcados[k]; });
    if (!lista.length || b.ocupado) return;
    b.ocupado = true; atualizarBotoes();
    var inseridos = 0, pulados = 0, i = 0;
    function proximo() {
      if (i >= lista.length) return Promise.resolve();
      var lote = lista.slice(i, i + LOTE); i += LOTE;
      return sb.rpc('prospects_adicionar_lote', { p_linhas: lote.map(paraContato) }).then(function (r) {
        if (r.error) { r.error.status = r.status; throw r.error; }
        inseridos += r.data.inseridos; pulados += r.data.pulados;
        lote.forEach(function (m) { b.naLista[m.linha.cnpj] = true; delete b.marcados[m.linha.cnpj]; });
        return proximo();
      });
    }
    proximo().then(function () {
      toast(inseridos + (inseridos === 1 ? ' empresa adicionada' : ' empresas adicionadas') + (pulados ? ' · ' + pulados + ' já estavam na lista' : ''));
      b.ctx.recarregar();
    }).catch(function (e) {
      erro(b.ctx.msgErro(e) + (inseridos ? ' (' + inseridos + ' foram adicionadas antes do erro.)' : ''));
    }).then(function () { b.ocupado = false; desenharResultado(); });
  }

  function limpar() {
    $('bz-form').reset(); b.cidades = []; b.ramos = []; desenharEscolhas(); erro(''); status('');
  }

  // ---------- ligações ----------
  PORTES.forEach(function (p) {
    $('bz-portes').append(el('label', { class: 'chip' }, el('input', { type: 'checkbox', value: p[0] }), p[1]));
  });
  $('bz-buscar').disabled = true; // até a base carregar
  $('bz-form').addEventListener('submit', buscar);
  $('bz-uf').addEventListener('change', trocarUf);
  $('bz-cidade').addEventListener('change', escolherCidade);
  $('bz-cidade').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); escolherCidade(); } });
  $('bz-ramo').addEventListener('change', escolherRamo);
  $('bz-ramo').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); escolherRamo(); } });
  $('bz-cnpj').addEventListener('blur', function () { if (PP.docLimpo(this.value).length === 14) this.value = PP.docFormatado(this.value); });
  $('bz-limpar').addEventListener('click', limpar);
  $('bz-todos').addEventListener('change', marcarTodos);
  $('bz-adicionar').addEventListener('click', adicionar);
  $('bz-anterior').addEventListener('click', function () { if (b.pagina > 0) { b.pagina--; mostrarPagina(); } });
  $('bz-proxima').addEventListener('click', function () { b.pagina++; mostrarPagina(); });

  return {
    // ctx: { pode(chave), recarregar(), msgErro(e) } vindo do app.js
    abrir: function (ctx) {
      b.ctx = ctx;
      if (b.iniciado) return;
      iniciar().catch(function () {
        $('bz-base').textContent = '';
        erro(BASE ? 'Não deu para abrir a base da Receita agora. Tente de novo em alguns minutos.' : 'A base da Receita ainda não foi publicada.');
      });
    }
  };
})();
