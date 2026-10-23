-- Fase C do PLANO-CRM: importar planilha de contatos, com aprovação do administrador geral.
-- - Permissão nova "importar" (colaborador começa sem; o responsável da empresa tem).
-- - A planilha vai para uma fila de espera (private.importacoes + private.importacao_linhas), nunca direto
--   em prospects. Até 2.000 linhas por envio, até 3 envios pendentes por empresa, teto de 10.000 contatos.
-- - Quem envia marca a declaração de origem legítima; o banco guarda quem e quando.
-- - Os dados são limpos ao entrar na fila: telefone só com números, e-mail em minúsculas (inválido fica vazio),
--   CNPJ conferido pelos dígitos (inválido fica vazio), UF só se existir.
-- - admin_importacao_aprovar grava em prospects (origem "Importação", data e planilha nas observações), pula
--   duplicados (mesmo CNPJ, telefone ou nome, na lista da empresa ou dentro da própria planilha), apaga as linhas
--   de espera e registra na auditoria. Quem enviou fica como "cadastrado por" e responsável.
-- - admin_importacoes faz a limpeza ao abrir o /admin: linhas de espera com mais de 30 dias somem e o envio
--   pendente vencido vira "recusada".

-- ---------- permissão nova ----------
create or replace function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"ver_painel":true,"ver_todos":true,"criar":true,"editar":true,"excluir":false,"exportar":false,"ver_equipe":true,"ver_empresa":true,"buscar_leads":true,"importar":false}'::jsonb;
$$;

-- ---------- fila de espera ----------
create table if not exists private.importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  enviado_por uuid references auth.users(id) on delete set null,
  arquivo text not null default '' check (char_length(arquivo) <= 200),
  linhas int not null check (linhas between 1 and 2000),
  estado text not null default 'pendente' check (estado in ('pendente', 'aprovada', 'recusada', 'concluida')),
  motivo text not null default '' check (char_length(motivo) <= 300),
  declarado_por uuid references auth.users(id) on delete set null,
  declarado_em timestamptz not null,
  inseridos int,
  pulados int,
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists importacoes_empresa_idx on private.importacoes (empresa_id, estado);
create index if not exists importacoes_estado_idx on private.importacoes (estado, criado_em);

create table if not exists private.importacao_linhas (
  importacao_id uuid not null references private.importacoes(id) on delete cascade,
  n int not null,
  dados jsonb not null,
  primary key (importacao_id, n)
);

-- ---------- limpeza dos dados de uma linha ----------
create or replace function private.cnpj_valido(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  d text := upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'));
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; dv1 int; dv2 int; i int;
begin
  if d !~ '^[0-9A-Z]{12}[0-9]{2}$' or d ~ '^(.)\1{13}$' then
    return false;
  end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(d, i, 1)) - 48) * p1[i]; end loop;
  r := s % 11; dv1 := case when r < 2 then 0 else 11 - r end;
  s := 0;
  for i in 1..13 loop s := s + (ascii(substr(d, i, 1)) - 48) * p2[i]; end loop;
  r := s % 11; dv2 := case when r < 2 then 0 else 11 - r end;
  return dv1 = ascii(substr(d, 13, 1)) - 48 and dv2 = ascii(substr(d, 14, 1)) - 48;
end;
$$;

