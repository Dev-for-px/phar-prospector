/**
 * PHAR Prospector — backup no Google Planilhas.
 *
 * O que faz: copia todos os contatos de todas as empresas para esta planilha,
 * uma aba por empresa, e uma aba "Resumo" com a data do último backup.
 * Cada backup reescreve as abas com o que está no sistema naquele momento.
 *
 * Como instalar (uma vez só):
 *   1. Crie uma planilha em branco no Google Planilhas, na conta Google onde o backup deve ficar.
 *   2. Menu Extensões > Apps Script. Apague o que estiver lá, cole este arquivo inteiro e salve.
 *   3. Volte para a planilha e recarregue a página. Vai aparecer o menu "Backup PHAR".
 *   4. Backup PHAR > 1. Configurar acesso: informe o e-mail e a senha da sua conta de administrador.
 *   5. Backup PHAR > 2. Fazer backup agora. Na primeira vez o Google pede autorização: aceite.
 *   6. Backup PHAR > 3. Agendar backup diário.
 *
 * Segurança: o e-mail e a senha ficam guardados nas propriedades do seu usuário neste script: só a sua conta Google lê.
 * Mesmo assim, não dê permissão de edição da planilha a outras pessoas: ela contém os contatos de todos os clientes.
 * Se trocar a senha no sistema, rode "Configurar acesso" de novo.
 */

var SUPABASE_URL = 'https://megkurlpjylmxjndynoo.supabase.co';
var CHAVE_PUBLICA = 'sb_publishable_Ete35T600mQmtXi-S4IEhw_jLunudad';

var COLUNAS = [
  ['Empresa', 'empresa'], ['Pessoa de contato', 'contato'], ['Cargo', 'cargo'], ['Telefone', 'telefone'],
  ['E-mail', 'email'], ['Cidade', 'cidade'], ['UF', 'uf'], ['Segmento', 'segmento'], ['Porte', 'porte'],
  ['Origem', 'origem'], ['Site ou Instagram', 'link'], ['Interesse', 'interesse'], ['Status', 'status'],
  ['Último contato', 'ultimo_contato'], ['Próximo contato', 'proximo_contato'], ['Observações', 'observacoes'],
  ['Histórico', 'historico'], ['Cadastrado por', 'cadastrado_por'], ['Cadastrado em', 'criado_em'], ['Atualizado em', 'atualizado_em']
];
var STATUS = {
  novo: 'A contatar', contatado: 'Contato feito', conversa: 'Em conversa', diagnostico: 'Reunião ou diagnóstico',
  proposta: 'Proposta enviada', depois: 'Não é o momento', cliente: 'Fechado', perdido: 'Sem interesse'
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Backup PHAR')
    .addItem('1. Configurar acesso', 'configurarAcesso')
    .addItem('2. Fazer backup agora', 'fazerBackupComAviso')
    .addItem('3. Agendar backup diário', 'agendarBackupDiario')
    .addSeparator()
    .addItem('Cancelar o agendamento', 'cancelarAgendamento')
    .addToUi();
}

function configurarAcesso() {
  var ui = SpreadsheetApp.getUi();
  var email = ui.prompt('Backup PHAR', 'E-mail da sua conta de administrador no PHAR Prospector:', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return;
  var senha = ui.prompt('Backup PHAR', 'Senha dessa conta:', ui.ButtonSet.OK_CANCEL);
  if (senha.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getUserProperties().setProperties({
    PHAR_EMAIL: email.getResponseText().trim(),
    PHAR_SENHA: senha.getResponseText()
  });
  try {
    entrar_();
    ui.alert('Acesso configurado. Agora use "2. Fazer backup agora".');
  } catch (e) {
    ui.alert('Não deu para entrar com esses dados: ' + e.message);
  }
}

function fazerBackupComAviso() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = fazerBackup();
    ui.alert('Backup concluído: ' + r.empresas + ' empresas e ' + r.contatos + ' contatos.');
  } catch (e) {
    ui.alert('O backup falhou: ' + e.message);
  }
}

function agendarBackupDiario() {
  cancelarAgendamento_();
  ScriptApp.newTrigger('fazerBackup').timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getUi().alert('Agendado: o backup roda sozinho todos os dias, entre 3h e 4h da manhã.');
}

function cancelarAgendamento() {
  cancelarAgendamento_();
  SpreadsheetApp.getUi().alert('Agendamento cancelado.');
}

function cancelarAgendamento_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fazerBackup') ScriptApp.deleteTrigger(t);
  });
}

