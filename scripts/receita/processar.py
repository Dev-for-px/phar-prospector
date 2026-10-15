"""Processa a base pública de CNPJ da Receita Federal em Parquet, um arquivo por UF.

Uso (ver README.md desta pasta):
    python processar.py --mes 2026-10 --ufs MG --zips ~/receita-zip --saida ~/receita-saida

Lê os zips do mês (Estabelecimentos0-9, Empresas0-9, Simples, Municipios, Cnaes),
um por vez: descompacta, filtra, apaga o descompactado. Guarda só empresas ATIVAS
das UFs pedidas e só as colunas que a aba "Buscar leads" usa.

Saída (mesma estrutura que vai para o Hugging Face):
    receita/AAAA-MM/uf=MG.parquet   ordenado por município e CNAE, grupos de 10 mil linhas
    receita/AAAA-MM/municipios.json {"MG": [{"cod": "4123", "nome": "BELO HORIZONTE"}, ...]}
    receita/AAAA-MM/cnaes.json      [{"cod": "8650004", "nome": "Atividades de fisioterapia"}, ...]
    receita/atual.json              mês vigente, UFs e contagem por UF (o site lê este primeiro)
"""
import argparse
import json
import os
import shutil
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

import duckdb

# Onde o site lê a base. Usado para juntar UFs já publicadas no atual.json.
URL_PUBLICA = 'https://huggingface.co/datasets/{repo}/resolve/main/receita/{arquivo}'

COL_EST = [
    'cnpj_basico', 'cnpj_ordem', 'cnpj_dv', 'matriz_filial', 'fantasia', 'situacao',
    'data_situacao', 'motivo_situacao', 'cidade_exterior', 'pais', 'abertura',
    'cnae', 'cnaes2', 'tipo_logradouro', 'logradouro', 'numero', 'complemento',
    'bairro', 'cep', 'uf', 'mun', 'ddd1', 'tel1', 'ddd2', 'tel2', 'ddd_fax', 'fax',
    'email', 'situacao_especial', 'data_situacao_especial']
COL_EMP = ['cnpj_basico', 'razao', 'natureza', 'qualificacao', 'capital', 'porte', 'ente']
COL_SIM = ['cnpj_basico', 'simples', 'data_simples', 'data_exc_simples', 'mei', 'data_mei', 'data_exc_mei']


def csv(caminho, colunas):
    """Expressão read_csv para os arquivos da Receita (latin-1, ';', sem cabeçalho, tudo texto)."""
    cols = ', '.join(f"'{c}': 'VARCHAR'" for c in colunas)
    return (f"read_csv('{caminho}', delim=';', quote='\"', escape='\"', header=false, "
            f"encoding='latin-1', columns={{{cols}}}, ignore_errors=true)")


def extrair(zip_path, pasta):
    """Descompacta o único arquivo do zip para a pasta temporária e devolve o caminho."""
    with zipfile.ZipFile(zip_path) as z:
        nome = z.namelist()[0]
        destino = Path(pasta) / 'atual.csv'
        with z.open(nome) as origem, open(destino, 'wb') as saida:
            shutil.copyfileobj(origem, saida, 16 * 1024 * 1024)
    return destino


def ler_tabela_pequena(zip_path):
    """Municipios.zip e Cnaes.zip: pares código;nome."""
    with zipfile.ZipFile(zip_path) as z:
        texto = z.read(z.namelist()[0]).decode('latin-1')
    pares = []
    for linha in texto.splitlines():
        partes = [p.strip().strip('"') for p in linha.split(';', 1)]
        if len(partes) == 2 and partes[0]:
            pares.append((partes[0], partes[1]))
    return pares


