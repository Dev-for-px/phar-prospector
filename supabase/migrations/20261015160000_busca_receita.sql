-- Aba "Buscar leads" (base da Receita): dados de CNPJ no contato, sem duplicar CNPJ na mesma empresa,
-- permissão buscar_leads e duas funções para a tela (quais CNPJs já estão na lista e adicionar em lote).
-- Só acrescenta: nenhuma coluna ou dado existente é apagado.

-- ---------- colunas novas no contato (itens 1.3 e 2.4 do plano) ----------
alter table public.prospects
  add column cnpj text not null default '' check (cnpj = '' or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  add column razao_social text not null default '' check (char_length(razao_social) <= 160),
  add column cnae text not null default '' check (char_length(cnae) <= 10),
  add column situacao text not null default '' check (char_length(situacao) <= 20),
  add column abertura date,
  add column porte_receita text not null default '' check (char_length(porte_receita) <= 10),
  add column endereco text not null default '' check (char_length(endereco) <= 250);

comment on column public.prospects.cnpj is 'CNPJ só com letras e números (14 posições) ou vazio.';
comment on column public.prospects.porte_receita is 'Porte na Receita: MEI, ME, EPP ou DEMAIS.';
comment on column public.prospects.endereco is 'Endereço em uma linha: logradouro, número, complemento, bairro e CEP.';

-- o mesmo CNPJ não entra duas vezes na lista da mesma empresa
create unique index prospects_empresa_cnpj_uidx on public.prospects (empresa_id, cnpj) where cnpj <> '';

-- ---------- permissão nova: buscar leads (começa marcada) ----------
create or replace function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"ver_painel":true,"ver_todos":true,"criar":true,"editar":true,"excluir":false,"exportar":false,"ver_equipe":true,"ver_empresa":true,"buscar_leads":true}'::jsonb;
$$;

-- ---------- quais destes CNPJs já estão na lista da empresa ----------
-- Responde só com os CNPJs (nenhum outro dado), mesmo para quem vê só os próprios contatos,
-- para a tela marcar "já na lista" e não tentar adicionar de novo.
create function public.prospects_cnpjs_existentes(p_cnpjs text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.conta_ativa() and private.pode('buscar_leads')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if coalesce(array_length(p_cnpjs, 1), 0) > 1000 then
    raise exception 'lista grande demais' using errcode = '22023';
  end if;
  return coalesce((
    select array_agg(distinct x.cnpj) from public.prospects x
    where x.empresa_id = private.minha_empresa() and x.cnpj = any (p_cnpjs) and x.cnpj <> ''
  ), '{}');
end;
$$;
revoke all on function public.prospects_cnpjs_existentes(text[]) from public, anon;
grant execute on function public.prospects_cnpjs_existentes(text[]) to authenticated;

-- ---------- adicionar várias empresas de uma vez ----------
-- Roda com o login de quem chamou (security invoker): as regras de acesso de prospects valem
-- (permissão criar, empresa ativa, limite de 10 mil). CNPJ repetido é pulado, não dá erro.
create function public.prospects_adicionar_lote(p_linhas jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_total int := jsonb_array_length(p_linhas);
  v_inseridos int;
begin
  if not private.pode('buscar_leads') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_total > 200 then
    raise exception 'no máximo 200 por vez' using errcode = '22023';
  end if;
  insert into public.prospects (empresa, telefone, email, cidade, uf, segmento, porte, origem, link, status,
                                cnpj, razao_social, cnae, situacao, abertura, porte_receita, endereco)
  select left(coalesce(r.empresa, ''), 120), left(coalesce(r.telefone, ''), 30), left(coalesce(r.email, ''), 120),
         left(coalesce(r.cidade, ''), 80), left(coalesce(r.uf, ''), 2), left(coalesce(r.segmento, ''), 80),
         left(coalesce(r.porte, ''), 20), left(coalesce(r.origem, ''), 40), left(coalesce(r.link, ''), 200), 'novo',
         coalesce(r.cnpj, ''), left(coalesce(r.razao_social, ''), 160), left(coalesce(r.cnae, ''), 10),
         left(coalesce(r.situacao, ''), 20), r.abertura, left(coalesce(r.porte_receita, ''), 10),
         left(coalesce(r.endereco, ''), 250)
  from jsonb_to_recordset(p_linhas) as r(empresa text, telefone text, email text, cidade text, uf text,
       segmento text, porte text, origem text, link text, cnpj text, razao_social text, cnae text,
       situacao text, abertura date, porte_receita text, endereco text)
  where coalesce(r.empresa, '') <> ''
  on conflict (empresa_id, cnpj) where cnpj <> '' do nothing;
  get diagnostics v_inseridos = row_count;
  return jsonb_build_object('inseridos', v_inseridos, 'pulados', v_total - v_inseridos);
end;
$$;
revoke all on function public.prospects_adicionar_lote(jsonb) from public, anon;
grant execute on function public.prospects_adicionar_lote(jsonb) to authenticated;
