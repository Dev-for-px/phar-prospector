"""Envia a saída do processar.py para o conjunto de dados público no Hugging Face.

Uso:
    hf auth login                      # uma vez; cole o token de escrita (fica só neste computador)
    python enviar.py --saida ~/receita-saida --repo SEU_USUARIO/phar-receita

Envia receita/AAAA-MM/* e receita/atual.json. Meses antigos (mais de 2) são apagados para economizar espaço.
"""
import argparse
from pathlib import Path

from huggingface_hub import HfApi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--saida', required=True)
    ap.add_argument('--repo', required=True, help='usuario/nome do conjunto de dados no Hugging Face')
    ap.add_argument('--manter', type=int, default=2, help='quantos meses manter publicados')
    a = ap.parse_args()

    raiz = Path(a.saida).expanduser()
    api = HfApi()
    api.create_repo(a.repo, repo_type='dataset', private=False, exist_ok=True)
    api.upload_folder(repo_id=a.repo, repo_type='dataset', folder_path=str(raiz / 'receita'),
                      path_in_repo='receita', commit_message='Base da Receita')

    meses = sorted({p.split('/')[1] for p in api.list_repo_files(a.repo, repo_type='dataset')
                    if p.startswith('receita/') and p.count('/') >= 2})
    for mes in meses[:-a.manter]:
        api.delete_folder(path_in_repo=f'receita/{mes}', repo_id=a.repo, repo_type='dataset',
                          commit_message=f'Apaga a base de {mes}')
        print('apagado', mes)
    print('Enviado. Endereço para o config.js:')
    print(f'https://huggingface.co/datasets/{a.repo}/resolve/main/receita/')


if __name__ == '__main__':
    main()
