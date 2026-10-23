# PHAR Prospector — documentação completa

Atualizada em 22 de outubro de 2026.

Este documento serve para duas coisas: entender como o sistema funciona hoje e **reconstruir tudo do zero** se alguma conta ou serviço for perdido. Ele fica em três lugares: no repositório do GitHub (`docs/DOCUMENTACAO.md`), dentro do kit de reconstrução (arquivo ZIP) e em PDF.

Não há senhas neste documento. As senhas ficam só com você (parte 3).

## Sumário

1. O que é o sistema
2. Onde está cada coisa
3. Contas e acessos
4. Como as peças se ligam
5. As páginas
6. Os arquivos do código
7. O banco de dados
8. Quem pode o quê
9. Segurança
10. Backup
11. Como publicar uma mudança
12. Reconstruir do zero
13. Devolver os dados depois de um desastre
14. Limites do plano gratuito
15. Pendências conhecidas
16. Histórico
17. Base da Receita (aba Buscar leads)

---

## 1. O que é o sistema

O PHAR Prospector é um controle de prospecção com retorno programado. Cada empresa cliente cadastra quem abordou, registra as conversas e marca o dia de voltar a falar. No dia marcado, o contato sobe para o topo da lista.

É um produto da PHAR Consultoria, pensado para venda por assinatura. O nome ainda é provisório.

O que existe hoje:

- Página pública de apresentação, com entrar e criar conta.
- Sistema com cinco abas: Painel (gráficos), Contatos, Buscar leads, Equipe e Empresa.
- Busca de empresas na base pública da Receita Federal (hoje só MG), com "Adicionar à minha lista".
- Várias pessoas por empresa, com permissões marcadas pelo responsável.
- Cadastro completo da empresa (CNPJ ou CPF, contatos e endereço).
- Painel administrativo do dono do sistema: libera, bloqueia, simula o acesso de uma empresa e baixa backup.
- Backup diário em uma planilha do Google, com uma aba por empresa.

## 2. Onde está cada coisa

| O quê | Onde | Identificação |
|---|---|---|
| Site no ar | Vercel | https://phar-prospector.vercel.app |
| Código-fonte | GitHub (repositório privado) | `Dev-for-px/phar-prospector`, branch `main` |
| Banco de dados e login | Supabase | projeto `phar-prospector`, id `megkurlpjylmxjndynoo`, região São Paulo (`sa-east-1`), Postgres 17, plano gratuito |
| Organização no Supabase | Supabase | id `punbqisnqxxeinmgscug` |
| Endereço do banco para o site | Supabase | `https://megkurlpjylmxjndynoo.supabase.co` |
| Chave pública do banco | `src/js/config.js` | `sb_publishable_Ete35T600mQmtXi-S4IEhw_jLunudad` |
| Planilha de backup | Google Planilhas | https://docs.google.com/spreadsheets/d/1hu7NaL7t60vsEYSs-6_canXgSxGDi3Gw_pYqisPuqOk/edit |
| Script do backup | Dentro da planilha (Extensões > Apps Script) | cópia em `backup/google-planilhas.gs` |
| Conta administradora do sistema | Login do próprio sistema | pedrodadila@gmail.com |
| Documentação do projeto no Claude | Projeto "PHAR Consultoria" | `claude/phar-prospector-sistema.md` |
| Base da Receita (Parquet) | Hugging Face, conjunto de dados público | https://huggingface.co/datasets/pharconsultoria/phar-receita (conta `pharconsultoria`). Endereço lido pelo site em `src/js/config.js`, campo `receita` |

A chave pública pode aparecer aqui e no código: ela foi feita para ficar no navegador. Quem protege os dados são as regras do banco (parte 9).

Endereços do site:

| Endereço | O que é |
|---|---|
| `/` | Página principal, aberta a todos |
| `/entrar` | Entrar, criar conta, recuperar senha |
| `/entrar?modo=criar` | Abre direto no cadastro (é o link que o responsável manda para o colaborador) |
| `/app` | O sistema. `/app#contatos`, `/app#buscar`, `/app#equipe` e `/app#empresa` abrem direto na aba |
| `/admin` | Painel administrativo |

## 3. Contas e acessos

O sistema depende de quatro contas, mais a do Hugging Face para a base da Receita. Perder o Claude não derruba nada: o site continua no ar, porque roda em GitHub, Vercel e Supabase.

| Conta | Para que serve | Se perder |
|---|---|---|
| GitHub (organização `Dev-for-px`) | Guarda o código. Cada envio para a `main` publica o site | O site continua no ar, mas não dá para mudar. Recupere a conta ou suba o código do kit em um repositório novo (parte 12) |
| Vercel | Publica o site | O endereço sai do ar. Crie outro projeto e importe o repositório (parte 12) |
| Supabase | Banco e login | Login e dados somem. É a perda mais séria: recrie o banco e devolva os dados (partes 12 e 13) |
| Google (dona da planilha) | Guarda o backup | O backup some. Crie outra planilha e instale o script de novo (parte 10) |
| Hugging Face | Guarda a base da Receita em Parquet (pública, gratuita, sem cartão) | Só a aba Buscar leads para. Crie outra conta, rode o script de novo e troque o endereço em `config.js` (parte 17) |

O que guardar em um gerenciador de senhas (1Password, Bitwarden ou o do Google):

- E-mail e senha de cada uma das quatro contas, com verificação em duas etapas ligada.
- Códigos de recuperação do GitHub e do Google.
- E-mail e senha da conta administradora do PHAR Prospector.
- A senha do banco de dados do Supabase (Project Settings > Database). Ela só é necessária para o backup completo opcional da parte 10.

Regras que valem sempre:

- Nunca colocar a senha do banco nem a chave secreta do Supabase (`service_role` ou `sb_secret_...`) no código, no repositório ou em conversa com IA.
- A planilha de backup tem os contatos de todos os clientes. O compartilhamento dela deve ficar em "Restrito".
- Guarde o kit de reconstrução (ZIP) em pelo menos dois lugares fora do Claude, por exemplo o seu Google Drive e o seu computador.

## 4. Como as peças se ligam

```
 Você pede a mudança      GitHub              Vercel                 Navegador do cliente
 (no Claude ou à mão) ──▶ repositório  ─────▶ roda o build    ─────▶ phar-prospector.vercel.app
                          privado, main       publica dist/               │
                                                                          │ e-mail e senha
                                                                          ▼
 Google Planilhas  ◀──── todo dia, às 3h ───────────────────────────  Supabase
 (uma aba por empresa)   o script entra como admin                    login + banco Postgres
                         e chama admin_exportar                       regras de acesso no banco
```

- O site é feito de páginas simples (HTML, CSS e JavaScript), sem servidor próprio. Tudo o que precisa de regra roda no banco.
- O navegador fala direto com o Supabase usando a chave pública. Cada pedido leva o login da pessoa, e o banco decide o que ela pode ver.
- Não há chave secreta em lugar nenhum do site.
- A aba Buscar leads lê a base da Receita direto do Hugging Face (arquivos públicos, leitura por pedaços). Só os contatos que a pessoa adiciona vão para o Supabase.

## 5. As páginas

**Página principal (`/`)**: apresenta o sistema e leva para entrar ou criar conta.

**Entrar (`/entrar`)**: login, cadastro, "esqueci a senha" e troca de senha. No cadastro a pessoa informa nome, empresa, e-mail e senha (mínimo de 8 caracteres) e confirma o e-mail pelo link recebido.

**Sistema (`/app`)**:

