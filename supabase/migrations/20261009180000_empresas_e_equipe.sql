-- PHAR Prospector: empresas com vários usuários, convites, simulação de acesso e painel geral.
-- Cada empresa é um "projeto": todos os usuários dela trabalham na mesma lista de contatos.

-- ---------- empresas ----------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 120),
  status text not null default 'pendente' check (status in ('pendente','ativa','bloqueada')),
  criado_em timestamptz not null default now(),
  liberado_em timestamptz
);
comment on table public.empresas is 'Uma linha por empresa cliente. status controla o acesso de todos os usuários dela.';

alter table public.profiles
  add column empresa_id uuid references public.empresas(id) on delete set null,
  add column papel text not null default 'dono' check (papel in ('dono','membro')),
  add column simulando uuid references public.empresas(id) on delete set null;
create index profiles_empresa_idx on public.profiles (empresa_id);
comment on column public.profiles.simulando is 'Só para admin: empresa que ele está vendo no modo simular.';

-- contas que já existiam: cada uma vira dona de uma empresa com o mesmo status
do $$
declare r record; v_emp uuid;
begin
  for r in select * from public.profiles loop
    insert into public.empresas (nome, status, criado_em, liberado_em)
    values (
      left(coalesce(nullif(btrim(r.empresa), ''), 'Empresa de ' || coalesce(nullif(btrim(r.nome), ''), 'novo usuário')), 120),
      r.status, r.criado_em, r.liberado_em
    ) returning id into v_emp;
    update public.profiles set empresa_id = v_emp, papel = 'dono', status = 'ativa' where id = r.id;
  end loop;
end $$;
alter table public.profiles alter column status set default 'ativa';

-- ---------- contatos passam a ser da empresa ----------
alter table public.prospects add column empresa_id uuid references public.empresas(id) on delete cascade;
update public.prospects x set empresa_id = p.empresa_id from public.profiles p where p.id = x.user_id;
alter table public.prospects alter column empresa_id set not null;
create index prospects_empresa_proximo_idx on public.prospects (empresa_id, proximo_contato);

-- ---------- tabelas internas (schema private: fora da API) ----------
create table private.convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email)) and char_length(email) between 3 and 120),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create table private.auditoria (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  acao text not null,
  empresa_id uuid references public.empresas(id) on delete set null,
  detalhe text not null default '',
  criado_em timestamptz not null default now()
);

-- ---------- funções de apoio ----------
create or replace function private.minha_empresa() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when p.is_admin and p.simulando is not null then p.simulando else p.empresa_id end
  from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'ativa';
$$;

create or replace function private.em_simulacao() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'ativa' and p.is_admin and p.simulando is not null
  );
$$;

-- a empresa em uso está ativa (ou é um admin simulando)
create or replace function private.conta_ativa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.empresas e
    where e.id = private.minha_empresa() and (e.status = 'ativa' or private.em_simulacao())
  );
$$;

create or replace function private.sou_dono() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'ativa'
      and (p.papel = 'dono' or (p.is_admin and p.simulando is not null))
  );
$$;

create or replace function private.nome_empresa_padrao(p_empresa text, p_nome text) returns text
language sql immutable set search_path = '' as $$
  select left(case
    when btrim(coalesce(p_empresa, '')) <> '' then btrim(p_empresa)
    when btrim(coalesce(p_nome, '')) <> '' then 'Empresa de ' || btrim(p_nome)
    else 'Nova empresa' end, 120);
$$;

-- cadastro: cria a conta e, se a pessoa não foi convidada por ninguém, a empresa dela (pendente)
create or replace function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := left(coalesce(new.raw_user_meta_data->>'nome', ''), 120);
  v_empresa text := left(btrim(coalesce(new.raw_user_meta_data->>'empresa', '')), 120);
  v_emp uuid;
begin
  if not exists (select 1 from private.convites c where c.email = lower(new.email)) then
    insert into public.empresas (nome) values (private.nome_empresa_padrao(v_empresa, v_nome))
    returning id into v_emp;
  end if;
  insert into public.profiles (id, nome, empresa, status, papel, empresa_id)
  values (new.id, v_nome, v_empresa, 'ativa', case when v_emp is null then 'membro' else 'dono' end, v_emp);
  return new;
end;
$$;

-- contato novo: empresa e autor vêm do servidor; limite por empresa
create or replace function private.limite_prospects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    new.user_id := (select auth.uid());
  end if;
  if (select count(*) from public.prospects x where x.empresa_id = new.empresa_id) >= 10000 then
    raise exception 'limite de contatos atingido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function private.tocar_prospect() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := old.user_id;
  new.empresa_id := old.empresa_id;
  new.criado_em := old.criado_em;
  new.atualizado_em := now();
  return new;
end;
$$;

alter table public.prospects alter column empresa_id set default private.minha_empresa();

-- ---------- regras de acesso ----------
alter policy "contatos: ver os proprios" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()));
alter policy "contatos: criar os proprios" on public.prospects
  with check (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()));
alter policy "contatos: editar os proprios" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()))
  with check (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()));
alter policy "contatos: excluir os proprios" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()));
alter policy "contatos: ver os proprios" on public.prospects rename to "contatos: ver os da empresa";
alter policy "contatos: criar os proprios" on public.prospects rename to "contatos: criar na empresa";
alter policy "contatos: editar os proprios" on public.prospects rename to "contatos: editar os da empresa";
alter policy "contatos: excluir os proprios" on public.prospects rename to "contatos: excluir os da empresa";

alter table public.empresas enable row level security;
create policy "empresa: ver a que estou usando" on public.empresas
  for select to authenticated
  using (id = (select private.minha_empresa()));
revoke all on public.empresas from anon, authenticated;
grant select on public.empresas to authenticated;

revoke all on function private.minha_empresa() from public;
revoke all on function private.em_simulacao() from public;
revoke all on function private.conta_ativa() from public;
revoke all on function private.sou_dono() from public;
revoke all on function private.nome_empresa_padrao(text, text) from public;
grant execute on function private.minha_empresa() to authenticated;
grant execute on function private.em_simulacao() to authenticated;
grant execute on function private.conta_ativa() to authenticated;
grant execute on function private.sou_dono() to authenticated;
