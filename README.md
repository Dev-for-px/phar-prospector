# PHAR Prospector

Controle de prospecção com retorno programado: cada contato abordado, o status da conversa e o dia de voltar a falar.

**Documentação completa e passo a passo de reconstrução:** [`docs/DOCUMENTACAO.md`](docs/DOCUMENTACAO.md). O banco inteiro em um arquivo só: [`supabase/schema-completo.sql`](supabase/schema-completo.sql).

## As páginas

| Endereço | Arquivo | Quem acessa |
|---|---|---|
| `/` | `src/index.html` | Todo mundo. Apresenta o sistema, com os botões Entrar e Criar conta. |
| `/entrar` | `src/entrar.html` | Todo mundo. Login, cadastro e recuperação de senha. |
| `/app` | `src/app.html` | Só quem tem login em uma empresa ativa. É o sistema: Painel, Contatos, Equipe e Empresa. |
| `/admin` | `src/admin.html` | Só o administrador. Lista as empresas, libera, bloqueia, simula acesso e baixa o backup. |

## Como está organizado

```
src/                 código do site (HTML, CSS e JavaScript legíveis)
  css/estilo.css     visual, com as cores e fontes da PHAR
  js/config.js       endereço e chave pública do Supabase
  js/comum.js        conexão, sessão e funções usadas em todas as páginas
  js/entrar.js       tela de entrar
  js/app.js          o sistema
  js/admin.js        painel administrativo
  js/graficos.js     gráficos do painel (rosca e linha), sem biblioteca externa
  js/grade.js        desenho da grade de pontos da marca
supabase/migrations/ estrutura do banco em etapas (tabelas, regras e funções)
supabase/schema-completo.sql  o banco inteiro em um arquivo, gerado com "npm run schema"
docs/DOCUMENTACAO.md documentação completa e reconstrução do zero
scripts/             utilitários (gerar o schema completo)
build.mjs            monta a pasta dist/ e minifica o código
vercel.json          configuração da Vercel (build e cabeçalhos de segurança)
servidor-local.mjs   servidor para testar no computador
backup/              script de backup para o Google Planilhas
```

## Onde cada coisa roda

- **GitHub** (este repositório, privado): guarda o código-fonte.
- **Vercel**: a cada `push` na branch `main`, roda `npm run build` e publica a pasta `dist/`.
- **Supabase** (projeto `phar-prospector`, região São Paulo): login e banco de dados.

## Empresas e usuários

- Cada empresa cliente é um "projeto": todos os usuários dela veem e editam a mesma lista de contatos.
- Quem cria a conta sem convite vira responsável (dono) de uma empresa nova, que nasce **pendente** até o administrador liberar.
- O responsável autoriza colaboradores pelo e-mail, na aba Equipe. A pessoa cria a conta com esse e-mail e entra direto na equipe. O sistema não envia e-mail de convite.
- Permissões por colaborador: ao adicionar alguém (ou depois, no botão Permissões), o responsável marca o que a pessoa pode ver (painel, contatos de toda a equipe ou só os próprios, equipe, dados da empresa) e fazer (cadastrar, editar, excluir, baixar planilha). As regras de contatos, equipe e dados da empresa valem no banco; "painel" e "baixar planilha" só escondem a tela e o botão.
- Na aba Empresa, o responsável preenche o cadastro completo (razão social, CNPJ ou CPF, contatos e endereço). A equipe vê; só o responsável altera. O CNPJ e o CPF têm os dígitos conferidos na tela, e o banco confere o formato.
- Um usuário pertence a uma empresa só.

## Segurança

- Cada empresa enxerga só os próprios contatos. Isso é garantido no banco (RLS), não só na tela.
- O administrador do sistema pode **simular** o acesso de uma empresa (ver e editar como ela) e **exportar** todos os contatos para backup. Cada simulação, exportação e mudança de situação fica registrada na tabela `private.auditoria`.
- O painel admin funciona por funções do banco (`admin_*`) que conferem se quem chamou é admin.
- A chave em `js/config.js` é a chave pública (publishable). A chave secreta do Supabase nunca entra neste repositório.
- O site publicado recebe o código minificado. Isso dificulta a leitura, mas não é o que protege o sistema: a proteção são as regras do banco.

## Backup no Google Planilhas

O arquivo `backup/google-planilhas.gs` é um script para colar em uma planilha do Google. Ele grava uma aba por empresa com todos os contatos e pode rodar sozinho todos os dias. As instruções estão no começo do arquivo.

## Rodar no computador

```
npm install
npm run dev
```

Depois abra http://localhost:5173.

## Tornar uma conta administradora

Crie a conta normalmente em `/entrar`. Depois, no SQL Editor do Supabase:

```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI');
update public.empresas set status = 'ativa', liberado_em = now()
 where id = (select empresa_id from public.profiles
              where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI'));
```

## Configuração do login no Supabase

Em **Authentication → URL Configuration**:

- **Site URL**: o endereço do site na Vercel (ex.: `https://phar-prospector.vercel.app`).
- **Redirect URLs**: o mesmo endereço seguido de `/entrar`.

Sem isso, os links de confirmação de e-mail e de recuperação de senha não voltam para o site.

O envio de e-mails padrão do Supabase tem limite baixo por hora. Antes de abrir para muitos clientes, configure um SMTP próprio em **Authentication → Emails**.
