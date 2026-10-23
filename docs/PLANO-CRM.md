# Plano: transformar o PHAR Prospector em CRM

Criado em 22 de outubro de 2026, a partir da reunião com cliente de 21 out 2026.
Status: **aprovado pelo Pedro. Fases A, B e D feitas em 22 out 2026; as outras ainda não.** Ordem sugerida: A (Kanban), B (excluir), D (trava de exportação), C (importar), F (clientes), E (landing page, por último para usar imagens do sistema pronto). Fica em `docs/PLANO-CRM.md`.

Este arquivo é a especificação para o Claude Code. Antes de cada fase, leia `CLAUDE.md`,
`docs/DOCUMENTACAO.md` e o código atual (ele pode ter mudado depois deste plano).
Faça uma fase por vez; ao terminar cada uma, teste, atualize a documentação, marque `[x]` aqui,
faça commit e envie para a `main`.

Regras de sempre: Supabase no plano gratuito (sem tempo real, sem armazenamento de arquivos),
toda regra de acesso vale no banco (RLS e funções), CSP sem `style=` nem `<script>` solto,
nenhuma chave secreta no código ou no chat, repositório privado.

---

## Fase A — Kanban (visão Lista ou Kanban)

- [x] **A.1 Alternar visão.** Na aba Contatos, um seletor "Lista | Kanban". A escolha fica
  guardada no navegador (`localStorage`, com try/catch) por usuário.
- [x] **A.2 Colunas = etapas do funil.** Uma coluna por status, na ordem do funil:
  A contatar, Contato feito, Em conversa, Reunião, Proposta enviada, Não é o momento,
  Fechado, Sem interesse. Cabeçalho com nome e quantidade. Colunas "Fechado" e
  "Sem interesse" podem vir recolhidas.
- [x] **A.3 Cartão.** Nome da empresa, pessoa, cidade, próximo contato (atrasado em destaque),
  temperatura se já existir (ainda não existe, ficou de fora), quem cadastrou. Clique abre a ficha atual.
- [x] **A.4 Arrastar e soltar** entre colunas muda o status (mesma gravação que hoje).
  Sem biblioteca externa pesada: HTML5 drag and drop no computador e, no celular,
  um menu "Mover para…" no cartão. Respeitar a permissão `editar`: sem ela, não arrasta.
  Ao mover para "Fechado", a tela não pergunta nada: o banco grava `prospects.cliente_desde`
  (data de hoje) por gatilho quando o status vira "cliente", se estiver vazia, e limpa quando
  sai de "cliente". A edição dessa data fica para a Fase F. (Decisão do Pedro, 22 out 2026.)
- [x] **A.5 Filtros e busca** da lista valem também para o Kanban (busca, retorno, status, responsável).
- [x] **A.6 Responsável pelo contato.** Coluna nova `prospects.responsavel uuid` (pessoa da
  equipe), filtro "Meus contatos". Por padrão, quem cadastrou.
  Só o responsável da empresa (papel dono) e o admin em modo simular trocam o responsável,
  valendo no banco (gatilho `regras_prospect`). Colaborador sem `ver_todos` vê, edita e exclui
  os contatos que cadastrou OU dos quais é responsável. (Decisões do Pedro, 22 out 2026.)
- [x] **A.7 Desempenho.** Carregar até o limite atual (10.000) sem travar: desenhar no
  máximo 50 cartões por coluna com "ver mais".

## Fase B — Excluir contato

Já existe excluir na ficha (permissão `excluir`). Acrescentar:
- [x] **B.1** Excluir pelo cartão do Kanban e pela linha da lista (menu "…"), com confirmação.
- [x] **B.2 Excluir em lote:** marcar vários na lista e "Excluir selecionados", com confirmação
  mostrando a quantidade. Só para quem tem `excluir`; o banco já garante.
  Decisões do Pedro (22 out 2026): acima de 50 contatos, a confirmação pede para digitar EXCLUIR;
  se a seleção tiver clientes fechados, avisa "Inclui N clientes fechados" e oferece "Excluir só os
  que não são clientes"; cada exclusão em lote grava em `private.auditoria` quem, empresa,
  quantidade e data (função `prospects_excluir_lote`), sem guardar os dados excluídos.
- [x] **B.3** Mensagem de desfazer por alguns segundos não é obrigatória; a confirmação basta.

## Fase C — Importar base, com aprovação do administrador geral

Motivo: proteger o servidor (plano gratuito) e a qualidade da base.

- [x] **C.1 Tela de importação** na aba Contatos (permissão nova `importar`, desmarcada por padrão
  para colaborador; o responsável da empresa tem).
  - Aceita CSV e Excel (.xlsx). Biblioteca servida pelo próprio site (`dist/vendor/` via
    `build.mjs`), por causa da CSP.
  - Passos: escolher arquivo → ligar colunas da planilha aos campos do sistema → prévia das
    10 primeiras linhas → aviso de duplicados (mesmo CNPJ, telefone ou nome) → enviar para aprovação.
