# PHAR Prospector — documentação completa

Atualizada em 15 de outubro de 2026.

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
| Base da Receita (Parquet) | Hugging Face, conjunto de dados público | `HF_REPO` (a criar pelo Pedro; ver parte 17). Endereço lido pelo site em `src/js/config.js`, campo `receita` |

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
- **Contatos**: lista com busca, filtro por status, ordenação e os quatro números do topo (atrasados, hoje, próximos 7 dias, sem retorno). Cada contato tem ficha, histórico e o botão "Registrar contato". Contatos vindos da Receita mostram CNPJ, razão social e endereço na ficha.
- **Buscar leads**: busca empresas na base da Receita por estado, cidades (várias), ramo (CNAE principal ou também secundário), nome, CNPJ, bairro, porte (MEI, ME, EPP, demais), data de abertura, só com telefone e só com e-mail. Resultado em páginas de 50, com contagem total, selo MEI e "Já na lista". O vendedor marca as empresas e clica em "Adicionar à minha lista": elas viram contatos "A contatar", origem "Base da Receita", sem duplicar CNPJ. Só aparece para quem tem a permissão `buscar_leads` (e, enquanto a base não estiver publicada, só para o administrador). Detalhes na parte 17.
- **Equipe**: quem usa a conta. O responsável adiciona colaboradores pelo e-mail e marca as permissões nas caixinhas.
- **Empresa**: cadastro completo da empresa. Só o responsável altera.

**Painel administrativo (`/admin`)**: só para a conta administradora. Mostra números gerais, gráficos de todas as empresas e a lista de empresas com os botões Liberar, Recusar, Bloquear, Reativar e Simular, além de "Baixar backup (CSV)".

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
│   └── PLANO-PROSPECCAO.md   plano das próximas funções (busca de leads, qualificação, IA)
├── scripts/
│   ├── gerar-schema.mjs      junta as migrações em supabase/schema-completo.sql
│   ├── parquet-entrada.js    entrada do pacote vendor/parquet.js (leitor de Parquet do navegador)
│   └── receita/              base da Receita: processar.py, enviar.py, requirements.txt e README.md (parte 17)
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
        ├── admin.js          painel administrativo
        ├── graficos.js       gráficos de rosca e de linha, sem biblioteca externa
        └── grade.js          desenho da grade de pontos da marca