- **Painel**: rosca com os contatos por status, linha com o crescimento da base e a lista "Para falar hoje". Para o responsável, mostra o aviso "Complete o cadastro da empresa" enquanto faltar dado.
- **Contatos**: duas visões, **Lista** ou **Kanban** (seletor no topo da aba; a escolha fica guardada no navegador, por usuário). Busca, filtro por status, filtro por responsável ("Meus contatos" ou um colega), ordenação e os quatro números do topo (atrasados, hoje, próximos 7 dias, sem retorno) valem para as duas. Cada contato tem ficha, histórico e o botão "Registrar contato". Contatos vindos da Receita mostram CNPJ, razão social e endereço na ficha. A ficha mostra o **responsável pelo contato** (só o responsável pela conta troca) e, quando fechado, "Cliente desde".
  - **Kanban**: uma coluna por etapa do funil, com nome e quantidade; "Fechado" e "Sem interesse" começam recolhidas (clique no cabeçalho abre ou recolhe; fica guardado no navegador). O cartão mostra empresa, pessoa, cidade, próximo contato (atrasado em vermelho), responsável e quem cadastrou; clique no nome abre a ficha. Quem tem `editar` arrasta o cartão para outra coluna (computador) ou usa o menu "Mover para…" do cartão (celular e teclado); a gravação é a mesma da ficha (só o status). Até 50 cartões por coluna, com "Ver mais". As colunas quebram em linhas conforme a largura da tela (sem rolagem lateral) e cada coluna rola por dentro.
  - **Excluir** (só para quem tem `excluir`): o botão "…" da linha da lista e do cartão do Kanban tem "Excluir", com confirmação. Na Lista, cada linha tem uma caixinha e há "Marcar todos os visíveis"; com algo marcado aparece a barra "N selecionados · Excluir selecionados · Desmarcar", que acompanha a rolagem. A seleção vale só para o que está na tela: mudar busca ou filtro desmarca o que sumiu, e tudo é desmarcado depois de excluir ou ao trocar para o Kanban. A confirmação mostra a quantidade; **acima de 50 contatos** pede para digitar EXCLUIR antes de liberar o botão; se a seleção tiver **clientes fechados**, avisa "Inclui N clientes fechados" e oferece "Excluir só os que não são clientes" (marcada de início) ou "Excluir todos". Um contato é apagado direto na tabela; vários vão pela função `prospects_excluir_lote`, que grava na auditoria. Se o banco recusar algum, o aviso diz quantos ficaram de fora. Não há "desfazer".
  - **Importar planilha** (só para quem tem `importar`): botão na barra da aba Contatos. Aceita Excel (.xlsx) ou CSV, até 2.000 linhas, com os títulos na primeira linha. Três passos: escolher o arquivo; ligar cada campo do sistema a uma coluna da planilha (o sistema já sugere pelo título: "Celular" vira Telefone, "Município" vira Cidade etc.); ver a prévia das 10 primeiras linhas como vão ficar. A prévia avisa quantas linhas ficam de fora sem nome, quantos e-mails e CNPJs inválidos vão em branco e quantos contatos parecem repetidos (mesmo CNPJ, telefone ou nome, na lista que a pessoa enxerga ou dentro da planilha). Para enviar, a pessoa marca "Declaro que estes contatos foram obtidos de forma legítima e que posso usá-los para contato comercial". Nada entra direto na lista: vai para a aprovação da PHAR. Arquivo .xls antigo ou outro formato: a tela pede para salvar como .xlsx ou CSV.
  - **Minhas importações**: caixa recolhível na aba Contatos, para quem tem `importar`, com o estado de cada envio (Aguardando aprovação; Concluída, com quantos entraram e quantos repetidos ficaram de fora; ou Recusada, com o motivo). O responsável vê os envios de toda a empresa; o colaborador, só os dele. Aparece só quando já houve algum envio.
  - **Baixar planilha (CSV)**: só aparece se a PHAR liberou a exportação para a empresa (parte 8) e a pessoa é o responsável ou tem a permissão `exportar`. Os dados vêm da função `exportar_contatos`, que confere tudo no banco e registra a exportação; a planilha traz os contatos que a pessoa enxerga, com Responsável, Cadastrado por, Cliente desde e CNPJ. Se o prazo vencer com a tela aberta, o botão some e aparece o aviso de que a exportação não está liberada.
- **Buscar leads**: busca empresas na base da Receita por estado, cidades (várias), ramo (CNAE principal ou também secundário), nome, CNPJ, bairro, porte (MEI, ME, EPP, demais), data de abertura, só com telefone e só com e-mail. Resultado em páginas de 50, com contagem total, selo MEI e "Já na lista". O vendedor marca as empresas e clica em "Adicionar à minha lista": elas viram contatos "A contatar", origem "Base da Receita", sem duplicar CNPJ. Só aparece para quem tem a permissão `buscar_leads`. Detalhes na parte 17.
- **Equipe**: quem usa a conta. O responsável adiciona colaboradores pelo e-mail e marca as permissões nas caixinhas.
- **Empresa**: cadastro completo da empresa. Só o responsável altera.

**Painel administrativo (`/admin`)**: só para a conta administradora. Mostra números gerais, gráficos de todas as empresas e a lista de empresas com os botões Liberar, Recusar, Bloquear, Reativar e Simular, além de "Baixar backup (CSV)". Cada empresa tem também a linha **Exportação de contatos**, com o selo da situação ("Bloqueada", "Liberada sem prazo", "Liberada até 23/10 às 20:03" ou "Prazo vencido em …") e os botões "Liberar sem prazo", "Liberar por 24 horas" (ou "Mais 24 horas", que renova o prazo) e "Bloquear exportação".

No topo do `/admin` fica a seção **Importações pendentes** (aparece quando há alguma importação): para cada envio, a empresa, o arquivo, quantas linhas, quem enviou e quando, a data da declaração de origem, quantos contatos a empresa já tem (com alerta se puder passar de 10.000) e a prévia das 10 primeiras linhas já limpas. Botões **Aprovar N contatos** e **Recusar**, que pede o motivo (o cliente vê). Abaixo, "Últimas importações decididas" mostra as 10 mais recentes. Abrir o `/admin` também faz a limpeza: envio pendente há mais de 30 dias vence (vira recusado com o motivo "Venceu: 30 dias sem análise.") e as linhas de espera de envios decididos ou vencidos são apagadas.

Status de um contato, na ordem do funil: A contatar, Contato feito, Em conversa, Reunião ou diagnóstico, Proposta enviada, Não é o momento, Fechado, Sem interesse.

## 6. Os arquivos do código

```
phar-prospector/
├── README.md                 resumo para quem abre o repositório
├── CLAUDE.md                 regras que o Claude segue neste projeto (inclui: sempre atualizar a documentação)
├── package.json              dependências e comandos (build, dev, schema)
├── package-lock.json         versões exatas das dependências
├── build.mjs                 monta a pasta dist/ e minifica JS e CSS
├── vercel.json               configuração da Vercel: build, endereços limpos e cabeçalhos de segurança
├── servidor-local.mjs        servidor para testar no computador (com RECEITA_DIR, serve também a base da Receita local)
├── .gitignore                o que não vai para o GitHub (node_modules, dist, .env)
├── docs/
│   ├── DOCUMENTACAO.md       este documento
│   ├── PLANO-PROSPECCAO.md   plano das próximas funções (busca de leads, qualificação, IA)
│   └── PLANO-CRM.md          plano para virar CRM: Kanban, excluir, importar, exportação travada, landing page, clientes
├── scripts/
│   ├── gerar-schema.mjs      junta as migrações em supabase/schema-completo.sql
│   ├── parquet-entrada.js    entrada do pacote vendor/parquet.js (leitor de Parquet do navegador)
│   └── receita/              base da Receita: processar.py, enviar.py, requirements.txt e README.md (parte 17)
├── vendor/
│   └── xlsx-0.20.3.mini.min.js  leitor de Excel (SheetJS 0.20.3, baixado uma vez de cdn.sheetjs.com, versão fixa)
├── backup/
│   └── google-planilhas.gs   script do backup no Google Planilhas
├── supabase/
│   ├── schema-completo.sql   o banco inteiro em um arquivo (para recriar do zero)
│   └── migrations/           o banco em etapas, na ordem em que foi construído
└── src/                      o site
    ├── index.html            página principal
    ├── entrar.html           entrar e criar conta
    ├── app.html              o sistema
    ├── admin.html            painel administrativo
    ├── favicon.svg           ícone da aba
    ├── css/estilo.css        todo o visual (cores e fontes da PHAR)
    └── js/
        ├── config.js         endereço e chave pública do Supabase
        ├── comum.js          conexão, sessão, datas, CPF e CNPJ; usado por todas as páginas
        ├── entrar.js         tela de entrar
        ├── app.js            o sistema (painel, contatos, equipe, empresa)
        ├── buscar.js         aba Buscar leads (lê a base da Receita e adiciona à lista)
        ├── importar.js       importar planilha (Excel ou CSV) e "Minhas importações"
        ├── admin.js          painel administrativo
        ├── graficos.js       gráficos de rosca e de linha, sem biblioteca externa
        └── grade.js          desenho da grade de pontos da marca
```