- [x] **C.2 Fila de aprovação no banco.** Tabela nova (schema `private`) `importacoes`:
  empresa, quem enviou, nome do arquivo, quantidade de linhas, estado
  (`pendente`, `aprovada`, `recusada`, `concluida`), motivo da recusa, datas.
  As linhas ficam em tabela de espera `private.importacao_linhas` (jsonb por linha), nunca direto
  em `prospects`. Limite por envio (ex.: 2.000 linhas) e o limite de 10.000 contatos por empresa.
- [x] **C.3 Painel admin (só administrador geral):** seção "Importações pendentes" com empresa,
  quantidade, prévia e botões Aprovar / Recusar (com motivo). Aprovar grava em `prospects` por uma
  função do banco (`admin_importacao_aprovar`), em lotes, pulando duplicados, e apaga as linhas de espera.
  Registrar em `private.auditoria`.
- [x] **C.4 Para o cliente:** na aba Contatos, "Minhas importações" com o estado de cada envio.
- [x] **C.5 Limpeza:** linhas de espera de importações recusadas ou com mais de 30 dias somem
  (função chamada pelo admin ou rotina diária).
- Decisões do Pedro (22 out 2026): Excel lido pela SheetJS atual baixada do site oficial
  (cdn.sheetjs.com, versão 0.20.3 fixa, guardada em `vendor/` e copiada no `build.mjs`), não a do npm.
  Até 2.000 linhas por envio e até 3 envios pendentes por empresa; nenhuma importação sem aprovação.
  Na aprovação: origem "Importação", data e planilha nas observações, telefone só com números,
  e-mail em minúsculas (inválido fica vazio), CNPJ conferido (`PP.docValido` na tela e
  `private.cnpj_valido` no banco; inválido fica vazio). Antes de enviar, a pessoa marca a declaração
  "Declaro que estes contatos foram obtidos de forma legítima e que posso usá-los para contato
  comercial"; o banco guarda quem e quando. A limpeza (C.5) roda ao abrir o `/admin`.

## Fase D — Exportação travada, só o administrador geral libera

- [x] **D.1** Por padrão, **ninguém** exporta, nem o responsável da empresa. O botão
  "Baixar planilha (CSV)" some.
- [x] **D.2** Coluna nova `empresas.exportacao_liberada boolean default false`. Só o administrador
  geral muda, no painel admin (por empresa: "Liberar exportação" / "Bloquear exportação").
  Registrar em auditoria.
- [x] **D.3** Com a empresa liberada, exporta quem for responsável ou tiver a permissão `exportar`.
- [x] **D.4 Trava de verdade:** hoje o CSV é gerado no navegador a partir da lista carregada, então
  esconder o botão não impede cópia. Para a trava valer, a exportação passa a ser uma função do banco
  (`exportar_contatos`) que confere `exportacao_liberada` e a permissão, e o navegador só gera o
  arquivo com o que ela devolver. Registrar cada exportação em auditoria. Avisar na documentação que
  quem enxerga contatos na tela ainda pode copiá-los à mão.
- [x] **D.5** O backup do administrador (`admin_exportar` e planilha do Google) continua igual.
- Decisões do Pedro (22 out 2026): além de liberar e bloquear, "Liberar por 24 horas", com o prazo
  em `empresas.exportacao_ate` (nula = sem prazo); `exportar_contatos` só libera se
  `exportacao_liberada` e (`exportacao_ate` nula ou no futuro); o selo do admin mostra até quando vale.
  O admin em modo simular segue a mesma regra da empresa (não fura a trava); o backup geral
  continua por `admin_exportar`.

## Fase E — Landing page de vendas (conversão)

Referência estudada: a página do Agendor (CRM brasileiro) — hero com promessa e dois botões,
prova social logo abaixo, problemas por perfil de cliente, mostra do produto, preços, números,
integrações, perguntas frequentes e chamada final. Não copiar textos nem visual de concorrentes;
usar a identidade da PHAR que já está no site.

