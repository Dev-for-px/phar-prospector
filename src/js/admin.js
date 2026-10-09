// Painel administrativo: lista as contas, libera e bloqueia.
// Só funciona para quem é admin; a checagem de verdade acontece no banco (funções admin_*).
(function () {
  'use strict';
  var PP = window.PP, $ = PP.$, el = PP.el, sb = PP.sb, toast = PP.toast;
  var ROTULO = { pendente: 'Aguardando', ativa: 'Ativa', bloqueada: 'Bloqueada' };
  var st = { contas: [], modo: 'carregando', filtro: '', q: '', meuId: '', confirmando: '' };

  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function tela(qual) {
    $('tela-carregando').hidden = qual !== 'carregando';
    $('tela-estado').hidden = qual !== 'estado';
    $('tela-admin').hidden = qual !== 'admin';
  }
  function estado(titulo, texto) { $('estado-titulo').textContent = titulo; $('estado-texto').textContent = texto; tela('estado'); }

  function carregar() {
    return sb.rpc('admin_contas').then(function (r) {
      if (r.error) throw r.error;
      st.contas = r.data || []; st.modo = 'ok'; $('aviso-erro').hidden = true; render();
    }).catch(function () {
      var a = $('aviso-erro'); a.textContent = 'Não deu para carregar as contas. Tente atualizar a lista.'; a.hidden = false;
      if (st.modo === 'carregando') { st.modo = 'erro'; render(); }
    });
  }

  function mudar(conta, novo, feito) {
    st.confirmando = '';
    sb.rpc('admin_definir_status', { alvo: conta.id, novo: novo }).then(function (r) {
      if (r.error) throw r.error;
      toast(feito); return carregar();
    }).catch(function () { toast('Não deu para alterar esta conta agora'); render(); });
  }

  function acoes(c) {
    if (c.id === st.meuId) return el('span', { class: 'dica', text: 'Sua conta' });
    if (st.confirmando === c.id) {
      return [
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Sim, bloquear', onclick: function () { mudar(c, 'bloqueada', 'Conta bloqueada'); } }),
        el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Manter', onclick: function () { st.confirmando = ''; render(); } })
      ];
    }
    if (c.status === 'pendente') return [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Liberar', onclick: function () { mudar(c, 'ativa', 'Conta liberada'); } }),
      el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Recusar', onclick: function () { st.confirmando = c.id; render(); } })
    ];
    if (c.status === 'ativa') return el('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Bloquear', onclick: function () { st.confirmando = c.id; render(); } });
    return el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Reativar', onclick: function () { mudar(c, 'ativa', 'Conta reativada'); } });
  }

  function linha(c) {
    var acesso = c.ultimo_acesso ? 'Último acesso: ' + PP.dataHora(c.ultimo_acesso) : 'Nunca entrou';
    return el('div', { class: 'adm-linha', role: 'listitem' },
      el('div', { class: 'a-nome' },
        el('div', { class: 'nome', text: c.nome || 'Sem nome' }),
        c.empresa ? el('div', { class: 'sub', text: c.empresa }) : null),
      el('div', { class: 'a-email' },
        el('div', { class: 'sub', text: c.email || '' }),
        !c.email_confirmado ? el('div', { class: 'sub', text: 'E-mail ainda não confirmado' }) : null),
      el('div', { class: 'sub num-col' }, PP.dataHora(c.criado_em), el('div', { text: acesso })),
      el('div', { class: 'num-col rot', 'data-rot': 'Contatos', text: String(c.contatos) }),
      el('div', null, el('span', { class: 'tag c-' + c.status, text: ROTULO[c.status] || c.status }),
        c.is_admin ? el('div', { class: 'sub', text: 'Administrador' }) : null),
      el('div', { class: 'adm-acoes' }, acoes(c)));
  }

  function render() {
    var n = { pendente: 0, ativa: 0, bloqueada: 0 }, total = 0, lista = $('lista');
    st.contas.forEach(function (c) { if (n[c.status] != null) n[c.status]++; total += Number(c.contatos) || 0; });
    var pronto = st.modo === 'ok';
    ['pendente', 'ativa', 'bloqueada'].forEach(function (k) { $('n-' + k).textContent = pronto ? n[k] : '–'; });
    $('n-contatos').textContent = pronto ? total : '–';
    document.querySelectorAll('button.stat').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filtro === st.filtro)); });
    lista.replaceChildren(); lista.removeAttribute('role');
    $('btn-limpar').hidden = true;
    if (st.modo === 'carregando') { $('contagem').textContent = 'Carregando contas…'; return; }
    if (st.modo === 'erro') { $('contagem').textContent = ''; return; }
    var q = semAcento(st.q.trim());
    var vis = st.contas.filter(function (c) {
      if (st.filtro && c.status !== st.filtro) return false;
      return !q || semAcento([c.nome, c.empresa, c.email].join(' ')).indexOf(q) !== -1;
    });
    var filtrando = !!(st.filtro || q);
    $('contagem').textContent = filtrando
      ? 'Mostrando ' + vis.length + ' de ' + st.contas.length + (st.contas.length === 1 ? ' conta' : ' contas')
      : (st.contas.length === 1 ? '1 conta' : st.contas.length + ' contas');
    $('btn-limpar').hidden = !filtrando;
    if (!vis.length) {
      lista.append(el('div', { class: 'vazio' }, el('h2', { text: 'Nenhuma conta neste filtro' }),
        el('p', { text: 'Quando alguém criar conta na página de entrada, ela aparece aqui para você liberar.' })));
      return;
    }
    lista.setAttribute('role', 'list');
    vis.forEach(function (c) { lista.append(linha(c)); });
  }

  document.querySelectorAll('button.stat').forEach(function (b) {
    b.addEventListener('click', function () { st.filtro = st.filtro === b.dataset.filtro ? '' : b.dataset.filtro; render(); });
  });
  $('q').addEventListener('input', function () { st.q = this.value; render(); });
  $('btn-limpar').addEventListener('click', function () { st.filtro = ''; st.q = ''; $('q').value = ''; render(); });
  $('btn-atualizar').addEventListener('click', function () { carregar().then(function () { toast('Lista atualizada'); }); });
  document.querySelectorAll('[data-sair]').forEach(function (b) { b.addEventListener('click', PP.sair); });
  sb.auth.onAuthStateChange(function (evento) { if (evento === 'SIGNED_OUT') PP.irPara('/entrar?destino=admin'); });

  PP.sessao().then(function (s) {
    if (!s) { PP.irPara('/entrar?destino=admin'); return null; }
    st.meuId = s.user.id;
    return PP.perfil().then(function (perfil) {
      if (!perfil || !perfil.is_admin || perfil.status !== 'ativa') {
        estado('Área restrita', 'Este painel é só para a administração do sistema. Sua conta não tem esse acesso.');
        return;
      }
      $('topo-nome').textContent = perfil.nome || s.user.email || '';
      tela('admin'); render(); return carregar();
    });
  }).catch(function () { estado('Não deu para carregar', 'Confira sua conexão e recarregue a página.'); });
})();