/** Função principal. É ela que o agendamento chama. */
function fazerBackup() {
  var token = entrar_();
  var resposta = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/admin_exportar', {
    method: 'post', contentType: 'application/json', payload: '{}', muteHttpExceptions: true,
    headers: { apikey: CHAVE_PUBLICA, Authorization: 'Bearer ' + token }
  });
  if (resposta.getResponseCode() !== 200) {
    throw new Error('o sistema recusou a exportação (código ' + resposta.getResponseCode() + '). Confira se a conta é de administrador.');
  }
  var empresas = JSON.parse(resposta.getContentText()) || [];
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var totalContatos = 0, resumo = [];

  empresas.forEach(function (emp) {
    var aba = abaDaEmpresa_(planilha, emp);
    var linhas = [COLUNAS.map(function (c) { return c[0]; })];
    (emp.contatos || []).forEach(function (x) {
      linhas.push(COLUNAS.map(function (c) { return celula_(c[1], x[c[1]]); }));
    });
    aba.clearContents();
    aba.getRange(1, 1, linhas.length, COLUNAS.length).setValues(linhas);
    aba.getRange(1, 1, 1, COLUNAS.length).setFontWeight('bold');
    aba.setFrozenRows(1);
    totalContatos += linhas.length - 1;
    resumo.push([emp.nome, emp.status, (emp.usuarios || []).length, linhas.length - 1,
      (emp.usuarios || []).map(function (u) { return u.nome + ' <' + u.email + '>'; }).join(', ')]);
  });

  var abaResumo = planilha.getSheetByName('Resumo') || planilha.insertSheet('Resumo', 0);
  abaResumo.clearContents();
  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  var cabecalho = [
    ['PHAR Prospector — backup', '', '', '', ''],
    ['Último backup', agora, '', '', ''],
    ['Empresas', empresas.length, '', '', ''],
    ['Contatos', totalContatos, '', '', ''],
    ['', '', '', '', ''],
    ['Empresa', 'Situação', 'Usuários', 'Contatos', 'Quem usa']
  ];
  var tudo = cabecalho.concat(resumo.map(function (l) { return l.map(function (v) { return texto_(v); }); }));
  abaResumo.getRange(1, 1, tudo.length, 5).setValues(tudo);
  abaResumo.getRange(1, 1).setFontWeight('bold');
  abaResumo.getRange(6, 1, 1, 5).setFontWeight('bold');
  return { empresas: empresas.length, contatos: totalContatos };
}

/** Entra no sistema com a conta de administrador e devolve o token da sessão. */
function entrar_() {
  var props = PropertiesService.getUserProperties();
  var email = props.getProperty('PHAR_EMAIL'), senha = props.getProperty('PHAR_SENHA');
  if (!email || !senha) throw new Error('acesso não configurado. Use "1. Configurar acesso".');
  var r = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: CHAVE_PUBLICA },
    payload: JSON.stringify({ email: email, password: senha })
  });
  if (r.getResponseCode() !== 200) throw new Error('e-mail ou senha recusados (código ' + r.getResponseCode() + ').');
  return JSON.parse(r.getContentText()).access_token;
}

/** Acha (ou cria) a aba da empresa. O final "(abc123)" identifica a empresa mesmo se ela mudar de nome. */
function abaDaEmpresa_(planilha, emp) {
  var marca = '(' + String(emp.id).slice(0, 6) + ')';
  var nome = String(emp.nome || 'Empresa').replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + ' ' + marca;
  var abas = planilha.getSheets();
  for (var i = 0; i < abas.length; i++) {
    if (abas[i].getName().slice(-marca.length) === marca) {
      if (abas[i].getName() !== nome) abas[i].setName(nome);
      return abas[i];
    }
  }
  return planilha.insertSheet(nome);
}

function celula_(campo, valor) {
  if (valor === null || valor === undefined) return '';
  if (campo === 'status') return STATUS[valor] || valor;
  if (campo === 'historico') {
    return texto_((valor || []).map(function (h) {
      return [h.data, h.canal, STATUS[h.status] || h.status, h.por, h.nota].filter(function (p) { return p; }).join(' - ');
    }).join(' | '));
  }
  if (campo === 'criado_em' || campo === 'atualizado_em') {
    return Utilities.formatDate(new Date(valor), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  }
  return texto_(valor);
}

/** Texto seguro para a planilha: nada digitado por cliente vira fórmula. */
function texto_(v) {
  if (typeof v === 'number') return v;
  var s = String(v);
  if (s.length > 45000) s = s.slice(0, 45000) + ' …';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