create or replace function private.importacao_linha_limpa(r jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_tel text := regexp_replace(coalesce(r ->> 'telefone', ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(r ->> 'email', '')));
  v_cnpj text := upper(regexp_replace(coalesce(r ->> 'cnpj', ''), '[^0-9A-Za-z]', '', 'g'));
  v_uf text := upper(btrim(coalesce(r ->> 'uf', '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120 then v_email := ''; end if;
  if not private.cnpj_valido(v_cnpj) then v_cnpj := ''; end if;
  if v_uf <> all (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
                        'RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then v_uf := ''; end if;
  return jsonb_build_object(
    'empresa', left(btrim(coalesce(r ->> 'empresa', '')), 120),
    'contato', left(btrim(coalesce(r ->> 'contato', '')), 120),
    'cargo', left(btrim(coalesce(r ->> 'cargo', '')), 80),
    'telefone', left(v_tel, 30),
    'email', v_email,
    'cidade', left(btrim(coalesce(r ->> 'cidade', '')), 80),
    'uf', v_uf,
    'segmento', left(btrim(coalesce(r ->> 'segmento', '')), 80),
    'porte', left(btrim(coalesce(r ->> 'porte', '')), 20),
    'link', left(btrim(coalesce(r ->> 'link', '')), 200),
    'interesse', left(btrim(coalesce(r ->> 'interesse', '')), 200),
    'observacoes', left(btrim(coalesce(r ->> 'observacoes', '')), 3500),
    'cnpj', v_cnpj);
end;
$$;

-- ---------- enviar para aprovação (cliente) ----------
create or replace function public.importacao_enviar(p_arquivo text, p_linhas jsonb, p_declaro boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_emp uuid := private.minha_empresa();
  v_id uuid;
  v_total int;
  v_validas int;
begin
  if not (private.conta_ativa() and private.pode('importar')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_declaro is not true then
    raise exception 'sem_declaracao' using errcode = '22023';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or char_length(p_linhas::text) > 3000000 then
    raise exception 'arquivo_invalido' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_linhas);
  if v_total > 2000 then
    raise exception 'linhas_demais' using errcode = '22023';
  end if;
  if (select count(*) from private.importacoes i where i.empresa_id = v_emp and i.estado = 'pendente') >= 3 then
    raise exception 'pendentes_demais' using errcode = '22023';
  end if;

  create temp table if not exists pp_import_tmp (n int, dados jsonb) on commit drop;
  truncate pp_import_tmp;
  insert into pp_import_tmp (n, dados)
  select t.n, t.d from (
    select row_number() over (order by e.ord)::int as n, private.importacao_linha_limpa(e.val) as d
    from jsonb_array_elements(p_linhas) with ordinality as e(val, ord)
    where jsonb_typeof(e.val) = 'object'
  ) t
  where t.d ->> 'empresa' <> '' or t.d ->> 'contato' <> '';
  get diagnostics v_validas = row_count;
  if v_validas = 0 then
    raise exception 'sem_linhas' using errcode = '22023';
  end if;
  if (select count(*) from public.prospects x where x.empresa_id = v_emp) + v_validas > 10000 then
    raise exception 'sem_espaco' using errcode = 'P0001';
  end if;

  insert into private.importacoes (empresa_id, enviado_por, arquivo, linhas, declarado_por, declarado_em)
  values (v_emp, v_uid, left(btrim(coalesce(p_arquivo, '')), 200), v_validas, v_uid, now())
  returning id into v_id;
  insert into private.importacao_linhas (importacao_id, n, dados)
  select v_id, row_number() over (order by t.n)::int, t.dados from pp_import_tmp t;
  return jsonb_build_object('id', v_id, 'linhas', v_validas, 'descartadas', v_total - v_validas);
end;
$$;
revoke all on function public.importacao_enviar(text, jsonb, boolean) from public, anon;
grant execute on function public.importacao_enviar(text, jsonb, boolean) to authenticated;

-- ---------- Minhas importações (cliente) ----------
-- O responsável da empresa vê todos os envios da empresa; o colaborador, só os dele.
create or replace function public.importacoes_minhas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_dono boolean := private.sou_dono();
begin
  if not (private.conta_ativa() and private.pode('importar')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'arquivo', i.arquivo, 'linhas', i.linhas, 'estado', i.estado, 'motivo', i.motivo,
      'inseridos', i.inseridos, 'pulados', i.pulados, 'criado_em', i.criado_em, 'decidido_em', i.decidido_em,
      'enviado_por', coalesce(nullif(p.nome, ''), 'Alguém que saiu da equipe'))
      order by i.criado_em desc), '[]'::jsonb)
    from (select * from private.importacoes i
          where i.empresa_id = private.minha_empresa() and (v_dono or i.enviado_por = v_uid)
          order by i.criado_em desc limit 20) i
    left join public.profiles p on p.id = i.enviado_por
  );
end;
$$;
revoke all on function public.importacoes_minhas() from public, anon;
grant execute on function public.importacoes_minhas() to authenticated;

-- ---------- painel admin: lista, com limpeza ----------
create or replace function public.admin_importacoes() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  -- limpeza (item C.5): pendente com mais de 30 dias vence; linhas de espera antigas ou de recusadas somem
  update private.importacoes
     set estado = 'recusada', motivo = 'Venceu: 30 dias sem análise.', decidido_em = now()
   where estado = 'pendente' and criado_em < now() - interval '30 days';
  delete from private.importacao_linhas l
   using private.importacoes i
   where i.id = l.importacao_id and (i.estado <> 'pendente' or i.criado_em < now() - interval '30 days');

  return jsonb_build_object(
    'pendentes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'empresa_id', i.empresa_id, 'empresa', e.nome, 'arquivo', i.arquivo, 'linhas', i.linhas,
        'criado_em', i.criado_em, 'declarado_em', i.declarado_em,
        'enviado_por', coalesce(nullif(p.nome, ''), u.email, 'Conta excluída'), 'email', u.email,
        'contatos_empresa', (select count(*) from public.prospects x where x.empresa_id = i.empresa_id),
        'previa', (select coalesce(jsonb_agg(l.dados order by l.n), '[]'::jsonb)
                   from private.importacao_linhas l where l.importacao_id = i.id and l.n <= 10))
        order by i.criado_em), '[]'::jsonb)
      from private.importacoes i
      join public.empresas e on e.id = i.empresa_id
      left join public.profiles p on p.id = i.enviado_por
      left join auth.users u on u.id = i.enviado_por
      where i.estado = 'pendente'),
    'recentes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'empresa', r.empresa, 'arquivo', r.arquivo, 'linhas', r.linhas, 'estado', r.estado,
        'motivo', r.motivo, 'inseridos', r.inseridos, 'pulados', r.pulados, 'decidido_em', r.decidido_em)
        order by r.decidido_em desc), '[]'::jsonb)
      from (select i.*, e.nome as empresa from private.importacoes i join public.empresas e on e.id = i.empresa_id
            where i.estado <> 'pendente' order by i.decidido_em desc nulls last limit 10) r)
  );