Dependências: `@supabase/supabase-js` 2.45.4, que conversa com o banco; `hyparquet` 1.31.2 e `fzstd` 0.1.1, que leem e descompactam a base da Receita no navegador (JavaScript puro, sem WebAssembly); `esbuild` 0.23.1, que minifica o código no build; e a SheetJS 0.20.3 (versão "mini", ~280 KB), que lê planilhas do Excel na importação. A SheetJS não vem do npm (a versão de lá está parada e tem falhas conhecidas): o arquivo foi baixado uma vez do site oficial (`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js`, SHA-256 `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939`) e fica guardado em `vendor/`. Para trocar de versão, baixe o arquivo novo do mesmo lugar e mude o nome em `vendor/` e no `build.mjs`. Não há framework.

O que o `build.mjs` faz: copia `src/` para `dist/`, copia a biblioteca do Supabase para `dist/vendor/`, copia o leitor de Excel para `dist/vendor/xlsx.mini.min.js` (o site só o carrega quando alguém escolhe um arquivo .xlsx), monta `dist/vendor/parquet.js` (hyparquet + fzstd, ~62 KB) e minifica os arquivos de `js/` e `css/`. O site publicado recebe o código minificado; o código legível fica só no repositório privado.

As migrações, na ordem:

| Arquivo | O que criou |
|---|---|
| `20261009142509_estrutura_inicial.sql` | Contas, contatos e as primeiras regras |
| `20261009180000_empresas_e_equipe.sql` | Empresas com vários usuários, convites, auditoria |
| `20261009180100_funcoes_sessao_equipe.sql` | Sessão e funções da equipe |
| `20261009180150_funcoes_admin.sql` | Funções do painel administrativo |
| `20261009180200_limpeza.sql` | Remoção do que sobrou da primeira versão |
| `20261009190000_dados_da_empresa.sql` | Cadastro completo da empresa |
| `20261009200000_permissoes_da_equipe.sql` | Permissões por colaborador |
| `20261015160000_busca_receita.sql` | Colunas de CNPJ no contato, CNPJ único por empresa, permissão `buscar_leads` e as funções da aba Buscar leads |
| `20261022190000_kanban_responsavel.sql` | Kanban (Fase A do `PLANO-CRM.md`): colunas `responsavel` e `cliente_desde` no contato, gatilho `regras_prospect`, regras de acesso que incluem o responsável e backup com as duas colunas |
| `20261022200000_excluir_lote.sql` | Excluir em lote (Fase B do `PLANO-CRM.md`): função `prospects_excluir_lote` e registro `excluir_lote` na auditoria |
| `20261022210000_exportacao_travada.sql` | Exportação travada (Fase D do `PLANO-CRM.md`): colunas `exportacao_liberada` e `exportacao_ate` na empresa, funções `exportar_contatos` e `admin_exportacao`, `minha_sessao` e `admin_empresas` informando a situação da exportação |
| `20261022220000_importacao_aprovada.sql` | Importar com aprovação (Fase C do `PLANO-CRM.md`): permissão `importar`, tabelas `private.importacoes` e `private.importacao_linhas`, funções `importacao_enviar`, `importacoes_minhas`, `admin_importacoes`, `admin_importacao_aprovar` e `admin_importacao_recusar`, conferência de CNPJ no banco (`private.cnpj_valido`) e exceção da importação nos gatilhos `limite_prospects` e `regras_prospect` |

## 7. O banco de dados

O banco tem dois grupos de objetos. O grupo `public` é o que o site alcança. O grupo `private` fica fora do alcance do navegador e guarda tabelas internas e funções de apoio.

### Tabelas

**`public.empresas`** — uma linha por empresa cliente.

| Coluna | Conteúdo |
|---|---|
| `id` | identificador |
| `nome` | nome que aparece no topo do sistema (1 a 120 letras) |
| `status` | `pendente`, `ativa` ou `bloqueada`. Controla o acesso de todos os usuários da empresa |
| `criado_em`, `liberado_em` | quando foi criada e quando foi liberada |
| `razao_social`, `segmento`, `telefone`, `email`, `site`, `instagram`, `descricao` | dados do cadastro |
| `documento` | CPF (11 números) ou CNPJ (14 posições, com letras no formato novo), sem pontuação |
| `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf` | endereço; CEP com 8 números, UF com 2 letras |
| `dados_em` | última vez que o cadastro foi salvo |
| `exportacao_liberada` | se a PHAR liberou a exportação de contatos da empresa. Começa desligada; só o administrador muda (`admin_exportacao`) |
| `exportacao_ate` | prazo da liberação ("Liberar por 24 horas"). Nulo = sem prazo. Vale como liberada só se `exportacao_liberada` e (`exportacao_ate` nulo ou no futuro) |

**`public.profiles`** — uma linha por pessoa com login.

| Coluna | Conteúdo |
|---|---|
| `id` | o mesmo id do login (tabela `auth.users` do Supabase) |
| `nome` | nome da pessoa |
| `empresa` | texto digitado no cadastro (histórico; o vínculo de verdade é `empresa_id`) |
| `empresa_id` | empresa da pessoa. Cada pessoa pertence a uma empresa só |
| `papel` | `dono` (responsável) ou `membro` (colaborador) |
| `permissoes` | o que o colaborador pode ver e fazer (parte 8). Vazio significa os valores iniciais |
| `status` | `ativa` ou `bloqueada` (quem foi removido da equipe fica bloqueado) |
| `is_admin` | verdadeiro só para o administrador do sistema |
| `simulando` | só para o admin: empresa que ele está vendo no modo simular |
| `criado_em`, `liberado_em` | datas |

**`public.prospects`** — os contatos de prospecção.

| Coluna | Conteúdo |
|---|---|
| `id` | identificador |
| `empresa_id` | empresa dona do contato |
| `user_id` | quem cadastrou. Se a pessoa for excluída, o contato continua na empresa |
| `responsavel` | pessoa da equipe que cuida do contato (índice `prospects_responsavel_idx`). Começa em quem cadastrou. Só o responsável pela conta ou o admin em modo simular troca, e só por alguém da mesma empresa (gatilho `regras_prospect`) |
| `cliente_desde` | data em que o contato virou "Fechado". O banco grava (data de hoje, horário de Brasília) ao mudar para `cliente` e limpa ao sair; o que a tela mandar é ignorado. Edição manual fica para a Fase F do `PLANO-CRM.md` |
| `empresa`, `contato`, `cargo`, `telefone`, `email`, `cidade`, `uf`, `segmento`, `porte`, `origem`, `link`, `interesse` | dados do contato. Precisa ter empresa ou pessoa de contato |
| `status` | `novo`, `contatado`, `conversa`, `diagnostico`, `proposta`, `depois`, `cliente` ou `perdido` |
| `proximo_contato`, `ultimo_contato` | datas do retorno marcado e da última conversa |
| `observacoes` | texto livre, até 4.000 letras |
| `cnpj` | CNPJ só com letras e números (14 posições) ou vazio. O mesmo CNPJ não entra duas vezes na mesma empresa (índice único `prospects_empresa_cnpj_uidx`) |
| `razao_social`, `cnae`, `situacao`, `abertura`, `porte_receita` | dados da Receita: razão social, CNAE principal, situação, data de abertura e porte (MEI, ME, EPP, DEMAIS) |
| `endereco` | endereço em uma linha (logradouro, número, complemento, bairro, cidade e CEP) |
| `historico` | lista das conversas (data, canal, anotação, status, quem registrou), até 200 itens |
| `criado_em`, `atualizado_em` | datas, sempre definidas pelo banco |

