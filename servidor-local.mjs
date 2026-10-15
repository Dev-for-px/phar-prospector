// Servidor simples para testar o site no computador: npm run dev e abra http://localhost:5173
// Imita a Vercel: /app abre app.html e aplica os mesmos cabeçalhos de segurança.
// Para testar a aba Buscar leads com uma base local: RECEITA_DIR=pasta-de-saida npm run dev
// (serve /receita/... dessa pasta, com leitura por faixa de bytes, como o Hugging Face).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const cabecalhos = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
const porta = Number(process.env.PORT || 5173);

createServer(async (req, res) => {
  let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (caminho === '/') caminho = '/index.html';
  if (!extname(caminho)) caminho += '.html';
  const limpo = normalize(caminho).replace(/^(\.\.[/\\])+/, '');
  const receita = process.env.RECEITA_DIR && limpo.startsWith('/receita/');
  const arquivo = receita ? join(process.env.RECEITA_DIR, limpo) : join('dist', limpo);
  try {
    const corpo = await readFile(arquivo);
    const tipo = TIPOS[extname(arquivo)] || 'application/octet-stream';
    const faixa = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (faixa) {
      const ini = Number(faixa[1]), fim = faixa[2] ? Number(faixa[2]) : corpo.length - 1;
      res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${ini}-${fim}/${corpo.length}`, ...cabecalhos });
      res.end(corpo.subarray(ini, fim + 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': tipo, ...cabecalhos });
    res.end(corpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  }
}).listen(porta, () => console.log('Site local em http://localhost:' + porta));
