# PHAR Prospector

Controle de prospecção com retorno programado: cada contato abordado, o status da conversa e o dia de voltar a falar.

## As páginas

| Endereço | Arquivo | Quem acessa |
|---|---|---|
| `/` | `src/index.html` | Todo mundo. Apresenta o sistema, com os botões Entrar e Criar conta. |
| `/entrar` | `src/entrar.html` | Todo mundo. Login, cadastro e recuperação de senha. |
| `/app` | `src/app.html` | Só quem tem login e conta ativa. É o sistema. |
| `/admin` | `src/admin.html` | Só o administrador. Lista as contas, libera e bloqueia. |

## Como está organizado

```
src/                 código do site (HTML, CSS e JavaScript legíveis)
  css/estilo.css     visual, com as cores e fontes da PHAR
  js/config.js       endereço e chave pública do Supabase
  js/comum.js        conexão, sessão e funções usadas em todas as páginas
  js/entrar.js       tela de entrar
  js/app.js          o sistema
  js/admin.js        painel administrativo
  js/grade.js        desenho da grade de pontos da marca
supabase/migrations/ estrutura do banco (tabelas, regras e funções)
build.mjs            monta a pasta dist/ e minifica o código
vercel.json          configuração da Vercel (build e cabeçalhos de segurança)
servidor-local.mjs   servidor para testar no computador
```

## Onde cada coisa roda

- **GitHub** (este repositório, privado): guarda o código-fonte.
- **Vercel**: a cada `push` na branch `main`, roda `npm run build` e publica a pasta `dist/`.
- **Supabase** (projeto `phar-prospector`, região São Paulo): login e banco de dados.

## Segurança

- Cada conta enxerga só os próprios contatos. Isso é garantido no banco (RLS), não só na tela.
- Conta nova nasce **pendente**. Só grava e lê contatos depois que o administrador libera.
- O painel admin lê as contas por funções do banco que conferem se quem chamou é admin. Ele mostra a quantidade de contatos de cada conta, não o conteúdo.
- A chave em `js/config.js` é a chave pública (publishable). A chave secreta do Supabase nunca entra neste repositório.
- O site publicado recebe o código minificado. Isso dificulta a leitura, mas não é o que protege o sistema: a proteção são as regras do banco.

## Rodar no computador

```
npm install
npm run dev
```

Depois abra http://localhost:5173.

## Tornar uma conta administradora

Crie a conta normalmente em `/entrar`. Depois, no SQL Editor do Supabase:

```sql
update public.profiles
   set is_admin = true, status = 'ativa', liberado_em = now()
 where id = (select id from auth.users where email = 'SEU-EMAIL-AQUI');
```

## Configuração do login no Supabase

Em **Authentication → URL Configuration**:

- **Site URL**: o endereço do site na Vercel (ex.: `https://phar-prospector.vercel.app`).
- **Redirect URLs**: o mesmo endereço seguido de `/entrar`.

Sem isso, os links de confirmação de e-mail e de recuperação de senha não voltam para o site.

O envio de e-mails padrão do Supabase tem limite baixo por hora. Antes de abrir para muitos clientes, configure um SMTP próprio em **Authentication → Emails**.