**`private.convites`** — e-mails autorizados pelo responsável. Colunas: `empresa_id`, `email` (único), `estado` (`pendente`, `aceito`, `cancelado`), `permissoes`, `criado_por`, `criado_em`. O convite não é apagado: muda de estado.

**`private.importacoes`** — envios de planilha aguardando ou já decididos. Colunas: `empresa_id`, `enviado_por`, `arquivo` (nome), `linhas` (até 2.000), `estado` (`pendente`, `recusada` ou `concluida`; `aprovada` existe na regra mas não é usada, porque a aprovação grava tudo na hora e já marca `concluida`), `motivo` (da recusa), `declarado_por` e `declarado_em` (a declaração de origem legítima: quem marcou e quando), `inseridos` e `pulados` (resultado da aprovação), `decidido_por`, `decidido_em`, `criado_em`. O registro do envio não é apagado.

**`private.importacao_linhas`** — fila de espera: uma linha da planilha por registro (`importacao_id`, `n`, `dados` em jsonb), já limpa. É apagada ao aprovar, ao recusar ou depois de 30 dias. Os contatos nunca vão direto para `prospects`.

**`private.auditoria`** — registro de ações: `admin_id` (quem fez), `acao`, `empresa_id`, `detalhe`, `criado_em`. Ações do administrador: `status`, `simular_inicio`, `simular_fim`, `exportar` (backup geral) e `exportacao` (liberar ou bloquear a exportação de uma empresa; `detalhe` diz `liberar`, `liberar_24h até DD/MM/AAAA HH:MM` ou `bloquear`). Ações dos usuários: `exportar_contatos` (cada planilha baixada; quem, empresa e `contatos=N` no detalhe) e `excluir_lote`, descrita a seguir. Importação: `importacao_aprovada` (`linhas=N; inseridos=X; pulados=Y`) e `importacao_recusada` (`linhas=N; motivo=…`), com o administrador em `admin_id`. Desde 22 out 2026, `excluir_lote`: cada exclusão em lote feita por qualquer usuário grava quem excluiu (em `admin_id`, apesar do nome), a empresa e, em `detalhe`, `excluidos=N; pedidos=M`. Os dados excluídos não são guardados. Para ver no SQL Editor do Supabase:

```sql
select a.criado_em, p.nome as quem, e.nome as empresa, a.detalhe
from private.auditoria a
left join public.profiles p on p.id = a.admin_id
left join public.empresas e on e.id = a.empresa_id
where a.acao in ('excluir_lote', 'exportar_contatos', 'exportacao', 'importacao_aprovada', 'importacao_recusada')
order by a.criado_em desc;
```

### Limites definidos no banco

- 10.000 contatos por empresa.
- 20 pessoas por equipe, contando os e-mails autorizados que ainda não se cadastraram.
- 200 registros de conversa por contato.
- Importação: até 2.000 linhas por envio e até 3 envios aguardando aprovação por empresa. Envio que faria a empresa passar de 10.000 contatos é recusado já no envio; na aprovação, o banco confere de novo, sem contar os repetidos.

### Funções que o site chama

Todas exigem login. Cada uma confere, dentro do banco, se quem chamou tem permissão.

| Função | Quem pode | O que faz |
|---|---|---|
| `minha_sessao()` | qualquer pessoa logada | Devolve quem é a pessoa, a empresa (com `exportacao_liberada`, já considerando o prazo, e `exportacao_ate`), as permissões e se está em modo simular. Também faz o colaborador autorizado entrar na equipe no primeiro acesso |
| `equipe_listar()` | pessoa de empresa ativa | Lista a equipe. O responsável recebe também as permissões de cada um e os e-mails aguardando cadastro. Quem não pode ver a equipe recebe só a própria linha |
| `equipe_autorizar(p_email, p_permissoes)` | responsável | Autoriza um e-mail, já com as permissões marcadas |
| `equipe_permissoes(p_permissoes, p_usuario, p_convite)` | responsável | Muda as permissões de um colaborador ou de um e-mail autorizado |
| `equipe_cancelar_convite(p_id)` | responsável | Cancela uma autorização pendente |
| `equipe_remover(p_usuario)` | responsável | Tira o acesso de um colaborador |
| `empresa_salvar(p)` | responsável | Grava o cadastro completo da empresa, conferindo formato de documento, CEP, UF e e-mail |
| `empresa_renomear(p_nome)` | responsável | Troca só o nome (o site usa `empresa_salvar`) |
| `admin_empresas()` | administrador | Lista as empresas com usuários, contagem de contatos e dados do cadastro |
| `admin_empresa_status(alvo, novo)` | administrador | Libera, bloqueia ou devolve para pendente |
| `admin_simular(alvo)` | administrador | Entra no modo simular de uma empresa; sem `alvo`, sai |
| `admin_painel()` | administrador | Números para os gráficos do painel administrativo |
| `admin_exportar()` | administrador | Todos os dados de todas as empresas, para o backup. Não depende da trava de exportação |
| `admin_exportacao(alvo, modo)` | administrador | Liberar (`liberar`), liberar por 24 horas (`liberar_24h`) ou bloquear (`bloquear`) a exportação de contatos de uma empresa. Grava na auditoria |
| `exportar_contatos()` | responsável ou quem tem `exportar`, com a empresa liberada | Devolve os contatos que a pessoa enxerga, para a planilha. Roda com o login de quem chamou (valem as regras da tabela) e grava cada exportação na auditoria. O admin em modo simular segue a regra da empresa simulada: sem liberação, também não exporta |
| `importacao_enviar(p_arquivo, p_linhas, p_declaro)` | responsável ou quem tem `importar`, com a empresa ativa | Põe a planilha na fila de aprovação. Exige `p_declaro = true` e guarda quem declarou e quando. Limpa cada linha (telefone só com números; e-mail em minúsculas, inválido fica vazio; CNPJ conferido pelos dígitos, inválido fica vazio; UF só se existir; textos cortados no tamanho da tabela) e descarta linha sem empresa nem pessoa. Recusa mais de 2.000 linhas, o 4º envio pendente e o que passaria de 10.000 contatos |
| `importacoes_minhas()` | responsável ou quem tem `importar` | Os 20 envios mais recentes: da empresa toda para o responsável, só os próprios para o colaborador |
| `admin_importacoes()` | administrador | Faz a limpeza (vencidos e linhas antigas) e devolve os envios pendentes, com prévia de 10 linhas, e os 10 últimos decididos |
| `admin_importacao_aprovar(p_id)` | administrador | Grava as linhas em `prospects` como "A contatar", origem "Importação", com "Importado em DD/MM/AAAA (planilha "nome")." no começo das observações. Quem enviou fica como "cadastrado por" e responsável (se saiu da empresa, o contato fica sem os dois). Pula repetidos: mesmo CNPJ, mesmo telefone (8 números ou mais) ou mesmo nome (empresa, ou pessoa se não houver empresa) já na lista da empresa ou antes na própria planilha. Se não couber no limite de 10.000, não grava nada e avisa quanto espaço há. Apaga as linhas de espera e grava na auditoria |
| `admin_importacao_recusar(p_id, p_motivo)` | administrador | Recusa com motivo obrigatório (até 300 letras), apaga as linhas de espera e grava na auditoria |
| `prospects_cnpjs_existentes(p_cnpjs)` | quem tem `buscar_leads` | Diz quais destes CNPJs já estão na lista da empresa (só os CNPJs, nenhum outro dado), para marcar "Já na lista". Até 1.000 por vez |
| `prospects_adicionar_lote(p_linhas)` | quem tem `buscar_leads` e `criar` | Adiciona até 200 empresas de uma vez como contatos "A contatar". Roda com o login de quem chamou, então valem as regras da tabela e o limite de 10 mil. CNPJ repetido é pulado e contado |
| `prospects_excluir_lote(p_ids)` | quem tem `excluir` | Exclui até 10.000 contatos de uma vez. Roda com o login de quem chamou: valem as regras da tabela, e o que a pessoa não alcança é pulado e contado. Devolve `excluidos` e `pulados` e, se excluiu algum, grava uma linha `excluir_lote` na auditoria (função de apoio `private.registrar_exclusao`) |

