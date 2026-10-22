// Painel administrativo: todas as empresas, liberar e bloquear, simular acesso, gráficos gerais e backup.
// Só funciona para quem é admin; a checagem de verdade acontece no banco (funções admin_*).
(function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast, G = PP.graficos;
  var ROTULO = { pendente: 'Aguardando', ativa: 'Ativa', bloqueada: 'Bloqueada' };
  var st = { empresas: [], painel: null, modo: 'carregando', filtro: '', q: '', confirmando: '' };

  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function checar(r) { if (r.error) { r.error.status = r.status; throw r.error; } return r.data; }
  function tela(qual) {
    $('tela-carregando').hidden = qual !== 'carregando';
    $('tela-estado').hidden = qual !== 'estado';
    $('tela-admin').hidden = qual !== 'admin';
  }
  function estado(titulo, texto) { $('estado-titulo').textContent = titulo; $('estado-texto').textContent = texto; tela('estado'); }

  function carregar() {
    return Promise.all([sb.rpc('admin_empresas'), sb.rpc('admin_painel')]).then(function (r) {
      st.empresas = checar(r[0]) || []; st.painel = checar(r[1]); st.modo = 'ok'; $('aviso-erro').hidden = true; render();
    }).catch(function () {
      var a = $('aviso-erro'); a.textContent = 'Não deu para carregar o painel. Clique em Atualizar.'; a.hidden = false;
      if (st.modo === 'carregando') { st.modo = 'erro'; render(); }
    });
  }

  function mudar(emp, novo, feito) {
    st.confirmando = '';
    sb.rpc('admin_empresa_status', { alvo: emp.id, novo: novo }).then(function (r) { checar(r); toast(feito); return carregar(); })
      .catch(function () { toast('Não deu para alterar esta empresa agora'); render(); });
  }
  function simular(emp) {
    sb.rpc('admin_simular', { alvo: emp.id }).then(function (r) { checar(r); window.location.href = '/app'; })
      .catch(function () { toast('Não deu para abrir a simulação agora'); });
  }
  function pararSimulacao() {
    sb.rpc('admin_simular', { alvo: null }).then(function (r) { checar(r); $('faixa-simulando').hidden = true; toast('Simulação encerrada'); })
      .catch(function () { toast('Não deu para sair da simulação. Tente de novo.'); });
  }

  // exportação de contatos da empresa: travada por padrão; liberar sem prazo, por 24 horas ou bloquear
  function exportacao(e, modo, feito) {
    sb.rpc('admin_exportacao', { alvo: e.id, modo: modo }).then(function (r) { checar(r); toast(feito); return carregar(); })
      .catch(function () { toast('Não deu para alterar a exportação agora'); });
  }
  var fmtPrazo = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function prazo(s) { var d = new Date(s); return isNaN(d) ? '' : fmtPrazo.format(d).replace(',', ' às'); }
  function seloExportacao(e) {
    if (e.exportacao_ok) return el('span', { class: 'tag c-ativa', text: e.exportacao_ate ? 'Liberada até ' + prazo(e.exportacao_ate) : 'Liberada sem prazo' });
    if (e.exportacao_liberada && e.exportacao_ate) return el('span', { class: 'tag c-pendente', text: 'Prazo vencido em ' + prazo(e.exportacao_ate) });
    return el('span', { class: 'tag c-bloqueada', text: 'Bloqueada' });
  }
  function blocoExportacao(e) {
    var semPrazo = e.exportacao_ok && !e.exportacao_ate, botoes = [];
    if (!semPrazo) botoes.push(el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Liberar sem prazo', onclick: function () { exportacao(e, 'liberar', 'Exportação liberada sem prazo'); } }));
    botoes.push(el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: e.exportacao_ok && e.exportacao_ate ? 'Mais 24 horas' : 'Liberar por 24 horas',
      onclick: function () { exportacao(e, 'liberar_24h', 'Exportação liberada por 24 horas'); } }));
    if (e.exportacao_ok) botoes.push(el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Bloquear exportação', onclick: function () { exportacao(e, 'bloquear', 'Exportação bloqueada'); } }));
    return el('div', { class: 'adm-export' },
      el('span', { class: 'adm-export-rot', text: 'Exportação de contatos' }), seloExportacao(e),
      el('div', { class: 'adm-export-acoes' }, botoes));
  }

  function acoes(e) {
    if (e.propria) return el('span', { class: 'dica', text: 'Sua empresa' });
    if (st.confirmando === e.id) return [
      el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Sim, bloquear', onclick: function () { mudar(e, 'bloqueada', 'Empresa bloqueada'); } }),
      el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Manter', onclick: function () { st.confirmando = ''; render(); } })
    ];
    var botoes = [];
    if (e.status === 'pendente') botoes.push(
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Liberar', onclick: function () { mudar(e, 'ativa', 'Empresa liberada'); } }),
      el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Recusar', onclick: function () { st.confirmando = e.id; render(); } }));
    else if (e.status === 'ativa') botoes.push(
      el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Bloquear', onclick: function () { st.confirmando = e.id; render(); } }));
    else botoes.push(
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Reativar', onclick: function () { mudar(e, 'ativa', 'Empresa reativada'); } }));
    botoes.push(el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Simular', onclick: function () { simular(e); } }));
    return botoes;
  }

  function linha(e) {
    var membros = e.membros || [], dono = membros.filter(function (m) { return m.papel === 'dono'; })[0] || membros[0];
    var semConfirmar = membros.filter(function (m) { return !m.email_confirmado; }).length;
    var acesso = e.ultimo_acesso ? 'Último acesso: ' + PP.dataHora(e.ultimo_acesso) : 'Ninguém entrou ainda';
    var doc = PP.docLimpo(e.documento), local = [e.cidade, e.uf].filter(Boolean).join('/');
    var cadastro = [doc ? (doc.length === 11 ? 'CPF ' : 'CNPJ ') + PP.docFormatado(doc) : '', local, e.telefone].filter(Boolean).join(' · ');
    var nomes = membros.map(function (m) { return (m.nome || m.email) + (m.papel === 'dono' ? ' (responsável)' : ''); }).join(', ');
    return el('div', { class: 'adm-linha', role: 'listitem' },
      el('div', { class: 'a-nome' },
        el('div', { class: 'nome', text: e.nome }),
        dono ? el('div', { class: 'sub', text: dono.email }) : el('div', { class: 'sub', text: 'Sem usuários' }),
        cadastro ? el('div', { class: 'sub', text: cadastro }) : null,
        e.completo ? null : el('div', { class: 'sub adm-falta', text: 'Cadastro incompleto' })),
      el('div', { class: 'a-email' },
        el('div', { class: 'adm-membros', text: membros.length ? (membros.length === 1 ? '1 usuário: ' : membros.length + ' usuários: ') + nomes : 'Nenhum usuário' }),
        e.convites ? el('div', { class: 'sub', text: e.convites + (e.convites === 1 ? ' e-mail autorizado sem cadastro' : ' e-mails autorizados sem cadastro') }) : null,
        semConfirmar ? el('div', { class: 'sub', text: semConfirmar === 1 ? '1 e-mail ainda não confirmado' : semConfirmar + ' e-mails ainda não confirmados' }) : null),
      el('div', { class: 'sub num-col' }, PP.dataHora(e.criado_em), el('div', { text: acesso })),
      el('div', { class: 'num-col rot', 'data-rot': 'Contatos', text: String(e.contatos) }),
      el('div', null, el('span', { class: 'tag c-' + e.status, text: ROTULO[e.status] || e.status })),
      el('div', { class: 'adm-acoes' }, acoes(e)),
      blocoExportacao(e));
  }

  function renderGraficos() {
    var p = st.painel;
    if (!p) { $('graf-status').replaceChildren(); $('graf-crescimento').replaceChildren(); return; }
    var porDia = {};
    (p.contatos_dias || []).forEach(function (d) { porDia[d.dia] = Number(d.n) || 0; });
    G.rosca($('graf-status'), G.fatiasDeStatus(p.por_status || {}), { titulo: 'Contatos por status, todas as empresas', vazio: 'Nenhuma empresa cadastrou contatos ainda.' });
    G.linha($('graf-crescimento'), G.acumulado(porDia, PP.hoje()), { titulo: 'Crescimento da base', unidade: 'contatos', vazio: 'O gráfico aparece quando houver contatos cadastrados.' });
  }

  function render() {
    var n = { pendente: 0, ativa: 0, bloqueada: 0 }, total = 0, lista = $('lista'), pronto = st.modo === 'ok';
    st.empresas.forEach(function (e) { if (n[e.status] != null) n[e.status]++; total += Number(e.contatos) || 0; });
    $('n-pendente').textContent = pronto ? n.pendente : '–';
    $('n-ativa').textContent = pronto ? n.ativa : '–';
    $('n-usuarios').textContent = pronto && st.painel ? st.painel.usuarios : '–';
    $('n-contatos').textContent = pronto ? total : '–';
    document.querySelectorAll('button.stat').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filtro === st.filtro)); });
    lista.replaceChildren(); lista.removeAttribute('role');
    $('btn-limpar').hidden = true;
    if (st.modo === 'carregando') { $('contagem').textContent = 'Carregando empresas…'; return; }
    if (st.modo === 'erro') { $('contagem').textContent = ''; return; }
    renderGraficos();
    var q = semAcento(st.q.trim());
    var vis = st.empresas.filter(function (e) {
      if (st.filtro && e.status !== st.filtro) return false;
      if (!q) return true;
      var alvo = [e.nome, e.razao_social, e.documento, PP.docFormatado(e.documento), e.cidade, e.uf, e.segmento, e.telefone].concat((e.membros || []).map(function (m) { return m.nome + ' ' + m.email; })).join(' ');
      return semAcento(alvo).indexOf(q) !== -1;
    });
    var filtrando = !!(st.filtro || q), todas = st.empresas.length;
    $('contagem').textContent = (filtrando ? 'Mostrando ' + vis.length + ' de ' + todas : String(todas)) + (todas === 1 ? ' empresa' : ' empresas')
      + (n.bloqueada ? ' · ' + n.bloqueada + (n.bloqueada === 1 ? ' bloqueada' : ' bloqueadas') : '');
    $('btn-limpar').hidden = !filtrando;
    if (!vis.length) {
      lista.append(el('div', { class: 'vazio' }, el('h2', { text: 'Nenhuma empresa neste filtro' }),
        el('p', { text: 'Quando alguém criar conta na página de entrada, a empresa aparece aqui para você liberar.' })));
      return;
    }
    lista.setAttribute('role', 'list');
    vis.forEach(function (e) { lista.append(linha(e)); });
  }

  // ---------- backup ----------
  function backup() {
    var btn = $('btn-backup'); btn.disabled = true;
    sb.rpc('admin_exportar').then(function (r) {
      var empresas = checar(r) || [];
      var cols = [['Empresa (conta)', null], ['CNPJ ou CPF (conta)', '#doc'], ['Contato: empresa', 'empresa'], ['Pessoa', 'contato'], ['Cargo', 'cargo'], ['Telefone', 'telefone'], ['E-mail', 'email'],
        ['Cidade', 'cidade'], ['UF', 'uf'], ['Segmento', 'segmento'], ['Porte', 'porte'], ['Origem', 'origem'], ['Site ou Instagram', 'link'], ['Interesse', 'interesse'],
        ['Status', 'status'], ['Último contato', 'ultimo_contato'], ['Próximo contato', 'proximo_contato'], ['Observações', 'observacoes'], ['Histórico', 'historico'],
        ['Cadastrado por', 'cadastrado_por'], ['Responsável', 'responsavel'], ['Cliente desde', 'cliente_desde'], ['Cadastrado em', 'criado_em']];
      function cel(v) {
        v = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return '"' + v.replace(/"/g, '""') + '"';
      }
      var linhas = [cols.map(function (c) { return cel(c[0]); }).join(';')], total = 0;
      empresas.forEach(function (e) {
        (e.contatos || []).forEach(function (x) {
          total++;
          linhas.push(cols.map(function (c) {
            if (!c[1]) return cel(e.nome);
            if (c[1] === '#doc') return cel(PP.docFormatado((e.cadastro || {}).documento));
            var v = x[c[1]];
            if (c[1] === 'historico') v = (v || []).map(function (h) { return [h.data, h.canal, h.nota].filter(Boolean).join(' - '); }).join(' | ');
            return cel(v);
          }).join(';'));
        });
      });
      if (!total) { toast('Ainda não há contatos para o backup'); return; }
      var url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      var a = el('a', { href: url, download: 'backup-phar-prospector-' + PP.hoje() + '.csv' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Backup baixado: ' + total + (total === 1 ? ' contato' : ' contatos'));
    }).catch(function () { toast('Não deu para gerar o backup agora'); })
      .then(function () { btn.disabled = false; });
  }

  document.querySelectorAll('button.stat').forEach(function (b) {
    b.addEventListener('click', function () { st.filtro = st.filtro === b.dataset.filtro ? '' : b.dataset.filtro; render(); });
  });
  $('q').addEventListener('input', function () { st.q = this.value; render(); });
  $('btn-limpar').addEventListener('click', function () { st.filtro = ''; st.q = ''; $('q').value = ''; render(); });
  $('btn-atualizar').addEventListener('click', function () { carregar().then(function () { toast('Painel atualizado'); }); });
  $('btn-backup').addEventListener('click', backup);
  $('btn-sair-simulacao').addEventListener('click', pararSimulacao);
  document.querySelectorAll('[data-sair]').forEach(function (b) { b.addEventListener('click', PP.sair); });
  sb.auth.onAuthStateChange(function (evento) { if (evento === 'SIGNED_OUT') PP.irPara('/entrar?destino=admin'); });

  PP.sessao().then(function (s) {
    if (!s) { PP.irPara('/entrar?destino=admin'); return null; }
    return PP.sessaoApp().then(function (ses) {
      var u = ses && ses.usuario;
      if (!u || !u.is_admin) {
        estado('Área restrita', 'Este painel é só para a administração do sistema. Sua conta não tem esse acesso.');
        return;
      }
      $('topo-nome').textContent = u.nome || u.email || '';
      if (ses.simulando && ses.empresa) { $('simulando-nome').textContent = ses.empresa.nome; $('faixa-simulando').hidden = false; }
      tela('admin'); render(); return carregar();
    });
  }).catch(function () { estado('Não deu para carregar', 'Confira sua conexão e recarregue a página.'); });
})();
