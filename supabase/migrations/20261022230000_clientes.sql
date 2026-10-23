-- Fase F do PLANO-CRM, parte 1 (F-1): aba Clientes.
-- - Quando um contato vira "Fechado" (status cliente), o banco cria a ficha de cliente (public.clientes) e a
--   linha de valores (public.clientes_financeiro). A ficha é guardada se o contato sair de "Fechado" e volta
--   a aparecer se ele fechar de novo. Excluir o contato apaga a ficha, os valores e os atendimentos (cascade).
-- - Responsável do cliente = responsável do contato (um só).
-- - Valores em tabela separada, para a permissão ver_financeiro valer no banco.
-- - Permissões novas: ver_clientes (começa marcada), editar_clientes e ver_financeiro (começam desmarcadas).
-- - cliente_desde_alterar: corrige a data "Cliente desde" (quem tem editar_clientes).
-- - exportar_clientes: planilha de clientes, com a mesma trava de exportação da Fase D.
-- - admin_exportar (backup geral) passa a levar os dados de cliente de cada contato.

-- ---------- permissões novas ----------
create or replace function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"ver_painel":true,"ver_todos":true,"criar":true,"editar":true,"excluir":false,"exportar":false,"ver_equipe":true,"ver_empresa":true,"buscar_leads":true,"importar":false,"ver_clientes":true,"editar_clientes":false,"ver_financeiro":false}'::jsonb;
$$;

-- ---------- tabelas ----------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references public.prospects(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  contratou text not null default '' check (char_length(contratou) <= 200),
  inicio date,
  renovacao date,
  situacao text not null default 'ativo' check (situacao in ('ativo', 'pausado', 'cancelado')),
  motivo_cancelamento text not null default '' check (char_length(motivo_cancelamento) <= 300),
  observacoes text not null default '' check (char_length(observacoes) <= 4000),
  atendimentos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(atendimentos) = 'array' and jsonb_array_length(atendimentos) <= 200 and char_length(atendimentos::text) <= 300000),
  proxima_acao date,
  proxima_acao_nota text not null default '' check (char_length(proxima_acao_nota) <= 200),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint clientes_motivo_cancelamento check (situacao <> 'cancelado' or btrim(motivo_cancelamento) <> '')
);
create index if not exists clientes_empresa_idx on public.clientes (empresa_id);
comment on table public.clientes is 'Ficha de cliente: um por contato que virou Fechado. Responsável = o do contato.';

create table if not exists public.clientes_financeiro (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  valor numeric(12,2) check (valor is null or valor >= 0),
  tipo_valor text not null default 'mensal' check (tipo_valor in ('mensal', 'contrato')),
  forma_cobranca text not null default '' check (char_length(forma_cobranca) <= 80),
  atualizado_em timestamptz not null default now()
);
create index if not exists clientes_financeiro_empresa_idx on public.clientes_financeiro (empresa_id);
comment on table public.clientes_financeiro is 'Valores do cliente, em tabela separada para valer a permissão ver_financeiro.';

-- ---------- gatilhos ----------
-- o vínculo e a data de criação não mudam; atualizado_em é do servidor
create or replace function private.tocar_cliente() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.prospect_id := old.prospect_id;
  new.empresa_id := old.empresa_id;
  new.criado_em := old.criado_em;
  new.atualizado_em := now();
  return new;
end;
$$;
revoke all on function private.tocar_cliente() from public;
create trigger antes_atualizar_cliente before update on public.clientes
  for each row execute function private.tocar_cliente();

create or replace function private.tocar_cliente_financeiro() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.cliente_id := old.cliente_id;
  new.empresa_id := old.empresa_id;
  new.atualizado_em := now();
  return new;
end;
$$;
revoke all on function private.tocar_cliente_financeiro() from public;
create trigger antes_atualizar_cliente_financeiro before update on public.clientes_financeiro
  for each row execute function private.tocar_cliente_financeiro();