Os contatos não passam por função (exceto a adição em lote da aba Buscar leads e a exclusão em lote): o site lê e grava direto na tabela `prospects`, e as regras da tabela decidem o que cada pessoa alcança. O cadastro da empresa é lido direto da tabela `empresas`.

Funções de apoio (grupo `private`): `minha_empresa()`, `conta_ativa()`, `sou_dono()`, `em_simulacao()`, `is_admin()`, `pode(chave)`, `permissoes_padrao()`, `permissoes_limpas()`, `empresa_completa()`, `nome_empresa_padrao()`, `cnpj_valido()`, `importacao_linha_limpa()`, `importando()`. `equipe_convidar(p_email)` continua existindo, mas só é chamada por dentro de `equipe_autorizar`.

Ações automáticas (gatilhos):

- Ao criar um login, o banco cria a linha em `profiles`. Se o e-mail não estava autorizado por ninguém, cria também uma empresa nova, pendente, com a pessoa como responsável.
- Ao cadastrar um contato, o banco grava quem cadastrou e confere o limite da empresa. Exceção: dentro de `admin_importacao_aprovar` (que liga a marca `pp.importando` só naquela transação; ela só vale se quem chamou for administrador, conferido por `private.importando()`), o banco mantém quem enviou a planilha como autor e responsável, e o limite já foi conferido antes, de uma vez. Um usuário comum não consegue usar essa exceção (testado).
- Ao editar um contato, o banco não deixa trocar a empresa, o autor nem a data de criação.
- Ao cadastrar ou editar um contato (`regras_prospect`): colaborador que cadastra fica como responsável (mesmo que tente indicar outro); só o responsável pela conta ou o admin simulando troca o responsável (os demais recebem erro de permissão, mesmo com "editar"); o responsável precisa ser da mesma empresa; `cliente_desde` é gravado ou limpo conforme o status.

### Regras de acesso das tabelas

| Tabela | Ler | Criar | Editar | Excluir |
|---|---|---|---|---|
| `prospects` | da própria empresa, com a empresa ativa; sem "ver todos", só os que a pessoa cadastrou ou dos quais é responsável | com a permissão "cadastrar" | com a permissão "editar", nos contatos que a pessoa enxerga (trocar o responsável: só o responsável pela conta) | com a permissão "excluir", nos contatos que a pessoa enxerga |
| `empresas` | só a própria, com a permissão "ver dados da empresa" | não | só pela função `empresa_salvar` | não |
| `profiles` | só a própria linha | não | não | não |
| `convites`, `auditoria`, `importacoes`, `importacao_linhas` | fora do alcance do site (só pelas funções) | | | |

Quem não está logado não lê nem grava nada.

## 8. Quem pode o quê

Há três papéis.

**Administrador do sistema** (você). Entra em `/admin`. Libera e bloqueia empresas, aprova ou recusa importações de planilha, simula o acesso de qualquer uma (vê e edita como ela) e baixa o backup. Cada simulação, exportação e mudança de situação fica registrada na auditoria.

**Responsável pela conta** (quem criou a conta da empresa). Pode tudo dentro da empresa: contatos, equipe, permissões e cadastro da empresa. É o único que troca o responsável de um contato.

**Colaborador**. Pode o que o responsável marcou:

| Permissão | Chave no banco | Começa | Vale onde |
|---|---|---|---|
| Ver o painel com os gráficos | `ver_painel` | marcada | só na tela |
| Ver os contatos de toda a equipe | `ver_todos` | marcada | no banco. Desmarcada, a pessoa vê, edita e exclui só os contatos que ela mesma cadastrou ou dos quais é responsável |
| Ver quem faz parte da equipe | `ver_equipe` | marcada | no banco |
| Ver os dados da empresa | `ver_empresa` | marcada | no banco |
| Cadastrar contatos | `criar` | marcada | no banco |
| Editar contatos e registrar conversas | `editar` | marcada | no banco |
| Excluir contatos | `excluir` | desmarcada | no banco |
| Baixar a planilha de contatos (CSV) | `exportar` | desmarcada | no banco (`exportar_contatos`). Só vale se a PHAR liberar a exportação para a empresa; sem isso, nem o responsável exporta |
| Importar planilha de contatos | `importar` | desmarcada | no banco (`importacao_enviar` e `importacoes_minhas`). Cada envio só vira contato depois da aprovação da PHAR. Colaboradores que já existiam também começam sem |
| Buscar leads na base da Receita | `buscar_leads` | marcada | no banco (as duas funções da busca conferem). Para adicionar à lista precisa também de `criar` |

"Só na tela" quer dizer que o sistema esconde a aba ou o botão, mas não é uma trava de dados. A trava de verdade é "ver os contatos de toda a equipe".

**Exportação travada (desde 22 out 2026).** Por padrão nenhuma empresa exporta, nem o responsável. Só o administrador geral libera, no `/admin`, sem prazo ou por 24 horas. Com a empresa liberada, exporta o responsável ou quem tem `exportar`.

**Importação com aprovação (desde 22 out 2026).** Nenhuma planilha entra direto: o responsável ou quem tem `importar` envia, e só o administrador geral aprova. Não há aprovação automática, nem para quem já usa o sistema há tempo (decisão do Pedro).

**Limite da trava.** Ela impede baixar a planilha, mas não impede que alguém leia os contatos que já enxerga: dá para copiar à mão da tela, e quem tem conhecimento técnico consegue consultar o banco direto com o próprio login, porque a lista do sistema precisa dessa leitura para funcionar. O que limita quem vê o quê continua sendo "ver os contatos de toda a equipe". A auditoria registra cada planilha baixada.

Como funciona o convite: o responsável informa o e-mail na aba Equipe e marca as caixinhas. O sistema não envia e-mail. A pessoa cria a conta em `/entrar?modo=criar` com aquele e-mail, confirma, e no primeiro acesso entra direto na equipe com as permissões marcadas. As permissões podem ser mudadas depois, no botão Permissões.

Ciclo de uma empresa: nasce **pendente** quando alguém cria conta, fica **ativa** quando o administrador libera e pode ser **bloqueada**. Enquanto não está ativa, ninguém dela lê nem grava contatos.

## 9. Segurança

- **Separação entre empresas no banco.** Cada tabela tem regras (RLS) que o banco aplica em todo pedido. Mesmo que alguém altere o site no próprio navegador, não alcança dados de outra empresa.
- **Permissões conferidas no banco.** Ver todos os contatos, cadastrar, editar, excluir, ver equipe e ver dados da empresa são decididos pelo banco, não pela tela.
- **Sem chave secreta no site.** O navegador usa só a chave pública.
- **Cabeçalhos de segurança** em `vercel.json`: o site só carrega scripts dele mesmo (por isso o leitor de Excel fica guardado em `vendor/` e é servido pelo próprio site), só se conecta ao próprio Supabase, ao Hugging Face (`huggingface.co` e `*.hf.co`, base da Receita) e à BrasilAPI (consulta de um CNPJ na aba Buscar leads), e não pode ser aberto dentro de outra página. Por causa disso, não se usa `style=` nem `<script>` solto dentro do HTML.
- **Código minificado.** Dificulta a leitura, mas não é o que protege o sistema. Código que roda no navegador sempre pode ser lido. O que impede a cópia do negócio são o repositório privado e as regras no banco.
- **Páginas com login não são indexadas** pelo Google (`noindex`) e não ficam guardadas em cache.

Avisos que o Supabase mostra e que são esperados:

- "Signed-In Users Can Execute SECURITY DEFINER Function": as funções do site rodam com poder elevado de propósito, e cada uma confere a permissão por dentro.
- "Leaked Password Protection Disabled": a checagem de senhas vazadas está desligada. Vale ligar em Authentication > Sign In / Providers > Email quando o plano permitir.

