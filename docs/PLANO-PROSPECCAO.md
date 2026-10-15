# Plano: busca de leads, qualificação e IA no PHAR Prospector

Criado em 14 de outubro de 2026, atualizado em 15 de outubro de 2026. Status: **aprovado; prioridade atual é a Fase 2 (base da Receita). Nada implementado ainda.**

Origem: reunião de apresentação do sistema, em que pediram busca de empresas por região (Google Maps), dados completos do cliente, base de CNPJ da Receita filtrada por cidade, região e CNAE, qualificação quente, morno e frio, observação com IA e importação de leads.

Este arquivo é a especificação para o Claude Code implementar, uma fase por vez. Antes de começar qualquer fase, leia `CLAUDE.md` e `docs/DOCUMENTACAO.md`.

---

## Como usar este plano no Claude Code

1. Abra o repositório no Claude Code.
2. Peça uma fase de cada vez, por exemplo: "Implemente a Fase 1 do `docs/PLANO-PROSPECCAO.md`, item 1.1".
3. Ao fim de cada item, o Claude Code deve: testar, atualizar `docs/DOCUMENTACAO.md` (regra do `CLAUDE.md`), marcar o item como feito aqui (troque `[ ]` por `[x]`) e enviar para a `main`.

---

## Regras que valem para todas as fases

- **Gratuito primeiro.** Supabase no plano gratuito: sem tempo real, sem armazenamento de arquivos grandes, sem funções pagas.
- **Regra de acesso vale no banco**, não só na tela. Toda tabela nova tem RLS por `empresa_id` e respeita `private.pode(...)`.
- **Chaves secretas nunca no site.** Chave de API do Google ou de IA fica em segredo de Edge Function do Supabase (`supabase secrets set`), nunca em `src/js/config.js` nem no repositório.
- **CSP do site:** sem `style=` e sem `<script>` solto no HTML. Endereço externo novo (API) precisa entrar em `connect-src` no `vercel.json`, ou a chamada passa por Edge Function (preferível).
- **Mudança de banco:** migração nova em `supabase/migrations/`, depois `npm run schema`.
- **Permissões novas** entram na lista de `private.permissoes_padrao()` e nas caixinhas da aba Equipe (constante `PERMS` em `src/js/app.js`).
- **LGPD:** MEI e empresário individual são pessoa física; telefone e e-mail deles são dado pessoal. Prever status "Não quer contato" e não oferecer disparo em massa. Validar com advogado antes de vender.

---

## Fase 1 — qualificação, CNPJ na ficha, importar e clientes (custo zero)

### [ ] 1.1 Temperatura do lead (quente, morno, frio)

**Regra proposta (confirmar com o Pedro antes de implementar):**

| Temperatura | Quando |
|---|---|
| Quente | status `diagnostico` ou `proposta` e último contato há até 14 dias |
| Morno | status `contatado` ou `conversa` e último contato há até 30 dias |
| Frio | mais de 30 dias sem contato, status `depois`, ou nunca contatado (`novo`) |
| — | `cliente` e `perdido` não recebem temperatura |

- Calcular no navegador a partir de `status` e `ultimo_contato` (sem custo de banco).
- Coluna nova `prospects.temperatura_manual text` (`quente`, `morno`, `frio` ou vazio): quando preenchida, vale a escolha manual.
- Ficha: seletor "Temperatura: automática / quente / morno / frio".
- Lista: etiqueta de temperatura ao lado do status; filtro por temperatura.
- Painel: três números (quentes, mornos, frios), clicáveis como os de retorno.

**Pronto quando:** a lista filtra por temperatura, a etiqueta muda sozinha quando o tempo passa, e a escolha manual se sobrepõe à automática.

### [ ] 1.2 Dias sem contato e vencimento

- Na lista e na ficha: "Último contato há X dias" e "Vence em X dias" ou "Venceu há X dias" (a partir de `proximo_contato`).
- Ordenação nova: "Mais tempo sem contato".
- Filtro novo: "Sem contato há mais de 30 dias".

**Pronto quando:** os textos aparecem em todos os contatos com data e a ordenação funciona.

### [ ] 1.3 CNPJ na ficha com preenchimento automático

- Colunas novas em `prospects`: `cnpj text` (só letras e números, mesmo formato de `empresas.documento`), `cnae text`, `razao_social text`, `situacao text`, `abertura date`, `porte_receita text`.
- Na ficha: campo CNPJ com botão "Buscar dados". Consulta gratuita de CNPJ (BrasilAPI ou equivalente; conferir limite de uso e se aceita chamada direta do navegador; se não aceitar, passar por Edge Function).
- Preenche só campos vazios, nunca apaga o que o usuário escreveu. Mostra o que foi preenchido.
- Validar dígitos com `PP.docValido` (já existe em `src/js/comum.js`).