-- contato virou "Fechado": cria a ficha (se ainda não existe) e a linha de valores
create or replace function private.criar_ficha_cliente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cliente' and (tg_op = 'INSERT' or old.status is distinct from 'cliente') then
    insert into public.clientes (prospect_id, empresa_id, inicio)
    values (new.id, new.empresa_id, coalesce(new.cliente_desde, (now() at time zone 'America/Sao_Paulo')::date))
    on conflict (prospect_id) do nothing;
    insert into public.clientes_financeiro (cliente_id, empresa_id)
    select c.id, c.empresa_id from public.clientes c where c.prospect_id = new.id
    on conflict (cliente_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.criar_ficha_cliente() from public;
create trigger depois_salvar_prospect_cliente after insert or update of status on public.prospects
  for each row execute function private.criar_ficha_cliente();

-- clientes que já existiam
insert into public.clientes (prospect_id, empresa_id, inicio)
select x.id, x.empresa_id, x.cliente_desde from public.prospects x where x.status = 'cliente'
on conflict (prospect_id) do nothing;
insert into public.clientes_financeiro (cliente_id, empresa_id)
select c.id, c.empresa_id from public.clientes c
on conflict (cliente_id) do nothing;

-- igual à versão anterior, mais a correção de "Cliente desde" feita por cliente_desde_alterar
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

  -- cliente desde (a tela não decide: o banco grava e limpa; só cliente_desde_alterar corrige)
  if new.status = 'cliente' then
    if tg_op = 'UPDATE' and old.status = 'cliente' and new.cliente_desde is not null
       and coalesce(current_setting('pp.cliente_desde', true), '') = new.cliente_desde::text then
      null;
    else
      new.cliente_desde := case when tg_op = 'UPDATE' then coalesce(old.cliente_desde, v_hoje) else v_hoje end;
    end if;
  else
    new.cliente_desde := null;
  end if;
  return new;
end;
$$;

-- ---------- regras de acesso ----------
alter table public.clientes enable row level security;
alter table public.clientes_financeiro enable row level security;

-- vê a ficha quem tem ver_clientes e enxerga o contato (as regras de prospects valem dentro do exists)
create policy "clientes: ver" on public.clientes for select to authenticated
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()) and (select private.pode('ver_clientes'))
         and exists (select 1 from public.prospects x where x.id = prospect_id));
create policy "clientes: editar" on public.clientes for update to authenticated
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
         and (select private.pode('ver_clientes')) and (select private.pode('editar_clientes'))
         and exists (select 1 from public.prospects x where x.id = prospect_id))
  with check (empresa_id = (select private.minha_empresa()));
-- sem regra de criar nem de excluir: a ficha nasce pelo gatilho e some com o contato

create policy "clientes_financeiro: ver" on public.clientes_financeiro for select to authenticated
  using (empresa_id = (select private.minha_empresa()) and (select private.pode('ver_financeiro'))
         and exists (select 1 from public.clientes c where c.id = cliente_id));
create policy "clientes_financeiro: editar" on public.clientes_financeiro for update to authenticated
  using (empresa_id = (select private.minha_empresa()) and (select private.pode('ver_financeiro')) and (select private.pode('editar_clientes'))
         and exists (select 1 from public.clientes c where c.id = cliente_id))
  with check (empresa_id = (select private.minha_empresa()));

grant select, update on public.clientes to authenticated;
grant select, update on public.clientes_financeiro to authenticated;
revoke insert, delete, truncate on public.clientes, public.clientes_financeiro from authenticated, anon;
revoke all on public.clientes, public.clientes_financeiro from anon;

-- ---------- corrigir "Cliente desde" ----------
create or replace function public.cliente_desde_alterar(p_prospect uuid, p_data date) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not (private.conta_ativa() and private.pode('ver_clientes') and private.pode('editar_clientes')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_data is null or p_data < date '1990-01-01' or p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.prospects x
                 where x.id = p_prospect and x.empresa_id = private.minha_empresa() and x.status = 'cliente'
                   and (private.pode('ver_todos') or x.user_id = v_uid or x.responsavel = v_uid)) then
    raise exception 'nao_encontrado' using errcode = 'P0002';
  end if;
  perform set_config('pp.cliente_desde', p_data::text, true);
  update public.prospects set cliente_desde = p_data where id = p_prospect;
  perform set_config('pp.cliente_desde', '', true);
  return p_data;
end;
$$;
revoke all on function public.cliente_desde_alterar(uuid, date) from public, anon;
grant execute on function public.cliente_desde_alterar(uuid, date) to authenticated;

-- ---------- exportar clientes (mesma trava da Fase D) ----------
create or replace function private.registrar_exportacao_clientes(p_qtd int) returns void
language sql security definer set search_path = '' as $$
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'exportar_clientes', private.minha_empresa(), 'clientes=' || p_qtd);
$$;
revoke all on function private.registrar_exportacao_clientes(int) from public;
grant execute on function private.registrar_exportacao_clientes(int) to authenticated;