end;
$$;
revoke all on function public.admin_importacoes() from public, anon;
grant execute on function public.admin_importacoes() to authenticated;

-- ---------- gatilhos de prospects: a importação aprovada grava em nome de quem enviou ----------
-- Só vale dentro de admin_importacao_aprovar (marca pp.importando nesta transação) e para administrador geral.
create or replace function private.importando() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(current_setting('pp.importando', true), '') = 'sim' and private.is_admin();
$$;
revoke all on function private.importando() from public;

-- igual à versão anterior, mais a exceção da importação (o teto de 10 mil é conferido antes, de uma vez)
create or replace function private.limite_prospects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.importando() then
    return new;
  end if;
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  if (select count(*) from public.prospects x where x.empresa_id = new.empresa_id) >= 10000 then
    raise exception 'limite de contatos atingido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- igual à versão anterior, mais a exceção da importação (mantém o responsável que a função escolheu)
create or replace function private.regras_prospect() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eu uuid := (select auth.uid());
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- responsável
  if tg_op = 'INSERT' then
    if private.importando() then
      null;
    elsif v_eu is not null and not private.sou_dono() then
      new.responsavel := v_eu;
    elsif new.responsavel is null then
      new.responsavel := new.user_id;
    end if;
  elsif new.responsavel is distinct from old.responsavel and v_eu is not null and not private.sou_dono() then
    raise exception 'só o responsável pela conta troca o responsável do contato' using errcode = '42501';
  end if;
  if new.responsavel is not null and (tg_op = 'INSERT' or new.responsavel is distinct from old.responsavel)
     and not exists (select 1 from public.profiles p where p.id = new.responsavel and p.empresa_id = new.empresa_id) then
    raise exception 'responsável precisa ser da equipe' using errcode = '22023';
  end if;

  -- cliente desde (a tela não decide: o banco grava e limpa)
  if new.status = 'cliente' then
    new.cliente_desde := case when tg_op = 'UPDATE' then coalesce(old.cliente_desde, v_hoje) else v_hoje end;
  else
    new.cliente_desde := null;
  end if;
  return new;
end;
$$;

