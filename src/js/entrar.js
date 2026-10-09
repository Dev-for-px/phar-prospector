// Tela de entrar: login, criar conta, recuperar senha e definir nova senha.
(function () {
  'use strict';
  var PP = window.PP, $ = PP.$, sb = PP.sb;
  var params = new URLSearchParams(window.location.search);
  var destino = params.get('destino') === 'admin' ? '/admin' : '/app';
  var voltarPara = window.location.origin + '/entrar';
  var recuperando = /type=recovery/.test(PP.hashInicial);
  var ultimoEmail = '';

  var VISOES = ['v-carregando', 'v-acesso', 'v-esqueci', 'v-nova', 'v-aviso'];
  function mostrar(id) { VISOES.forEach(function (v) { $(v).hidden = v !== id; }); }
  function aba(qual) {
    var criar = qual === 'criar';
    $('aba-entrar').setAttribute('aria-selected', String(!criar));
    $('aba-criar').setAttribute('aria-selected', String(criar));
    $('form-entrar').hidden = criar;
    $('form-criar').hidden = !criar;
  }
  function aviso(titulo, texto) { $('aviso-titulo').textContent = titulo; $('aviso-texto').textContent = texto; mostrar('v-aviso'); }
  function erro(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  function emailValido(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

  function traduz(e) {
    var c = (e && e.code) || '', m = ((e && e.message) || '').toLowerCase(), s = e && e.status;
    if (c === 'invalid_credentials' || m.indexOf('invalid login') !== -1) return 'E-mail ou senha incorretos.';
    if (c === 'email_not_confirmed' || m.indexOf('not confirmed') !== -1) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (c === 'user_already_exists' || m.indexOf('already registered') !== -1) return 'Este e-mail já tem conta. Entre ou recupere a senha.';
    if (c === 'weak_password' || m.indexOf('password should') !== -1) return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.';
    if (c === 'same_password') return 'A nova senha precisa ser diferente da anterior.';
    if (c === 'email_address_invalid' || m.indexOf('invalid') !== -1 && m.indexOf('email') !== -1) return 'Confira o e-mail digitado.';
    if (s === 429 || c.indexOf('rate_limit') !== -1) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    if (c === 'user_banned') return 'Esta conta está bloqueada.';
    return 'Não deu para concluir agora. Confira sua conexão e tente de novo.';
  }

  function ocupar(botao, texto) {
    var b = $(botao), antes = b.textContent;
    b.disabled = true; b.textContent = texto;
    return function () { b.disabled = false; b.textContent = antes; };
  }

  // ---------- entrar ----------
  $('form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('e-email').value.trim(), senha = $('e-senha').value;
    $('e-reenviar').hidden = true;
    if (!emailValido(email) || !senha) { erro('e-erro', 'Preencha o e-mail e a senha.'); return; }
    erro('e-erro'); ultimoEmail = email;
    var solta = ocupar('e-botao', 'Entrando…');
    sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
      if (r.error) {
        solta(); erro('e-erro', traduz(r.error));
        if (r.error.code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message || '')) $('e-reenviar').hidden = false;
        return;
      }
      PP.irPara(destino);
    }).catch(function (e) { solta(); erro('e-erro', traduz(e)); });
  });

  $('e-reenviar').addEventListener('click', function () {
    if (!ultimoEmail) return;
    sb.auth.resend({ type: 'signup', email: ultimoEmail, options: { emailRedirectTo: voltarPara } }).then(function (r) {
      PP.toast(r.error ? traduz(r.error) : 'E-mail de confirmação reenviado');
    });
  });

  // ---------- criar conta ----------
  $('form-criar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var nome = $('c-nome').value.trim(), empresa = $('c-empresa').value.trim();
    var email = $('c-email').value.trim(), senha = $('c-senha').value;
    if (!nome) { erro('c-erro', 'Diga seu nome.'); $('c-nome').focus(); return; }
    if (!emailValido(email)) { erro('c-erro', 'Confira o e-mail digitado.'); $('c-email').focus(); return; }
    if (senha.length < 8) { erro('c-erro', 'A senha precisa ter pelo menos 8 caracteres.'); $('c-senha').focus(); return; }
    erro('c-erro');
    var solta = ocupar('c-botao', 'Criando conta…');
    sb.auth.signUp({
      email: email, password: senha,
      options: { data: { nome: nome, empresa: empresa }, emailRedirectTo: voltarPara }
    }).then(function (r) {
      solta();
      if (r.error) { erro('c-erro', traduz(r.error)); return; }
      var u = r.data && r.data.user;
      // o Supabase devolve um usuário sem "identities" quando o e-mail já tem conta
      if (u && Array.isArray(u.identities) && u.identities.length === 0) { erro('c-erro', 'Este e-mail já tem conta. Entre ou recupere a senha.'); return; }
      if (r.data && r.data.session) { PP.irPara('/app'); return; }
      $('c-senha').value = '';
      aviso('Confirme seu e-mail', 'Enviamos um link de confirmação para ' + email + '. Abra o e-mail e clique no link. Depois disso, sua conta entra na fila de liberação.');
    }).catch(function (e) { solta(); erro('c-erro', traduz(e)); });
  });

  // ---------- esqueci a senha ----------
  $('e-esqueci').addEventListener('click', function () {
    $('r-email').value = $('e-email').value.trim(); erro('r-erro'); mostrar('v-esqueci'); $('r-email').focus();
  });
  $('form-esqueci').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('r-email').value.trim();
    if (!emailValido(email)) { erro('r-erro', 'Confira o e-mail digitado.'); return; }
    erro('r-erro');
    var solta = ocupar('r-botao', 'Enviando…');
    sb.auth.resetPasswordForEmail(email, { redirectTo: voltarPara }).then(function (r) {
      solta();
      if (r.error) { erro('r-erro', traduz(r.error)); return; }
      aviso('Confira seu e-mail', 'Se existe uma conta com ' + email + ', enviamos um link para você definir uma nova senha.');
    }).catch(function (e) { solta(); erro('r-erro', traduz(e)); });
  });

  // ---------- nova senha (vindo do link do e-mail) ----------
  $('form-nova').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var senha = $('n-senha').value;
    if (senha.length < 8) { erro('n-erro', 'A senha precisa ter pelo menos 8 caracteres.'); return; }
    erro('n-erro');
    var solta = ocupar('n-botao', 'Salvando…');
    sb.auth.updateUser({ password: senha }).then(function (r) {
      if (r.error) { solta(); erro('n-erro', traduz(r.error)); return; }
      PP.irPara(destino);
    }).catch(function (e) { solta(); erro('n-erro', traduz(e)); });
  });

  // ---------- navegação ----------
  $('aba-entrar').addEventListener('click', function () { aba('entrar'); });
  $('aba-criar').addEventListener('click', function () { aba('criar'); });
  document.querySelectorAll('[data-voltar]').forEach(function (b) {
    b.addEventListener('click', function () { aba('entrar'); mostrar('v-acesso'); });
  });

  sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'PASSWORD_RECOVERY') { recuperando = true; mostrar('v-nova'); }
  });

  // ---------- início ----------
  if (/error=/.test(PP.hashInicial)) {
    aviso('Link expirado', 'Este link expirou ou já foi usado. Entre com sua senha ou peça um novo link.');
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  PP.sessao().then(function (s) {
    if (recuperando) { mostrar('v-nova'); return; }
    if (s) { PP.irPara(destino); return; }
    aba(params.get('modo') === 'criar' ? 'criar' : 'entrar');
    mostrar('v-acesso');
  }).catch(function () { mostrar('v-acesso'); });
})();
