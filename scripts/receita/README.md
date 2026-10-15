# Base da Receita: atualização mensal

A aba **Buscar leads** lê a base pública de CNPJ da Receita Federal direto do navegador. A base não fica no Supabase: fica em arquivos Parquet num conjunto de dados público e gratuito do Hugging Face (sem cartão), um arquivo por UF. O navegador baixa só o pedaço da cidade buscada.

Hoje a base cobre **só MG** (fase de teste). Acrescentar uma UF é rodar o mesmo script com a sigla.

## O que precisa (uma vez)

1. Python 3.9 ou mais novo.
2. Conta gratuita no Hugging Face (https://huggingface.co/join) e um token de **escrita** (Settings > Access Tokens > Create new token > Write).
3. No terminal, dentro desta pasta:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/hf auth login
```

O `hf auth login` pede o token e guarda só neste computador. Nunca coloque o token no repositório nem em conversa.

## Todo mês

A Receita publica os arquivos do mês em https://arquivos.receitafederal.gov.br (pasta Dados > Cadastros > CNPJ > AAAA-MM). São ~7 GB de zips; precisa de ~20 GB livres durante o processamento.

### 1. Baixar os zips do mês

Troque `2026-10` pelo mês novo:

```bash
MES=2026-10
mkdir -p ~/receita-zip && cd ~/receita-zip
B="https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/$MES"
for f in Cnaes Municipios Simples Estabelecimentos{0..9} Empresas{0..9}; do
  curl -C - --retry 5 -u 'gn672Ad4CF8N6TK:' -o $f.zip "$B/$f.zip"
done
```

O `gn672Ad4CF8N6TK` não é senha: é o código público do compartilhamento da Receita. Se o download parar, rode de novo (o `-C -` continua de onde parou).

### 2. Processar

```bash
.venv/bin/python processar.py --mes 2026-10 --ufs MG --zips ~/receita-zip --saida ~/receita-saida --repo SEU_USUARIO/phar-receita
```

- `--ufs MG,SP,RJ` processa várias UFs de uma vez (o tempo é quase o mesmo, o que pesa é ler os zips).
- No mês novo, passe **todas** as UFs que já estão no ar (estão em `atual.json`).
- Para **acrescentar** uma UF no mesmo mês, rode só com a UF nova: o script junta com as que já estão publicadas.

### 3. Enviar

```bash
.venv/bin/python enviar.py --saida ~/receita-saida --repo SEU_USUARIO/phar-receita
```

Mantém os dois meses mais recentes e apaga os antigos. O site passa a usar o mês novo sozinho (lê `receita/atual.json`).

### 4. Testar no computador (opcional, antes de enviar)

Na raiz do repositório:

```bash
RECEITA_DIR=~/receita-saida npm run dev
```

Abra http://localhost:5173/app#buscar. No computador, o site lê a base da pasta de saída, não do Hugging Face.

## O que o script faz

- Processa **um zip por vez** e apaga o descompactado logo depois.
- Guarda só estabelecimentos com situação **ativa** (código 02) das UFs pedidas.
- Junta razão social e porte (Empresas) e opção pelo Simples e MEI (Simples).
- O código de município é o **da Receita** (não é o do IBGE); os nomes vêm da tabela Municipios da própria Receita.

Arquivos gerados:

| Arquivo | Conteúdo |
|---|---|
| `receita/atual.json` | mês vigente, UFs e, por UF, número de empresas e tamanho do arquivo |
| `receita/AAAA-MM/uf=MG.parquet` | empresas ativas da UF, ordenadas por município e CNAE, zstd, grupos de 10 mil linhas |
| `receita/AAAA-MM/municipios.json` | por UF: código, nome, primeira linha (`i`) e quantidade (`n`) de cada cidade no Parquet |
| `receita/AAAA-MM/cnaes.json` | código e nome de todos os CNAEs |

Colunas do Parquet: `cnpj`, `fantasia`, `razao`, `cnae` (principal), `cnaes2` (secundários, separados por vírgula), `mun`, `bairro`, `logradouro`, `numero`, `complemento`, `cep`, `tel1`, `tel2` (DDD junto, só números), `email`, `abertura` (data), `porte` (MEI, ME, EPP, DEMAIS ou vazio), `simples` (verdadeiro ou falso).

## Números da primeira carga (outubro de 2026, MG)

Preenchido depois da primeira execução: ver `docs/DOCUMENTACAO.md`, parte "Base da Receita".