**Pronto quando:** digitar um CNPJ válido e clicar em "Buscar dados" completa razão social, endereço, CNAE e situação.

### [ ] 1.4 Importar leads de planilha

- Botão "Importar planilha" na aba Contatos (exige permissão `criar`).
- Aceita CSV e Excel (.xlsx). Ler no navegador; para Excel, biblioteca servida pelo próprio site (copiar para `dist/vendor/` no `build.mjs`, como já é feito com o Supabase), por causa da CSP.
- Passos na tela: escolher o arquivo, ligar cada coluna da planilha a um campo do sistema, ver prévia das 10 primeiras linhas, confirmar.
- Duplicados: avisar quando já existe contato com o mesmo CNPJ, telefone (só números) ou nome de empresa; opção "pular duplicados".
- Gravar em lotes de 200 linhas; respeitar o limite de 10.000 contatos por empresa.
- Permissão nova `importar` (começa desmarcada para colaboradores).

**Pronto quando:** uma planilha de 500 linhas entra com prévia, mapeamento de colunas e aviso de duplicados.

### [ ] 1.5 Definir cliente (aba Clientes)

- Coluna nova `prospects.cliente_desde date`, preenchida pelo banco quando o status vira `cliente` (gatilho) e limpa se sair de `cliente`.
- Aba ou filtro "Clientes" com a data em que cada um virou cliente.
- Painel: número de clientes fechados no mês.

**Pronto quando:** mudar um contato para Fechado faz ele aparecer em Clientes com a data.

### [ ] 1.6 Status "Não quer contato"

- Novo status `nao_contatar`: sai dos lembretes e não recebe temperatura. Entra no gráfico junto com "Sem interesse".

---

## Fase 2 — motor de busca na base da Receita (PRIORIDADE)

**Decisão do Pedro (15 out 2026):** a base da Receita é o motor principal de leads, dentro do sistema. O Google Maps fica para depois (Fase 3). Volume esperado: buscas pequenas, até uns 10 leads novos por dia por empresa.

### Como vai funcionar (visão do usuário)

1. Aba nova **Buscar**.
2. Escolhe o estado, uma ou mais cidades (várias cidades = região) e o ramo (digita "terapeuta", "dentista", e aparece a lista de CNAEs com esse nome).
3. Filtros opcionais: porte, MEI sim ou não, aberta depois de tal data, só com telefone, só com e-mail.
4. Vê a lista: nome fantasia ou razão social, CNAE, bairro, telefone, e-mail, data de abertura, selo "MEI" quando for MEI.
5. Marca as empresas e clica em **Adicionar à minha lista**. Elas viram contatos com status "A contatar" e origem "Base da Receita". Quem já está na lista aparece marcado como "já na lista" e não é adicionado de novo.

### Arquitetura (escolhida para custo zero)

```
Receita (arquivos do mês, ~8 GB zip)
   │  script mensal (DuckDB), rodado à mão no computador do Pedro ou numa sessão do Claude Code
   ▼
Parquet só com empresas ATIVAS e só as colunas usadas
   1 arquivo por UF, ordenado por município e CNAE, grupos de ~10 mil linhas
   + índices pequenos em JSON (municípios por UF, lista de CNAEs)
   │  upload
   ▼
Cloudflare R2 (bucket público, leitura por faixa de bytes)
   │  o navegador lê só os pedaços do município buscado
   ▼
Aba Buscar no site  ──"Adicionar à lista"──▶  Supabase (tabela prospects, como hoje)
```

- **Nada da base vai para o Supabase.** Só os contatos que a pessoa escolher adicionar (economia do plano gratuito).
- **Sem servidor e sem função paga.** A busca roda no navegador, lendo o Parquet direto do R2.
- **Conferir antes de começar:** limites do plano gratuito do Cloudflare R2 (armazenamento e se a saída de dados é gratuita) e se o tamanho final cabe. Se não couber, alternativa: Hugging Face Datasets.

### [ ] 2.1 Script de processamento mensal (`scripts/receita/`)