Como as regras foram testadas: em cada mudança de banco, um teste cria usuários de mentira, tenta cada ação permitida e proibida e desfaz tudo no fim. Na versão atual foram 22 verificações de permissão no banco real e 28 no banco de teste, todas aprovadas. Na migração da busca na Receita (15 out 2026), mais 11 verificações no banco real: CNPJ repetido pulado, CNPJ inválido barrado, empresa não enxerga CNPJ de outra, sem `buscar_leads` barrado, sem `criar` barrado; tudo desfeito no fim. No Kanban (22 out 2026), mais 16 verificações no banco real, dentro de uma transação desfeita no fim: responsável começa em quem cadastrou, colaborador não consegue se pôr como outro nem trocar o responsável (com ou sem `ver_todos`), responsável de outra empresa barrado, colaborador sem `ver_todos` vê, edita e exclui o contato do qual é responsável e não alcança o do dono, `cliente_desde` gravado ao fechar (ignorando data mandada pela tela) e limpo ao reabrir, outra empresa não enxerga, admin simulando troca. Na exclusão em lote (22 out 2026), mais 10 verificações no banco real, desfeitas no fim: sem `excluir` barrado; colaborador sem `ver_todos` que manda 8 contatos (inclusive de outra empresa) exclui só os 2 dele e os outros 6 são contados como pulados; o dono exclui os da empresa e o da outra empresa continua; chamada sem nada para excluir não grava auditoria; o usuário não lê a auditoria; cada exclusão grava uma linha com quem e a contagem; quem não está logado não chama a função. Com isso a regra de excluir contatos também passou a ser testada no banco real (antes, só no banco de teste). Na exportação travada (22 out 2026), mais 21 verificações no banco real, desfeitas no fim: empresa começa bloqueada (até para o responsável) e a sessão informa isso; o responsável não se libera nem pela função nem mexendo na coluna; admin em modo simular também é barrado antes da liberação; liberada, exportam o admin simulando, o responsável (com os nomes certos) e o colaborador com `exportar`; colaborador sem `exportar` é barrado; colaborador sem `ver_todos` exporta só os seus; outra empresa continua barrada; "24 horas" grava o prazo e o painel admin mostra; prazo vencido barra e a sessão passa a dizer bloqueada; bloquear barra de novo; a auditoria registra as 4 mudanças do admin e cada exportação que deu certo (as barradas não); quem não está logado não chama as funções. Na importação com aprovação (22 out 2026), mais 24 verificações no banco real, desfeitas no fim: conferência de CNPJ (válido, válido com letras, inválido); colaborador sem `importar` barrado (e `pode` diz não); responsável pode; sem a declaração, barrado; 2.001 linhas barradas; envio de 6 linhas guarda 5 (a sem nome fica de fora) já limpas (telefone só números, e-mail em minúsculas, e-mail e CNPJ inválidos em branco, UF conferida) e com a declaração (quem e quando); o usuário não lê as tabelas da fila; um usuário comum que liga a marca da importação continua gravando em nome próprio; o responsável não chama as funções do admin; o 4º envio pendente é barrado; colaborador vê só os próprios envios, o responsável vê os 3, outra empresa vê 0; o admin vê os pendentes com prévia; envio com mais de 30 dias vence e perde as linhas; aprovar grava 2 e pula 3 (CNPJ repetido na planilha, telefone repetido na planilha e nome já na lista); aprovar de novo é barrado; recusar sem motivo é barrado; contatos entram com origem "Importação", observação com data e planilha, autor e responsável certos (inclusive o colaborador que enviou); linhas de espera apagadas; auditoria com as duas aprovações.

## 10. Backup

### O que existe

**Planilha do Google (automático).** O script em `backup/google-planilhas.gs` entra no sistema com a conta administradora, chama `admin_exportar` e reescreve a planilha: uma aba por empresa com todos os contatos e a aba "Resumo" com data, totais e dados do cadastro de cada empresa. Com o agendamento ligado, roda todo dia entre 3h e 4h.

**CSV pelo painel administrativo (manual).** O botão "Baixar backup (CSV)" gera um arquivo com todos os contatos de todas as empresas.

**CSV pela empresa (manual).** Na aba Contatos, "Baixar planilha (CSV)" gera os contatos da própria empresa (com as colunas Responsável, Cliente desde e CNPJ). Só funciona se a PHAR liberar a exportação para a empresa (parte 8); o backup geral do administrador não depende disso.

Desde 22 out 2026, `admin_exportar` devolve também `responsavel` (nome) e `cliente_desde`. O CSV do painel admin já traz as duas colunas; na planilha do Google elas aparecem depois que o script `backup/google-planilhas.gs` atualizado for colado de novo no Apps Script (o script antigo continua funcionando, só sem essas colunas).

### O que o backup não guarda

- **Logins e senhas.** Senha nunca sai do Supabase. Em uma reconstrução, cada pessoa cria a conta de novo.
- **Permissões de cada colaborador e e-mails autorizados.**
- **O registro de auditoria.**

### Instalar o backup em uma planilha nova

1. Crie uma planilha em branco na conta Google onde o backup deve ficar.
2. Menu Extensões > Apps Script. Apague o que estiver lá, cole o arquivo `backup/google-planilhas.gs` inteiro e salve.
3. Volte para a planilha e recarregue a página. Aparece o menu "Backup PHAR".
4. Backup PHAR > 1. Configurar acesso: informe o e-mail e a senha da conta administradora do sistema.
5. Backup PHAR > 2. Fazer backup agora. Na primeira vez o Google pede autorização.
6. Backup PHAR > 3. Agendar backup diário.

O e-mail e a senha ficam guardados nas propriedades do seu usuário dentro do script; só a sua conta Google lê. Se trocar a senha no sistema, rode "Configurar acesso" de novo.

### Backup completo do banco (opcional, manual)

O plano gratuito do Supabase não deixa baixar os backups automáticos. Para ter uma cópia exata do banco, incluindo logins, o caminho é um despejo feito no seu computador com a senha do banco:

1. No Supabase, clique em Connect (no topo do projeto) e copie a linha de conexão do tipo "Session pooler".
2. Troque `[YOUR-PASSWORD]` pela senha do banco e rode no terminal do seu computador:

```
pg_dump "LINHA-DE-CONEXAO-COPIADA" --schema=public --schema=private --schema=auth --no-owner > phar-prospector-banco.sql
```

Isso exige o programa `pg_dump` (vem com o PostgreSQL). Não faça isso por conversa com IA: a senha do banco não deve sair do seu computador. Este procedimento ainda não foi testado neste projeto.

## 11. Como publicar uma mudança

O caminho normal:

1. Você pede a mudança no Claude (ou edita os arquivos de `src/`).
2. A mudança é enviada para a branch `main` do GitHub.
3. A Vercel percebe o envio, roda `npm run build` e publica em cerca de um minuto.

**Toda mudança atualiza esta documentação no mesmo envio.** É regra fixa do projeto, escrita no arquivo `CLAUDE.md`, que o Claude lê sozinho ao abrir o repositório. O PDF e o kit de reconstrução são fotos de uma data: são gerados de novo a pedido ou depois de mudança grande.

Quando a mudança mexe no banco:

1. Cria-se um arquivo novo em `supabase/migrations/`, com data no nome.
2. O SQL é aplicado no Supabase.
3. Roda-se `npm run schema` para atualizar `supabase/schema-completo.sql`.
4. Tudo vai junto para o GitHub.

Comandos que removem coisas (`drop`, `delete`) pedem confirmação no Supabase. O costume do projeto é preferir mudanças que só acrescentam e rodar pelo SQL Editor o que precisar remover.

Testar no computador:

```
npm install
npm run dev
```

Depois abra http://localhost:5173. O site local usa o mesmo banco do site publicado. Para testar a aba Buscar leads com uma base gerada no computador: `RECEITA_DIR=pasta-de-saida npm run dev` (parte 17).

