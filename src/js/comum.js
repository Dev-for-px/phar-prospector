// Funções compartilhadas por todas as páginas: conexão com o Supabase, sessão e utilidades.
window.PP = (function () {
  'use strict';
  var cfg = window.PP_CONFIG;
  // guardado antes de o Supabase limpar a URL (links de confirmação e de recuperação de senha)
  var hashInicial = window.location.hash || '';
  var sb = window.supabase.createClient(cfg.url, cfg.chave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function $(id) { return document.getElementById(id); }

  function el(tag, props) {
    var n = document.createElement(tag), k, i, c;
    if (props) for (k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (i = 2; i < arguments.length; i++) {
      c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) n.append(x); });
      else n.append(c);
    }
    return n;
  }

  var toastT;
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; clearTimeout(toastT);
    toastT = setTimeout(function () { t.textContent = ''; }, 3200);
  }

  // ---------- datas (sempre no fuso de quem usa) ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return (d.getMonth() === p[1] - 1 && d.getDate() === p[2]) ? d : null;
  }
  function hoje() { return iso(new Date()); }
  function somaDias(s, n) { var d = parse(s) || new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function difDias(a, b) {
    var A = parse(a), B = parse(b);
    return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
  }
  var fmtCurta = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  var fmtLonga = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  function limpaData(t) { return t.replace(/\./g, '').replace(/ de /g, ' '); }
  function dataCurta(s) { var d = parse(s); return d ? limpaData(fmtCurta.format(d)) : ''; }
  function dataLonga(s) { var d = parse(s); return d ? fmtLonga.format(d) : ''; }
  function dataHora(s) { var d = s ? new Date(s) : null; return d && !isNaN(d) ? limpaData(fmtCurta.format(d)) : ''; }

  // ---------- sessão ----------
  function sessao() {
    return sb.auth.getSession().then(function (r) { return r.data ? r.data.session : null; });
  }
  function perfil() {
    return sb.from('profiles').select('nome,empresa,status,is_admin').maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  // quem sou, em que empresa estou e se é um admin simulando outra empresa
  function sessaoApp() {
    return sb.rpc('minha_sessao').then(function (r) {
      if (r.error) { r.error.status = r.status; throw r.error; }
      return r.data;
    });
  }
  function sair() {
    sb.auth.signOut().catch(function () {}).then(function () { window.location.href = '/'; });
  }
  function irPara(caminho) { window.location.replace(caminho); }

  // ---------- CPF e CNPJ (o CNPJ pode ter letras nas 12 primeiras posições) ----------
  function docLimpo(v) { return String(v || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(); }
  function digitoMod11(valores, pesos) {
    var soma = 0, i;
    for (i = 0; i < valores.length; i++) soma += valores[i] * pesos[i];
    var resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }
  function cnpjValido(d) {
    if (!/^[A-Z0-9]{12}\d{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
    var v = d.split('').map(function (ch) { return ch.charCodeAt(0) - 48; });
    var p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6].concat(p1);
    return digitoMod11(v.slice(0, 12), p1) === v[12] && digitoMod11(v.slice(0, 13), p2) === v[13];
  }
  function cpfValido(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    var v = d.split('').map(Number), i, s1 = 0, s2 = 0;
    for (i = 0; i < 9; i++) s1 += v[i] * (10 - i);
    var d1 = (s1 * 10) % 11 % 10;
    for (i = 0; i < 10; i++) s2 += v[i] * (11 - i);
    var d2 = (s2 * 10) % 11 % 10;
    return d1 === v[9] && d2 === v[10];
  }
  function docValido(v) { var d = docLimpo(v); return d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false; }
  function docFormatado(v) {
    var d = docLimpo(v);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    return String(v || '');
  }
  function cepFormatado(v) { var d = String(v || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || ''); }

  return {
    cfg: cfg, sb: sb, hashInicial: hashInicial, $: $, el: el, toast: toast,
    iso: iso, parse: parse, hoje: hoje, somaDias: somaDias, difDias: difDias,
    dataCurta: dataCurta, dataLonga: dataLonga, dataHora: dataHora,
    sessao: sessao, perfil: perfil, sessaoApp: sessaoApp, sair: sair, irPara: irPara,
    docLimpo: docLimpo, docValido: docValido, docFormatado: docFormatado, cepFormatado: cepFormatado
  };
})();