```

Dependências: `@supabase/supabase-js` 2.45.4, que conversa com o banco; `hyparquet` 1.31.2 e `fzstd` 0.1.1, que leem e descompactam a base da Receita no navegador (JavaScript puro, sem WebAssembly); e `esbuild` 0.23.1, que minifica o código no build. Não há framework.

O que o `build.mjs` faz: copia `src/` para `dist/`, copia a biblioteca do Supabase para `dist/vendor/`, monta `dist/vendor/parquet.js` (hyparquet + fzstd, ~62 KB) e minifica os arquivos de `js/` e `css/`. O site publicado recebe o código minificado; o código legível fica só no repositório privado.

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

**`private.auditoria`** — registro das ações do administrador: `admin_id`, `acao` (`status`, `simular_inicio`, `simular_fim`, `exportar`), `empresa_id`, `detalhe`, `criado_em`.

### Limites definidos no banco

- 10.000 contatos por empresa.
- 20 pessoas por equipe, contando os e-mails autorizados que ainda não se cadastraram.
- 200 registros de conversa por contato.

### Funções que o site chama

Todas exigem login. Cada uma confere, dentro do banco, se quem chamou tem permissão.

| Função | Quem pode | O que faz |
|---|---|---|
| `minha_sessao()` | qualquer pessoa logada | Devolve quem é a pessoa, a empresa, as permissões e se está em modo simular. Também faz o colaborador autorizado entrar na equipe no primeiro acesso |
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
| `admin_exportar()` | administrador | Todos os dados de todas as empresas, para o backup |
| `prospects_cnpjs_existentes(p_cnpjs)` | quem tem `buscar_leads` | Diz quais destes CNPJs já estão na lista da empresa (só os CNPJs, nenhum outro dado), para marcar "Já na lista". Até 1.000 por vez |
| `prospects_adicionar_lote(p_linhas)` | quem tem `buscar_leads` e `criar` | Adiciona até 200 empresas de uma vez como contatos "A contatar". Roda com o login de quem chamou, então valem as regras da tabela e o limite de 10 mil. CNPJ repetido é pulado e contado |

Os contatos não passam por função (exceto a adição em lote da aba Buscar leads): o site lê e grava direto na tabela `prospects`, e as regras da tabela decidem o que cada pessoa alcança. O cadastro da empresa é lido direto da tabela `empresas`.

Funções de apoio (grupo `private`): `minha_empresa()`, `conta_ativa()`, `sou_dono()`, `em_simulacao()`, `is_admin()`, `pode(chave)`, `permissoes_padrao()`, `permissoes_limpas()`, `empresa_completa()`, `nome_empresa_padrao()`. `equipe_convidar(p_email)` continua existindo, mas só é chamada por dentro de `equipe_autorizar`.

Ações automáticas (gatilhos):

- Ao criar um login, o banco cria a linha em `profiles`. Se o e-mail não estava autorizado por ninguém, cria também uma empresa nova, pendente, com a pessoa como responsável.
- Ao cadastrar um contato, o banco grava quem cadastrou e confere o limite da empresa.
- Ao editar um contato, o banco não deixa trocar a empresa, o autor nem a data de criação.

### Regras de acesso das tabelas

| Tabela | Ler | Criar | Editar | Excluir |
|---|---|---|---|---|
| `prospects` | da própria empresa, com a empresa ativa; sem "ver todos", só os que a pessoa cadastrou | com a permissão "cadastrar" | com a permissão "editar", nos contatos que a pessoa enxerga | com a permissão "excluir", nos contatos que a pessoa enxerga |
| `empresas` | só a própria, com a permissão "ver dados da empresa" | não | só pela função `empresa_salvar` | não |
| `profiles` | só a própria linha | não | não | não |
| `convites`, `auditoria` | fora do alcance do site | | | |

Quem não está logado não lê nem grava nada.

## 8. Quem pode o quê

Há três papéis.

**Administrador do sistema** (você). Entra em `/admin`. Libera e bloqueia empresas, simula o acesso de qualquer uma (vê e edita como ela) e baixa o backup. Cada simulação, exportação e mudança de situação fica registrada na auditoria.

**Responsável pela conta** (quem criou a conta da empresa). Pode tudo dentro da empresa: contatos, equipe, permissões e cadastro da empresa.

**Colaborador**. Pode o que o responsável marcou:

| Permissão | Chave no banco | Começa | Vale onde |
|---|---|---|---|
| Ver o painel com os gráficos | `ver_painel` | marcada | só na tela |
| Ver os contatos de toda a equipe | `ver_todos` | marcada | no banco. Desmarcada, a pessoa vê só os contatos que ela mesma cadastrou |
| Ver quem faz parte da equipe | `ver_equipe` | marcada | no banco |
| Ver os dados da empresa | `ver_empresa` | marcada | no banco |
| Cadastrar contatos | `criar` | marcada | no banco |
| Editar contatos e registrar conversas | `editar` | marcada | no banco |
| Excluir contatos | `excluir` | desmarcada | no banco |
| Baixar a planilha de contatos (CSV) | `exportar` | desmarcada | só na tela |
| Buscar leads na base da Receita | `buscar_leads` | marcada | no banco (as duas funções da busca conferem). Para adicionar à lista precisa também de `criar` |

"Só na tela" quer dizer que o sistema esconde a aba ou o botão, mas não é uma trava de dados. Quem enxerga os contatos na tela ainda consegue copiá-los à mão. A trava de verdade é "ver os contatos de toda a equipe".

Como funciona o convite: o responsável informa o e-mail na aba Equipe e marca as caixinhas. O sistema não envia e-mail. A pessoa cria a conta em `/entrar?modo=criar` com aquele e-mail, confirma, e no primeiro acesso entra direto na equipe com as permissões marcadas. As permissões podem ser mudadas depois, no botão Permissões.

Ciclo de uma empresa: nasce **pendente** quando alguém cria conta, fica **ativa** quando o administrador libera e pode ser **bloqueada**. Enquanto não está ativa, ninguém dela lê nem grava contatos.

## 9. Segurança

- **Separação entre empresas no banco.** Cada tabela tem regras (RLS) que o banco aplica em todo pedido. Mesmo que alguém altere o site no próprio navegador, não alcança dados de outra empresa.
- **Permissões conferidas no banco.** Ver todos os contatos, cadastrar, editar, excluir, ver equipe e ver dados da empresa são decididos pelo banco, não pela tela.
- **Sem chave secreta no site.** O navegador usa só a chave pública.
- **Cabeçalhos de segurança** em `vercel.json`: o site só carrega scripts dele mesmo, só se conecta ao próprio Supabase, ao Hugging Face (`huggingface.co` e `*.hf.co`, base da Receita) e à BrasilAPI (consulta de um CNPJ na aba Buscar leads), e não pode ser aberto dentro de outra página. Por causa disso, não se usa `style=` nem `<script>` solto dentro do HTML.
- **Código minificado.** Dificulta a leitura, mas não é o que protege o sistema. Código que roda no navegador sempre pode ser lido. O que impede a cópia do negócio são o repositório privado e as regras no banco.
- **Páginas com login não são indexadas** pelo Google (`noindex`) e não ficam guardadas em cache.

Avisos que o Supabase mostra e que são esperados:

- "Signed-In Users Can Execute SECURITY DEFINER Function": as funções do site rodam com poder elevado de propósito, e cada uma confere a permissão por dentro.
- "Leaked Password Protection Disabled": a checagem de senhas vazadas está desligada. Vale ligar em Authentication > Sign In / Providers > Email quando o plano permitir.

Como as regras foram testadas: em cada mudança de banco, um teste cria usuários de mentira, tenta cada ação permitida e proibida e desfaz tudo no fim. Na versão atual foram 22 verificações de permissão no banco real e 28 no banco de teste, todas aprovadas. Na migração da busca na Receita (15 out 2026), mais 11 verificações no banco real: CNPJ repetido pulado, CNPJ inválido barrado, empresa não enxerga CNPJ de outra, sem `buscar_leads` barrado, sem `criar` barrado; tudo desfeito no fim. A regra de excluir contatos foi testada só no banco de teste, porque a ferramenta usada bloqueia comandos de exclusão no banco real.

## 10. Backup

### O que existe

**Planilha do Google (automático).** O script em `backup/google-planilhas.gs` entra no sistema com a conta administradora, chama `admin_exportar` e reescreve a planilha: uma aba por empresa com todos os contatos e a aba "Resumo" com data, totais e dados do cadastro de cada empresa. Com o agendamento ligado, roda todo dia entre 3h e 4h.

**CSV pelo painel administrativo (manual).** O botão "Baixar backup (CSV)" gera um arquivo com todos os contatos de todas as empresas.

**CSV pela empresa (manual).** Na aba Contatos, "Baixar planilha (CSV)" gera os contatos da própria empresa.

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

- **Busca de leads.** Busca na base da Receita no ar (só MG, parte 17). Próximos passos pedidos pelo Pedro: busca no Google Maps (raspador no GitHub Actions, com OpenStreetMap de reserva) e seção "Uso e limpeza" no `/admin`. Ainda não feitos do plano: temperatura do lead, importar planilha, status "Não quer contato", IA (`docs/PLANO-PROSPECCAO.md`).
- **Base da Receita: atualização mensal manual.** Rodar `scripts/receita/` todo mês (parte 17). Acrescentar UFs além de MG quando sair do teste.
- **Hospedagem comercial.** O plano gratuito da Vercel é só para uso não comercial; resolver antes de cobrar assinatura.
- **Restaurar backup.** Falta um caminho pronto para devolver os contatos da planilha ao sistema (parte 13).
- **Envio de e-mail próprio (SMTP).** Necessário antes de abrir para vários clientes (parte 14).
- **Conferir a configuração de endereços do login** no Supabase (Site URL e Redirect URLs, cenário D, passo 6).
- **Nome do produto.** Ainda provisório; falta conferir domínio no registro.br e marca no INPI.
- **Lembrete diário.** O sistema mostra os retornos do dia na tela, mas não avisa por e-mail nem WhatsApp.
- **Cobrança.** Ainda não há controle de assinatura; liberar e bloquear empresas é manual.

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

## 17. Base da Receita (aba Buscar leads)

A base pública de CNPJ da Receita Federal é processada uma vez por mês em arquivos Parquet e publicada num conjunto de dados público e gratuito do Hugging Face. O navegador lê só o pedaço da cidade buscada; nada da base passa pelo Supabase.

- **Cobertura:** só MG nesta fase. Um arquivo por UF; acrescentar UF = rodar o script de novo com a sigla.
- **Onde fica:** `receita/atual.json`, `receita/AAAA-MM/uf=MG.parquet`, `municipios.json` e `cnaes.json` no conjunto de dados do Hugging Face. O endereço vai em `src/js/config.js`, campo `receita`.
- **Origem dos dados:** https://arquivos.receitafederal.gov.br (Dados > Cadastros > CNPJ > AAAA-MM).
- **Como atualizar todo mês e como reconstruir:** passo a passo em `scripts/receita/README.md` (baixar, `processar.py`, `enviar.py`).
- **Como a busca lê pouco:** o arquivo está ordenado por município e CNAE; `municipios.json` guarda a primeira linha e a quantidade de cada cidade. Com ramo só principal, a tela lê primeiro só a coluna de CNAE da cidade e depois só os trechos daquele ramo.
- **Busca só por CNPJ:** a BrasilAPI diz a cidade do CNPJ (código de município da Receita) e a tela procura nessa cidade.
- **Primeira carga (base de outubro de 2026, MG):** 2.935.399 empresas ativas; `uf=MG.parquet` com 152,4 MB; processamento em 2,5 minutos num Mac (o download dos ~7 GB da Receita leva de 20 a 40 minutos).