## 12. Reconstruir do zero

Use o cenário que corresponde ao que foi perdido. O kit de reconstrução (ZIP) tem tudo o que os passos pedem.

### Cenário A — perdi só a conta do Claude

Nada sai do ar. O código está no GitHub e este documento também. Para continuar pedindo mudanças em uma conta nova do Claude: conecte o GitHub e o Supabase na conta nova e peça para ler `docs/DOCUMENTACAO.md` antes de qualquer mudança.

### Cenário B — perdi a Vercel (o site saiu do ar)

1. Crie uma conta na Vercel e clique em Add New > Project.
2. Importe o repositório `Dev-for-px/phar-prospector` do GitHub.
3. Não mude nenhuma configuração: o arquivo `vercel.json` já informa o comando de build e a pasta de saída. Framework Preset fica em "Other". Não há variáveis de ambiente.
4. Clique em Deploy.
5. Se o endereço mudar, atualize o Supabase: Authentication > URL Configuration, campos Site URL e Redirect URLs (veja o passo 6 do cenário D).

### Cenário C — perdi o GitHub

1. Crie um repositório privado novo.
2. Descompacte o kit, entre na pasta `codigo/` e envie para o repositório:

```
git init
git add .
git commit -m "PHAR Prospector"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/phar-prospector.git
git push -u origin main
```

3. Na Vercel, em Settings > Git, conecte o projeto ao repositório novo.

### Cenário D — perdi o Supabase (banco e login)

1. Crie um projeto novo no Supabase, de preferência na região São Paulo. Guarde a senha do banco no gerenciador de senhas.
2. Abra SQL Editor > New query, cole o arquivo `supabase/schema-completo.sql` inteiro e clique em Run. Ele roda uma vez só, em projeto vazio.
3. Em Project Settings > API Keys, copie a Project URL e a chave "publishable".
4. Troque o endereço e a chave antigos pelos novos em três arquivos:
   - `src/js/config.js`: campos `url` e `chave`.
   - `vercel.json`: o endereço do Supabase aparece duas vezes na linha `Content-Security-Policy` (uma com `https://` e outra com `wss://`).
   - `backup/google-planilhas.gs`: `SUPABASE_URL` e `CHAVE_PUBLICA` (e cole o script de novo na planilha).
5. Envie a mudança para o GitHub. A Vercel publica sozinha.
6. No Supabase, em Authentication > URL Configuration:
   - Site URL: `https://phar-prospector.vercel.app`
   - Redirect URLs: `https://phar-prospector.vercel.app/**`
7. Em Authentication > Sign In / Providers > Email, deixe "Confirm email" ligado.
8. Crie a sua conta em `/entrar?modo=criar` e confirme o e-mail.
9. Torne a conta administradora. No SQL Editor:

```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI');
update public.empresas set status = 'ativa', liberado_em = now()
 where id = (select empresa_id from public.profiles
              where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI'));
```

10. Entre em `/admin` para conferir.
11. Refaça o backup: Backup PHAR > 1. Configurar acesso, com a senha nova.
12. Devolva os dados (parte 13).

### Cenário E — perdi tudo

Faça nesta ordem: C (GitHub), D (Supabase), B (Vercel), depois a parte 10 (planilha de backup) e a parte 17 (base da Receita).

### Como saber que deu certo

- A página principal abre e os botões levam para `/entrar`.
- Criar conta envia o e-mail de confirmação.
- Uma conta nova cai na tela "Aguardando liberação".
- No `/admin`, a empresa nova aparece e o botão Liberar funciona.
- Depois de liberada, a pessoa cadastra um contato e ele aparece no Painel.
- "Fazer backup agora" na planilha termina sem erro.

O arquivo `supabase/schema-completo.sql` foi conferido: recriado do zero em um banco de teste, ele produz as mesmas tabelas, colunas, restrições, índices, funções, regras e permissões do banco real (comparação feita em 9 de outubro de 2026).

## 13. Devolver os dados depois de um desastre

**O que está pronto:** o backup guarda os contatos e o cadastro de cada empresa na planilha.

**O que ainda não existe:** um botão "restaurar backup". Hoje, devolver os contatos ao sistema é um trabalho manual. Esta é a principal lacuna de recuperação (parte 15).

O caminho manual, enquanto isso:

1. Cada responsável cria a conta de novo. Você libera cada empresa no `/admin`.
2. Cada responsável refaz a equipe na aba Equipe e preenche a aba Empresa com os dados que estão na aba "Resumo" da planilha.
3. Para os contatos, peça ao Claude para importar a aba de cada empresa da planilha de backup para a tabela `prospects`. A importação precisa do id novo de cada empresa e de converter a coluna "Histórico" de texto para lista; por isso não é um simples "importar CSV".

Com o backup completo opcional da parte 10 (`pg_dump`), a restauração é direta e inclui os logins. É a opção mais segura para quando houver clientes pagantes.

## 14. Limites do plano gratuito

Conferido na documentação do Supabase em 9 de outubro de 2026. Estes números mudam; confira antes de decidir.

- **Pausa por pouco uso.** O Supabase pode pausar projetos gratuitos com pouca atividade em um período de 7 dias. O backup diário faz um acesso por dia, o que ajuda. Se pausar, basta reativar no painel.
- **E-mails de confirmação.** O serviço de e-mail embutido do Supabase envia só 2 mensagens por hora, pode recusar endereços que não são da equipe do projeto e não é indicado para produção. Antes de vender para vários clientes, configure um envio próprio (SMTP) nas configurações de e-mail da área Authentication.
- **Backups do banco.** No plano gratuito os backups automáticos não podem ser baixados. Por isso existe a planilha.

Para economizar, o sistema não usa tempo real, armazenamento de arquivos nem funções pagas, e o backup roda uma vez por dia. A base da Receita fica fora do Supabase (parte 17).

**Hugging Face (base da Receita).** Conjunto de dados público é gratuito e não pede cartão. O Cloudflare R2, previsto no plano, foi trocado porque pede cartão para ativar mesmo no plano gratuito (decisão do Pedro em 15 out 2026).