-- ---------- aprovar (admin) ----------
create or replace function public.admin_importacao_aprovar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  imp private.importacoes;
  v_autor uuid;
  v_novas int;
  v_livre int;
  v_inseridos int;
  v_obs text;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select * into imp from private.importacoes where id = p_id for update;
  if not found then
    raise exception 'nao_encontrada' using errcode = 'P0002';
  end if;
  if imp.estado <> 'pendente' then
    raise exception 'ja_decidida' using errcode = '22023';
  end if;
  if not exists (select 1 from private.importacao_linhas l where l.importacao_id = p_id) then
    raise exception 'sem_linhas' using errcode = '22023';
  end if;
  -- quem enviou continua na empresa? senão o contato entra sem dono nem responsável
  select p.id into v_autor from public.profiles p where p.id = imp.enviado_por and p.empresa_id = imp.empresa_id;
  v_obs := 'Importado em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
           || case when imp.arquivo <> '' then ' (planilha "' || imp.arquivo || '")' else '' end || '.';

  create temp table if not exists pp_aprovar_tmp (n int, d jsonb, dup boolean) on commit drop;
  truncate pp_aprovar_tmp;
  insert into pp_aprovar_tmp (n, d, dup)
  select n, d,
         -- já na lista da empresa
         exists (select 1 from public.prospects x where x.empresa_id = imp.empresa_id and (
             (k_cnpj <> '' and x.cnpj = k_cnpj)
          or (k_tel <> '' and regexp_replace(x.telefone, '\D', '', 'g') = k_tel)
          or (k_nome <> '' and lower(btrim(coalesce(nullif(x.empresa, ''), x.contato))) = k_nome)))
         -- repetido dentro da própria planilha (fica a primeira ocorrência)
         or (k_cnpj <> '' and row_number() over (partition by k_cnpj order by n) > 1)
         or (k_tel <> '' and row_number() over (partition by k_tel order by n) > 1)
         or (k_nome <> '' and row_number() over (partition by k_nome order by n) > 1)
  from (
    select l.n, l.dados as d, l.dados ->> 'cnpj' as k_cnpj,
           case when char_length(l.dados ->> 'telefone') >= 8 then l.dados ->> 'telefone' else '' end as k_tel,
           lower(btrim(coalesce(nullif(l.dados ->> 'empresa', ''), l.dados ->> 'contato'))) as k_nome
    from private.importacao_linhas l where l.importacao_id = p_id
  ) z;

  select count(*) into v_novas from pp_aprovar_tmp where not dup;
  v_livre := 10000 - (select count(*) from public.prospects x where x.empresa_id = imp.empresa_id);
  if v_novas > v_livre then
    raise exception 'sem_espaco' using errcode = 'P0001', detail = 'livre=' || greatest(v_livre, 0) || '; novas=' || v_novas;
  end if;

  perform set_config('pp.importando', 'sim', true);
  insert into public.prospects (empresa_id, user_id, responsavel, status, origem, observacoes,
                                empresa, contato, cargo, telefone, email, cidade, uf, segmento, porte, link, interesse, cnpj)
  select imp.empresa_id, v_autor, v_autor, 'novo', 'Importação',
         left(v_obs || case when t.d ->> 'observacoes' <> '' then E'\n' || (t.d ->> 'observacoes') else '' end, 4000),
         t.d ->> 'empresa', t.d ->> 'contato', t.d ->> 'cargo', t.d ->> 'telefone', t.d ->> 'email',
         t.d ->> 'cidade', t.d ->> 'uf', t.d ->> 'segmento', t.d ->> 'porte', t.d ->> 'link', t.d ->> 'interesse',
         t.d ->> 'cnpj'
  from pp_aprovar_tmp t where not t.dup order by t.n
  on conflict (empresa_id, cnpj) where cnpj <> '' do nothing;
  get diagnostics v_inseridos = row_count;
  perform set_config('pp.importando', '', true);

  update private.importacoes
     set estado = 'concluida', inseridos = v_inseridos, pulados = linhas - v_inseridos,
         decidido_por = (select auth.uid()), decidido_em = now()
   where id = p_id;
  delete from private.importacao_linhas where importacao_id = p_id;
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'importacao_aprovada', imp.empresa_id,
          'linhas=' || imp.linhas || '; inseridos=' || v_inseridos || '; pulados=' || (imp.linhas - v_inseridos));
  return jsonb_build_object('inseridos', v_inseridos, 'pulados', imp.linhas - v_inseridos);
end;
$$;
revoke all on function public.admin_importacao_aprovar(uuid) from public, anon;
grant execute on function public.admin_importacao_aprovar(uuid) to authenticated;

-- ---------- recusar (admin) ----------
create or replace function public.admin_importacao_recusar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  imp private.importacoes;
  v_motivo text := left(btrim(coalesce(p_motivo, '')), 300);
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_motivo = '' then
    raise exception 'sem_motivo' using errcode = '22023';
  end if;
  update private.importacoes
     set estado = 'recusada', motivo = v_motivo, decidido_por = (select auth.uid()), decidido_em = now()
   where id = p_id and estado = 'pendente'
  returning * into imp;
  if not found then
    raise exception 'nao_encontrada' using errcode = 'P0002';
  end if;
  delete from private.importacao_linhas where importacao_id = p_id;
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'importacao_recusada', imp.empresa_id, 'linhas=' || imp.linhas || '; motivo=' || v_motivo);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_importacao_recusar(uuid, text) from public, anon;
grant execute on function public.admin_importacao_recusar(uuid, text) to authenticated;
