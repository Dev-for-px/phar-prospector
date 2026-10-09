# PHAR Prospector — regras para o Claude

Leia `docs/DOCUMENTACAO.md` antes de qualquer mudança. Ela descreve o sistema inteiro e o passo a passo de reconstrução.

## Regra fixa: toda mudança atualiza a documentação

Pedido do Pedro (dono do sistema): **qualquer alteração ou melhoria, por menor que seja, atualiza a documentação no mesmo envio (commit)**. Não deixe para depois e não espere ele pedir.

A cada mudança, confira e atualize o que for afetado:

1. `docs/DOCUMENTACAO.md`: as partes que descrevem o que mudou (páginas, arquivos, banco, permissões, segurança, backup, reconstrução, pendências) e uma linha nova na tabela da parte 16 (Histórico). Atualize também a data no topo.
2. `README.md`, se a mudança aparece no resumo.
3. Se mexeu no banco: arquivo novo em `supabase/migrations/`, aplicar no Supabase e rodar `npm run schema` para atualizar `supabase/schema-completo.sql`.
4. O resumo no Projeto "PHAR Consultoria" do Claude (`claude/phar-prospector-sistema.md`), se a sessão tiver acesso a ele.
5. Ao terminar, diga ao Pedro em uma linha o que foi atualizado na documentação.

O PDF e o kit de reconstrução (ZIP) são fotos de uma data. Gere de novo quando o Pedro pedir ou depois de mudança grande (banco, permissões, páginas novas), e avise quando o kit que ele tem ficou desatualizado.

## Outras regras do projeto

- Responder em português, de forma direta e passo a passo.
- Economizar no Supabase (plano gratuito): sem tempo real, sem armazenamento de arquivos, sem funções pagas.
- Nunca pedir nem gravar a senha do banco ou a chave secreta do Supabase. A chave em `src/js/config.js` é a pública.
- O site tem regras de segurança (CSP) que proíbem `style=` e `<script>` solto no HTML: use classes em `src/css/estilo.css`.
- Mudança de banco: preferir o que só acrescenta. Comandos que removem (`drop`, `delete`, `update` sem `where`) pedem confirmação no Supabase; se não passarem, entregar o SQL para o Pedro rodar no SQL Editor.
- Toda regra de acesso vale no banco, não só na tela. Mudou regra, teste com usuários de mentira e desfaça no fim.
- Commits em nome de Pedro Ribeiro; envio direto para a `main` publica na Vercel.