Fontes: [Supabase, Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod) e [Supabase, Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 15. Pendências conhecidas

- **Busca de leads.** Busca na base da Receita no ar (só MG, parte 17). Próximos passos pedidos pelo Pedro: busca no Google Maps (raspador no GitHub Actions, com OpenStreetMap de reserva) e seção "Uso e limpeza" no `/admin`. Ainda não feitos do plano: temperatura do lead, status "Não quer contato", IA (`docs/PLANO-PROSPECCAO.md`).
- **Base da Receita: atualização mensal manual.** Rodar `scripts/receita/` todo mês (parte 17). Acrescentar UFs além de MG quando sair do teste.
- **Hospedagem comercial.** O plano gratuito da Vercel é só para uso não comercial; resolver antes de cobrar assinatura.
- **Restaurar backup.** Falta um caminho pronto para devolver os contatos da planilha ao sistema (parte 13).
- **Envio de e-mail próprio (SMTP).** Necessário antes de abrir para vários clientes (parte 14).
- **Conferir a configuração de endereços do login** no Supabase (Site URL e Redirect URLs, cenário D, passo 6).
- **Nome do produto.** Ainda provisório; falta conferir domínio no registro.br e marca no INPI.
- **Lembrete diário.** O sistema mostra os retornos do dia na tela, mas não avisa por e-mail nem WhatsApp.
- **Cobrança.** Ainda não há controle de assinatura; liberar e bloquear empresas é manual.
- **Plano CRM (`docs/PLANO-CRM.md`).** Fases A (Kanban), B (excluir), C (importar com aprovação) e D (exportação travada) feitas. Faltam F (aba Clientes) e E (landing page).
- **Auditoria sem tela.** Exclusões em lote, exportações, liberações e importações ficam em `private.auditoria`, mas por enquanto só dá para ver pelo SQL Editor (consulta na parte 7).
- **Exportação bloqueada para todas as empresas.** Desde a Fase D, nenhuma empresa baixa a planilha até a PHAR liberar no `/admin`. Avisar os clientes que usavam o botão.
- **Importação: marcar a permissão.** `importar` começa desmarcada para todos os colaboradores; o responsável marca na aba Equipe. O formato antigo .xls não é aceito (só .xlsx e CSV).
- **Backup na planilha do Google.** Colar de novo o `backup/google-planilhas.gs` no Apps Script para a planilha ganhar as colunas Responsável e Cliente desde.

## 16. Histórico

| Data | Versão no GitHub | O que entrou |
|---|---|---|
| 9 out 2026 | `f9f9737` | Primeira versão: página principal, entrar, sistema e painel administrativo |
| 9 out 2026 | `9bde02b` | Empresas com vários usuários, simular acesso, gráficos e backup |
| 9 out 2026 | `b3e7b30` | Cadastro completo da empresa (aba Empresa) |
| 9 out 2026 | `9be6f69` | Permissões por colaborador |
| 9 out 2026 | `d1d55b3` | Documentação completa, banco em arquivo único e kit de reconstrução |
| 9 out 2026 | logo depois de `d1d55b3` | Regra fixa: toda mudança atualiza a documentação (`CLAUDE.md`) |
| 14 out 2026 | logo depois de `a704462` | Plano de busca de leads, qualificação e IA (`docs/PLANO-PROSPECCAO.md`) |
| 15 out 2026 | — | Plano atualizado: base da Receita como motor de busca (Fase 2 detalhada), Google Maps adiado |
| 15 out 2026 | — | Repositório transferido para a organização `Dev-for-px` no GitHub |
| 15 out 2026 | `1df3474` | Aba Buscar leads (base da Receita, só MG): migração `busca_receita`, permissão `buscar_leads`, leitor de Parquet no navegador, script mensal em `scripts/receita/`. Enquanto a base não é publicada no Hugging Face, a aba aparece só para o administrador |
| 15 out 2026 | logo depois de `1df3474` | Script da Receita converte os arquivos para UTF-8 (havia bytes inválidos). Vercel reconectada ao repositório da `Dev-for-px` (não publicava desde 9 out) |
| 15 out 2026 | `2f8551a` | Números da primeira carga de MG (2.935.399 empresas, 152,4 MB) |
| 15 out 2026 | logo depois de `2f8551a` | Busca testada com a base de MG (Pompéu + terapia: 11 empresas em 0,8 s lendo 1 MB; BH só com e-mail: 505 mil em 4 s lendo 4,8 MB). Ajustes: WhatsApp reconhece celular no formato antigo (sem o 9), tipo de logradouro repetido no endereço, lista antiga some quando a busca dá erro |
| 15 out 2026 | `9c2b42c` | Base de MG publicada no Hugging Face (`pharconsultoria/phar-receita`); aba Buscar leads liberada para todos com a permissão `buscar_leads`. Ramo casa com o começo das palavras e aceita apelidos comuns (dentista, academia, salão de beleza e mais 46, lista `APELIDOS` em `buscar.js`) |
| 22 out 2026 | `0f55e86` | Plano para virar CRM (`docs/PLANO-CRM.md`), enviado pelo GitHub |
| 22 out 2026 | `5451749` | Fase A do plano CRM: aba Contatos com visão Lista ou Kanban (arrastar e soltar, menu "Mover para…", 50 cartões por coluna), responsável pelo contato (`prospects.responsavel`, filtro "Meus contatos", só o responsável pela conta troca, valendo no banco), `prospects.cliente_desde` gravada pelo banco, colaborador sem `ver_todos` passa a alcançar também os contatos dos quais é responsável. Migração `kanban_responsavel`; backup com as duas colunas novas |
| 22 out 2026 | `25122e7` | Fase B do plano CRM: excluir pelo menu "…" da lista e do cartão do Kanban; excluir em lote na Lista (caixinhas, "Marcar todos os visíveis", barra de seleção); acima de 50 pede para digitar EXCLUIR; aviso de clientes fechados com "Excluir só os que não são clientes"; função `prospects_excluir_lote` grava cada exclusão em lote na auditoria (quem, empresa, quantidade). Migração `excluir_lote` |
| 22 out 2026 | `3712850` | Fase D do plano CRM: exportação de contatos travada por empresa. Colunas `empresas.exportacao_liberada` e `exportacao_ate`; no `/admin`, "Liberar sem prazo", "Liberar por 24 horas" e "Bloquear exportação", com selo mostrando até quando vale; a planilha passa a vir da função `exportar_contatos` (confere liberação e permissão, admin simulando segue a regra da empresa) e cada exportação vai para a auditoria. Backup geral (`admin_exportar`) sem mudança. Migração `exportacao_travada` |
| 22 out 2026 | — | Kit de reconstrução (ZIP) e PDF gerados de novo, com as Fases A, B e D |
| 22 out 2026 | este envio | Fase C do plano CRM: importar planilha (Excel .xlsx ou CSV) com aprovação da PHAR. Permissão `importar`; três passos (arquivo, colunas, prévia com repetidos) e declaração de origem legítima guardada com quem e quando; fila no banco (`private.importacoes` e `private.importacao_linhas`), até 2.000 linhas e 3 envios pendentes; no `/admin`, "Importações pendentes" com prévia, Aprovar e Recusar com motivo; a aprovação grava com origem "Importação", data e planilha nas observações, telefone só com números, e-mail e CNPJ conferidos, pulando repetidos; "Minhas importações" na aba Contatos; limpeza de 30 dias ao abrir o `/admin`. Leitor de Excel: SheetJS 0.20.3 baixada do site oficial e guardada em `vendor/`. Migração `importacao_aprovada` |

## 17. Base da Receita (aba Buscar leads)

A base pública de CNPJ da Receita Federal é processada uma vez por mês em arquivos Parquet e publicada num conjunto de dados público e gratuito do Hugging Face. O navegador lê só o pedaço da cidade buscada; nada da base passa pelo Supabase.

- **Cobertura:** só MG nesta fase. Um arquivo por UF; acrescentar UF = rodar o script de novo com a sigla.
- **Onde fica:** conjunto de dados público `pharconsultoria/phar-receita` no Hugging Face (https://huggingface.co/datasets/pharconsultoria/phar-receita): `receita/atual.json`, `receita/AAAA-MM/uf=MG.parquet`, `municipios.json` e `cnaes.json`. O endereço vai em `src/js/config.js`, campo `receita`. No computador (`localhost`) o site lê a base local; com `?base=hf` no endereço lê a do Hugging Face.
- **Login no Hugging Face:** o token de escrita fica só no computador de quem roda o envio (`hf auth login`). Se o terminal não aceitar colar o token, copie o token e rode `.venv/bin/hf auth login --token "$(pbpaste)" --no-add-to-git-credential` dentro de `scripts/receita/`: ele lê da área de transferência sem mostrar.
- **Origem dos dados:** https://arquivos.receitafederal.gov.br (Dados > Cadastros > CNPJ > AAAA-MM).
- **Como atualizar todo mês e como reconstruir:** passo a passo em `scripts/receita/README.md` (baixar, `processar.py`, `enviar.py`).
- **Como a busca lê pouco:** o arquivo está ordenado por município e CNAE; `municipios.json` guarda a primeira linha e a quantidade de cada cidade. Com ramo só principal, a tela lê primeiro só a coluna de CNAE da cidade e depois só os trechos daquele ramo.
- **Ramo:** cada palavra digitada precisa começar uma palavra do nome do CNAE; aceita código (4 a 7 números) e apelidos comuns que não estão nos nomes oficiais (lista `APELIDOS` em `src/js/buscar.js`, fácil de aumentar).
- **Busca só por CNPJ:** a BrasilAPI diz a cidade do CNPJ (código de município da Receita) e a tela procura nessa cidade.
- **Primeira carga (base de outubro de 2026, MG):** 2.935.399 empresas ativas; `uf=MG.parquet` com 152,4 MB; processamento em 2,5 minutos num Mac (o download dos ~7 GB da Receita leva de 20 a 40 minutos).