Estrutura da nova página `/` (`src/index.html`):
- [ ] **E.1 Hero:** promessa clara de resultado ("Nenhum cliente esquecido: saiba com quem falar hoje
  e feche mais"), subtítulo de uma linha, botões "Testar grátis" (vai para `/entrar?modo=criar`) e
  "Falar com especialista" (WhatsApp comercial do Pedro), imagem real do Kanban do sistema.
- [ ] **E.2 Faixa de confiança:** "Dados separados por empresa", "Feito no Brasil",
  "Funciona no celular". Sem números inventados: depoimentos e logos só quando houver clientes reais
  autorizando (deixar o espaço preparado e escondido).
- [ ] **E.3 Dores → soluções:** 3 blocos (esqueço de retornar; não sei em que pé está cada
  negociação; não sei o que a equipe está fazendo) com a função que resolve cada um.
- [ ] **E.4 Como funciona** em 3 passos, com imagens do sistema (Kanban, ficha, painel).
- [ ] **E.5 Funções:** Kanban e lista, retorno programado, equipe com permissões, painel com
  gráficos, importação de base, busca de leads (quando a Fase 2 do outro plano estiver pronta).
- [ ] **E.6 Planos e preços:** cartões de plano com o que inclui. **Os valores são decisão do Pedro**:
  deixar marcados como "a definir" até ele informar.
- [ ] **E.7 Perguntas frequentes** (8 a 10): é seguro? meus dados ficam com quem? posso importar
  minha planilha? funciona no celular? tem fidelidade? como é o suporte? posso cancelar?
- [ ] **E.8 Chamada final** com os mesmos dois botões e rodapé com contato e links.
- [ ] **E.9 Técnica:** página leve (sem framework), título e descrição para Google e para
  compartilhamento no WhatsApp, botão flutuante de WhatsApp, imagens otimizadas, nota alta no
  PageSpeed no celular. Respeitar a CSP.

## Fase F — Aba Clientes (gestão dos clientes ativos)

Ideia inspirada no ClientX (sistema de gestão de clientes que o Pedro fez para um cliente). Pegar a
ideia, não copiar o código: o ClientX é entrega de outro cliente, em outro repositório.

- [x] **F.1 Virar cliente.** Quando um contato vai para "Fechado", ele aparece na aba nova **Clientes**
  (o contato continua sendo o mesmo registro, com o histórico de prospecção junto).
  Coluna `prospects.cliente_desde date` preenchida pelo banco (gatilho) ao virar "Fechado".
- [x] **F.2 Dados do cliente** (tabela nova `clientes`, ligada ao contato e à empresa, com RLS igual
  à de `prospects`): o que contratou (produto ou serviço, texto), valor mensal ou do contrato,
  forma de cobrança, data de início, data de renovação ou fim, situação (`ativo`, `pausado`,
  `cancelado`, com motivo do cancelamento), responsável na equipe, observações.
- [x] **F.3 Acompanhamento:** registro de atendimentos (data, canal, o que foi feito) e
  "próxima ação" com data, igual ao retorno programado dos contatos.
- [x] **F.4 Lista e Kanban de clientes**, com colunas por situação, filtros por responsável e por
  renovação nos próximos 30 dias.
- [x] **F.5 Painel de clientes:** clientes ativos, receita mensal somada, renovações do mês,
  cancelamentos do mês. Valores só para quem tiver permissão nova `ver_financeiro`.
- [x] **F.6 Permissões novas** nas caixinhas da Equipe: `ver_clientes`, `editar_clientes`,
  `ver_financeiro`. O responsável da empresa tem todas.
- Decisões do Pedro (22 out 2026), entrega em duas partes. **F-1 (feita):** banco, permissões, aba
  Clientes em lista (filtros de situação, responsável e renovação em 30 dias), ficha e atendimentos.
  **F-2 (feita):** Kanban de clientes (F.4) e painel de clientes (F.5), com a coluna
  `clientes.cancelado_em` para contar cancelamentos do mês; números calculados na tela com o que a
  pessoa enxerga, e o aviso "Números dos seus clientes" para quem não tem "ver todos". Responsável do cliente = o do
  contato (um só). Valores em tabela separada (`clientes_financeiro`) para `ver_financeiro` valer no
  banco; valor em `numeric(12,2)`, digitado e mostrado como R$ 1.234,56, marcado como mensal ou do
  contrato inteiro (a receita mensal soma só os mensais). A ficha fica guardada se o contato sair de
  "Fechado". Excluir o contato apaga ficha, valores e atendimentos, com o aviso "Este contato é
  cliente; a ficha de cliente também será excluída." Backup geral leva os dados de cliente. A planilha
  de clientes segue a trava de exportação da Fase D. Permissões começam: `ver_clientes` marcada,
  `editar_clientes` e `ver_financeiro` desmarcadas.

## Decisões pendentes do Pedro

1. Valores e nomes dos planos (E.6).
2. Texto do botão de WhatsApp e mensagem pré-pronta.
3. ~~Limite de linhas por importação~~ decidido: 2.000 (22 out 2026).
4. ~~Importar sem aprovação depois de um tempo de uso~~ decidido: não, por enquanto (22 out 2026).
5. Quais campos do cliente importam mais para os seus clientes (F.2); a lista acima é o ponto de partida.
