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
  function sair() {
    sb.auth.signOut().catch(function () {}).then(function () { window.location.href = '/'; });
  }
  function irPara(caminho) { window.location.replace(caminho); }

  return {
    cfg: cfg, sb: sb, hashInicial: hashInicial, $: $, el: el, toast: toast,
    iso: iso, parse: parse, hoje: hoje, somaDias: somaDias, difDias: difDias,
    dataCurta: dataCurta, dataLonga: dataLonga, dataHora: dataHora,
    sessao: sessao, perfil: perfil, sair: sair, irPara: irPara
  };
})();
