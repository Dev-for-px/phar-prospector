// Monta a pasta dist/ que a Vercel publica.
// Copia src/, traz a biblioteca do Supabase e o leitor de Parquet para dentro do site e minifica JS e CSS.
// O código legível fica só neste repositório (privado); o site público recebe a versão minificada.
import { rm, mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transform, build } from 'esbuild';

const ORIGEM = 'src', SAIDA = 'dist';
const UMD = 'node_modules/@supabase/supabase-js/dist/umd';

await rm(SAIDA, { recursive: true, force: true });
await cp(ORIGEM, SAIDA, { recursive: true });
await mkdir(join(SAIDA, 'vendor'), { recursive: true });
for (const arquivo of await readdir(UMD)) {
  if (arquivo.endsWith('.js')) await cp(join(UMD, arquivo), join(SAIDA, 'vendor', arquivo));
}

async function minificar(pasta, loader) {
  for (const arquivo of await readdir(join(SAIDA, pasta))) {
    const caminho = join(SAIDA, pasta, arquivo);
    const fonte = await readFile(caminho, 'utf8');
    const { code } = await transform(fonte, { loader, minify: true, legalComments: 'none', target: 'es2019' });
    await writeFile(caminho, code);
  }
}
// leitor de Parquet da aba Buscar leads (hyparquet + fzstd), num arquivo só
await build({
  entryPoints: ['scripts/parquet-entrada.js'], bundle: true, format: 'iife', minify: true,
  legalComments: 'none', target: 'es2020', outfile: join(SAIDA, 'vendor', 'parquet.js')
});
await minificar('js', 'js');
await minificar('css', 'css');
console.log('Site montado em dist/');