- Python + DuckDB. README curto em `scripts/receita/README.md` com o passo a passo para rodar todo mês.
- Baixa os arquivos do mês do site oficial (conferir o endereço atual a partir de https://www.gov.br/receitafederal/dados). Processa **um zip por vez e apaga depois**, para caber em disco comum.
- Arquivos usados: Estabelecimentos, Empresas (razão social, porte, capital), Simples (MEI e Simples), Municipios e Cnaes (tabelas de nomes). Atenção: o código de município da Receita **não é** o do IBGE; usar a tabela Municipios da própria Receita.
- Filtra só situação cadastral **ativa**.
- Colunas finais (nomes curtos):
  `cnpj` (14 posições), `fantasia`, `razao`, `cnae` (principal), `cnaes2` (secundários, texto), `uf`, `mun` (código), `bairro`, `logradouro`, `numero`, `complemento`, `cep`, `tel1`, `tel2` (DDD junto, só números), `email`, `abertura` (data), `porte`, `mei` (s/n), `simples` (s/n).
- Saída:
  - `receita/AAAA-MM/uf=MG.parquet` (um por UF), ordenado por `mun`, `cnae`; compressão zstd; grupos de ~10 mil linhas.
  - `receita/AAAA-MM/municipios.json` (`{uf: [{cod, nome}]}`) e `receita/AAAA-MM/cnaes.json` (`[{cod, nome}]`).
  - `receita/atual.json` com o mês vigente e a contagem por UF (o site lê este primeiro).
- Upload para o R2 (instrução no README; a chave de acesso do R2 fica só no computador de quem roda, nunca no repositório).
- **Primeiro teste:** rodar só para MG e mostrar ao Pedro quantas empresas ativas tem em Pompéu e quantas com CNAE de terapia (8650-0/04 fisioterapia, 8650-0/03 psicologia, 8690-9/01 e afins; conferir códigos na tabela).

**Pronto quando:** existe `uf=MG.parquet` no R2, com tamanho e tempo de processamento anotados no README.

### [ ] 2.2 Leitura no navegador

- Biblioteca para ler Parquet por faixa de bytes no navegador. Avaliar **hyparquet** (JavaScript puro, pequena) antes de DuckDB-WASM (pesado e exige `wasm-unsafe-eval` na CSP). Servir a biblioteca pelo próprio site (`dist/vendor/`, via `build.mjs`), como já é feito com o Supabase.
- Ler só os grupos de linhas cujo mínimo e máximo de `mun` contêm o município buscado; depois filtrar CNAE e demais filtros na memória.
- CSP em `vercel.json`: adicionar o endereço público do R2 em `connect-src`.
- Configurar CORS do bucket para o domínio do site (método GET, cabeçalho Range).

**Pronto quando:** buscar Pompéu/MG traz o resultado em poucos segundos, baixando só uma parte pequena do arquivo de MG (anotar quantos KB).

### [ ] 2.3 Aba Buscar

- Botão de aba novo em `src/app.html` (`#aba-buscar`, `data-visao="buscar"`), entrando em `VISOES` em `src/js/app.js`. Código da busca em arquivo novo `src/js/buscar.js`.
- Filtros: UF (lista), cidades (busca por nome, várias), ramo (busca por nome no `cnaes.json`, aceita CNAE principal ou também secundário), porte, MEI, abertura depois de, só com telefone, só com e-mail.
- Resultado em lista no mesmo visual da aba Contatos, 50 por página, com contagem total e caixinha para marcar cada um e "marcar todos da página".
- Mostrar o mês da base ("Base da Receita de setembro de 2026").
- Telefone formatado e link de WhatsApp quando for celular.

### [ ] 2.4 Adicionar à lista

- Depende das colunas do item 1.3 em `prospects` (`cnpj`, `cnae`, `razao_social`, `situacao`, `abertura`, `porte_receita`). Se 1.3 ainda não foi feito, criar essas colunas aqui (migração nova).
- Índice único parcial `(empresa_id, cnpj) where cnpj <> ''` para impedir duplicado na mesma empresa.
- Antes de mostrar o resultado, consultar quais CNPJs da página já estão na lista da empresa (uma consulta só, `in (...)`), e marcar "já na lista".
- Inserir em lote os marcados: `empresa` = fantasia ou razão social, `telefone` = tel1, `email`, endereço, `cidade` = nome do município, `uf`, `segmento` = nome do CNAE, `origem` = "Base da Receita", `status` = "novo", `porte` vindo do porte da Receita.
- Respeitar o limite de 10.000 contatos por empresa (o banco já barra).

### [ ] 2.5 Permissão e limites

- Permissão nova `buscar_leads` em `private.permissoes_padrao()` (começa **marcada** para colaborador) e na lista `PERMS` da aba Equipe.
- A aba Buscar só aparece para quem tem a permissão; o botão "Adicionar à lista" exige também `criar` (regra já vale no banco).
- Sem limite técnico de busca (não tem custo por busca). Limite opcional de adição por dia fica para depois, se precisar.

### [ ] 2.6 Cuidados de LGPD na tela

- Selo "MEI" visível: MEI é pessoa física, telefone e e-mail são dado pessoal.
- Status "Não quer contato" (item 1.6) disponível.
- Aviso curto na aba: "Dados públicos da Receita Federal. Use para contato comercial individual; não para envio em massa."

### [ ] 2.7 Documentação

- `docs/DOCUMENTACAO.md`: nova parte sobre a base da Receita (onde fica no R2, como atualizar todo mês, como reconstruir) e as pendências.
- Atualização mensal vira tarefa recorrente do Pedro (ou do Claude Code a pedido).

---

## Fase 3 — Google Maps como complemento (ADIADA)

**Decisão do Pedro (15 out 2026):** fica para depois. Com até 10 leads por dia, a franquia gratuita da API oficial (1.000 consultas por mês na faixa com telefone) sobra, então quando entrar vai ser **pela API oficial**, não por raspador.

Quando for retomar:
- Edge Function `maps-buscar` com a chave em segredo, limite por empresa por mês.
- Uso principal: na ficha de um contato vindo da Receita, botão "Conferir no Google" que mostra telefone, site e nota atuais, com a marca "Google Maps".
- Regras do Google: só o `place_id` pode ficar gravado; dados do Maps são mostrados, não guardados. Fontes: https://developers.google.com/maps/billing-and-pricing/pricing e https://developers.google.com/maps/documentation/places/web-service/policies
- Precisa de conta no Google Cloud com cartão (o Pedro cria).
- **Raspadores** (gosom/google-maps-scraper, Google Maps Scraper Kit): não usar dentro do sistema. O próprio projeto avisa que é contra os termos do Google, exige servidor com Docker e sofre bloqueio. Se o Pedro quiser, pode usar no computador dele como ferramenta interna e importar o CSV (item 1.4).

---

## Fase 4 — observação com IA

### Decisão de fornecedor

- **Não usar o plano gratuito do Gemini com dados de cliente:** os termos pedem para não enviar dados pessoais e permitem que o Google use e leia o conteúdo. Fonte: https://ai.google.dev/gemini-api/terms
- Candidato: Cloudflare Workers AI (plano gratuito). **Antes de implementar, conferir** o limite diário gratuito e a política de uso dos dados enviados.
- A chave fica em segredo de Edge Function do Supabase (ou em um Worker do Cloudflare).

### [ ] 4.1 Edge Function `ia-observacao`

- Recebe o id do contato; a função lê o contato com o login de quem chamou (respeita RLS).
- Envia só o necessário: ramo, cidade, status, histórico de conversas e observações. Sem CPF, sem e-mail pessoal.
- Devolve: resumo da conversa, próximo passo sugerido, mensagem de WhatsApp sugerida e temperatura sugerida.
- Limite por empresa por dia (tabela `private.uso_ia`). Permissão nova `usar_ia`.

### [ ] 4.2 Tela

- Botão "Analisar com IA" na ficha do contato. Mostra o resultado com botões "Copiar mensagem" e "Salvar resumo nas observações".
- Nunca grava nada sem o usuário clicar.

---

## Antes de vender

- [ ] **Hospedagem comercial.** O plano Hobby da Vercel é só para uso pessoal e não comercial. Passar para o Pro (US$ 20 por mês) ou mudar para outra hospedagem gratuita que permita uso comercial (pesquisar Cloudflare Pages). Fonte: https://vercel.com/docs/accounts/plans/hobby
- [ ] **E-mail próprio (SMTP)** no Supabase: o embutido envia só 2 e-mails por hora.
- [ ] Revisão de LGPD com advogado.

---

## Decisões pendentes do Pedro

1. Confirmar ou ajustar a regra de quente, morno e frio (item 1.1).
2. ~~Onde guardar a base da Receita~~: decidido Cloudflare R2, conferir limites no item 2.1.
3. Criar a conta do Google Cloud com cartão (Fase 3, adiada).
5. Criar o bucket no Cloudflare R2 e a chave de acesso (item 2.1). A chave fica só no computador de quem roda o script.
4. Vercel Pro ou outra hospedagem, antes de cobrar assinatura.