-- roda com o login de quem chamou: só vêm as fichas que a pessoa enxerga, e os valores só para quem tem ver_financeiro
create or replace function public.exportar_clientes() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_nomes jsonb;
  v_linhas jsonb;
begin
  if not (private.conta_ativa() and private.pode('exportar') and private.pode('ver_clientes')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if not private.exportacao_ok(private.minha_empresa()) then
    raise exception 'exportacao_bloqueada' using errcode = '42501';
  end if;
  v_nomes := private.nomes_da_empresa();
  select coalesce(jsonb_agg(jsonb_build_object(
      'empresa', x.empresa, 'contato', x.contato, 'telefone', x.telefone, 'email', x.email,
      'cidade', x.cidade, 'uf', x.uf, 'cnpj', x.cnpj, 'cliente_desde', x.cliente_desde,
      'responsavel', v_nomes ->> x.responsavel::text,
      'contratou', c.contratou, 'inicio', c.inicio, 'renovacao', c.renovacao, 'situacao', c.situacao,
      'motivo_cancelamento', c.motivo_cancelamento, 'proxima_acao', c.proxima_acao,
      'proxima_acao_nota', c.proxima_acao_nota, 'observacoes', c.observacoes, 'atendimentos', c.atendimentos,
      'valor', f.valor, 'tipo_valor', f.tipo_valor, 'forma_cobranca', f.forma_cobranca)
      order by lower(coalesce(nullif(x.empresa, ''), x.contato))), '[]'::jsonb)
    into v_linhas
  from public.clientes c
  join public.prospects x on x.id = c.prospect_id
  left join public.clientes_financeiro f on f.cliente_id = c.id
  where c.empresa_id = private.minha_empresa() and x.status = 'cliente';
  perform private.registrar_exportacao_clientes(jsonb_array_length(v_linhas));
  return v_linhas;
end;
$$;
revoke all on function public.exportar_clientes() from public, anon;
grant execute on function public.exportar_clientes() to authenticated;

-- ---------- backup geral: cada contato leva os dados de cliente ----------
create or replace function public.admin_exportar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  insert into private.auditoria (admin_id, acao) values ((select auth.uid()), 'exportar');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'status', e.status, 'criado_em', e.criado_em,
      'cadastro', jsonb_build_object(
        'razao_social', e.razao_social, 'documento', e.documento, 'segmento', e.segmento,
        'telefone', e.telefone, 'email', e.email, 'site', e.site, 'instagram', e.instagram,
        'cep', e.cep, 'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento,
        'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf, 'descricao', e.descricao),
      'usuarios', (
        select coalesce(jsonb_agg(jsonb_build_object('nome', p.nome, 'email', u.email, 'papel', p.papel) order by lower(p.nome)), '[]'::jsonb)
        from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id),
      'contatos', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'empresa', x.empresa, 'contato', x.contato, 'cargo', x.cargo, 'telefone', x.telefone,
          'email', x.email, 'cidade', x.cidade, 'uf', x.uf, 'segmento', x.segmento, 'porte', x.porte,
          'origem', x.origem, 'link', x.link, 'interesse', x.interesse, 'status', x.status,
          'proximo_contato', x.proximo_contato, 'ultimo_contato', x.ultimo_contato,
          'observacoes', x.observacoes, 'historico', x.historico,
          'criado_em', x.criado_em, 'atualizado_em', x.atualizado_em,
          'cadastrado_por', (select p.nome from public.profiles p where p.id = x.user_id),
          'responsavel', (select p.nome from public.profiles p where p.id = x.responsavel),
          'cliente_desde', x.cliente_desde,
          'cliente_situacao', c.situacao, 'cliente_contratou', c.contratou, 'cliente_inicio', c.inicio,
          'cliente_renovacao', c.renovacao, 'cliente_motivo_cancelamento', c.motivo_cancelamento,
          'cliente_proxima_acao', c.proxima_acao, 'cliente_proxima_acao_nota', c.proxima_acao_nota,
          'cliente_observacoes', c.observacoes, 'cliente_atendimentos', c.atendimentos,
          'cliente_valor', f.valor, 'cliente_tipo_valor', case when c.id is not null then f.tipo_valor end,
          'cliente_forma_cobranca', f.forma_cobranca)
          order by x.criado_em), '[]'::jsonb)
        from public.prospects x
        left join public.clientes c on c.prospect_id = x.id
        left join public.clientes_financeiro f on f.cliente_id = c.id
        where x.empresa_id = e.id)
    ) order by lower(e.nome)), '[]'::jsonb)
    from public.empresas e
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
  );
end;
$$;