def publicado(repo, arquivo):
    """Lê um JSON já publicado no Hugging Face (ou None se ainda não existe)."""
    if not repo:
        return None
    try:
        with urllib.request.urlopen(URL_PUBLICA.format(repo=repo, arquivo=arquivo), timeout=30) as r:
            return json.load(r)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mes', required=True, help='mês da base, ex.: 2026-10')
    ap.add_argument('--ufs', required=True, help='siglas separadas por vírgula, ex.: MG ou MG,SP')
    ap.add_argument('--zips', required=True, help='pasta com os zips baixados')
    ap.add_argument('--saida', required=True, help='pasta de saída (vai para o Hugging Face)')
    ap.add_argument('--repo', default=os.environ.get('HF_REPO', ''),
                    help='repositório no Hugging Face (usuario/nome), para juntar UFs já publicadas')
    ap.add_argument('--apagar-zips', action='store_true', help='apaga cada zip depois de usar')
    a = ap.parse_args()

    ufs = [u.strip().upper() for u in a.ufs.split(',') if u.strip()]
    zips = Path(a.zips).expanduser()
    saida_mes = Path(a.saida).expanduser() / 'receita' / a.mes
    saida_mes.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='receita-')
    inicio = time.time()
    db = duckdb.connect(str(Path(tmp) / 'trabalho.duckdb'))
    db.execute("set preserve_insertion_order=false")
    db.execute("set enable_progress_bar=false")
    lista_ufs = ', '.join(f"'{u}'" for u in ufs)

    # 1) Estabelecimentos: só ativos (situação 02) das UFs pedidas.
    db.execute("""create table est (cnpj_basico varchar, cnpj varchar, fantasia varchar, cnae varchar,
        cnaes2 varchar, uf varchar, mun varchar, bairro varchar, logradouro varchar, numero varchar,
        complemento varchar, cep varchar, tel1 varchar, tel2 varchar, email varchar, abertura date)""")
    for i in range(10):
        z = zips / f'Estabelecimentos{i}.zip'
        print(f'Estabelecimentos{i}...', flush=True)
        arq = extrair(z, tmp)
        db.execute(f"""insert into est select
            cnpj_basico, cnpj_basico || cnpj_ordem || cnpj_dv,
            nullif(trim(fantasia), ''), cnae, nullif(trim(cnaes2), ''), uf, mun,
            nullif(trim(bairro), ''),
            nullif(trim(concat_ws(' ', nullif(trim(tipo_logradouro), ''), nullif(trim(logradouro), ''))), ''),
            nullif(trim(numero), ''), nullif(trim(complemento), ''), nullif(trim(cep), ''),
            nullif(regexp_replace(coalesce(ddd1, '') || coalesce(tel1, ''), '[^0-9]', '', 'g'), ''),
            nullif(regexp_replace(coalesce(ddd2, '') || coalesce(tel2, ''), '[^0-9]', '', 'g'), ''),
            nullif(lower(trim(email)), ''),
            try_strptime(nullif(abertura, '0'), '%Y%m%d')::date
            from {csv(arq, COL_EST)}
            where situacao = '02' and uf in ({lista_ufs})""")
        os.remove(arq)
        if a.apagar_zips:
            os.remove(z)
    db.execute("create table basicos as select distinct cnpj_basico from est")
    print('estabelecimentos ativos:', db.execute('select count(*) from est').fetchone()[0], flush=True)

    # 2) Empresas (razão social e porte), só das raízes que ficaram.
    db.execute("create table emp (cnpj_basico varchar, razao varchar, porte varchar)")
    for i in range(10):
        z = zips / f'Empresas{i}.zip'
        print(f'Empresas{i}...', flush=True)
        arq = extrair(z, tmp)
        db.execute(f"""insert into emp select e.cnpj_basico, nullif(trim(e.razao), ''), e.porte
            from {csv(arq, COL_EMP)} e semi join basicos b on b.cnpj_basico = e.cnpj_basico""")
        os.remove(arq)
        if a.apagar_zips:
            os.remove(z)

    # 3) Simples e MEI.
    print('Simples...', flush=True)
    arq = extrair(zips / 'Simples.zip', tmp)
    db.execute(f"""create table sim as select s.cnpj_basico, s.simples = 'S' as simples, s.mei = 'S' as mei
        from {csv(arq, COL_SIM)} s semi join basicos b on b.cnpj_basico = s.cnpj_basico""")
    os.remove(arq)

    # 4) Tabelas de nomes.
    municipios = dict(ler_tabela_pequena(zips / 'Municipios.zip'))
    cnaes = ler_tabela_pequena(zips / 'Cnaes.zip')

    # 5) Um Parquet por UF. Porte: MEI (pelo Simples), ME (01), EPP (03), DEMAIS (05), vazio se não informado.
    contagem = {}
    for uf in ufs:
        destino = saida_mes / f'uf={uf}.parquet'
        db.execute(f"""copy (
            select e.cnpj, e.fantasia, m.razao, e.cnae, e.cnaes2, e.mun, e.bairro, e.logradouro,
                e.numero, e.complemento, e.cep, e.tel1, e.tel2, e.email, e.abertura,
                case when coalesce(s.mei, false) then 'MEI'
                     when m.porte = '01' then 'ME' when m.porte = '03' then 'EPP'
                     when m.porte = '05' then 'DEMAIS' else null end as porte,
                coalesce(s.simples, false) as simples
            from est e
            left join emp m using (cnpj_basico)
            left join sim s using (cnpj_basico)
            where e.uf = '{uf}'
            order by e.mun, e.cnae, e.cnpj
        ) to '{destino}' (format parquet, compression zstd, compression_level 9, row_group_size 10000)""")
        n = db.execute(f"select count(*) from est where uf = '{uf}'").fetchone()[0]
        contagem[uf] = {'linhas': n, 'bytes': destino.stat().st_size}
        print(f'{uf}: {n} empresas ativas, {destino.stat().st_size / 1e6:.1f} MB', flush=True)

    # 6) Índices pequenos. Municípios só das UFs processadas (a Receita não traz a UF na tabela de nomes).
    # "i" é a primeira linha da cidade no arquivo da UF e "n" quantas linhas ela tem
    # (o arquivo está ordenado por município): o navegador lê só essa faixa.
    mun_por_uf = {}
    for uf, cod, n, i in db.execute(f"""select uf, mun, count(*) as n,
            (sum(count(*)) over (partition by uf order by mun) - count(*))::bigint as i
            from est where uf in ({lista_ufs}) group by uf, mun order by uf, mun""").fetchall():
        mun_por_uf.setdefault(uf, []).append({'cod': cod, 'nome': municipios.get(cod, cod), 'i': i, 'n': n})
    for lista in mun_por_uf.values():
        lista.sort(key=lambda m: m['nome'])

    # Junta com o que já está publicado no mesmo mês (acrescentar UF não refaz as outras).
    anterior = publicado(a.repo, 'atual.json')
    if anterior and anterior.get('mes') == a.mes:
        for uf, info in anterior.get('ufs', {}).items():
            contagem.setdefault(uf, info)
        for uf, lista in (publicado(a.repo, f'{a.mes}/municipios.json') or {}).items():
            mun_por_uf.setdefault(uf, lista)

    (saida_mes / 'municipios.json').write_text(json.dumps(mun_por_uf, ensure_ascii=False, separators=(',', ':')))
    (saida_mes / 'cnaes.json').write_text(json.dumps(
        [{'cod': c, 'nome': n} for c, n in cnaes], ensure_ascii=False, separators=(',', ':')))
    (saida_mes.parent / 'atual.json').write_text(json.dumps(
        {'mes': a.mes, 'gerado_em': time.strftime('%Y-%m-%d'), 'ufs': contagem},
        ensure_ascii=False, indent=1))

    db.close()
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'Pronto em {(time.time() - inicio) / 60:.1f} min. Saída em {saida_mes}', flush=True)


if __name__ == '__main__':
    main()
