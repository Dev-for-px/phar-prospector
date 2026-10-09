// Junta as migrações de supabase/migrations em um arquivo só: supabase/schema-completo.sql.
// Esse arquivo recria o banco inteiro em um projeto novo do Supabase (colar no SQL Editor e rodar uma vez).
// Uso: npm run schema
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pasta = join(raiz, 'supabase', 'migrations');
const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();

let saida = `-- PHAR Prospector — banco completo em um arquivo só.
-- GERADO por scripts/gerar-schema.mjs a partir de supabase/migrations. Não edite à mão: mude as migrações e gere de novo.
--
-- Para recriar o banco em um projeto NOVO do Supabase:
--   1. Supabase > SQL Editor > New query
--   2. Cole este arquivo inteiro e clique em Run (roda uma vez só, em projeto vazio)
--   3. Siga docs/DOCUMENTACAO.md, parte "Reconstruir do zero", para criar a conta de administrador
--
-- Migrações incluídas, na ordem: ${arquivos.join(', ')}

begin;
`;
for (const f of arquivos) {
  saida += `\n-- =====================================================================\n-- ${f}\n-- =====================================================================\n`;
  saida += readFileSync(join(pasta, f), 'utf8').trim() + '\n';
}
saida += '\ncommit;\n';
writeFileSync(join(raiz, 'supabase', 'schema-completo.sql'), saida);
console.log('supabase/schema-completo.sql gerado com ' + arquivos.length + ' migrações');
