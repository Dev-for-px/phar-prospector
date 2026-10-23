-- PHAR Prospector — banco completo em um arquivo só.
-- GERADO por scripts/gerar-schema.mjs a partir de supabase/migrations. Não edite à mão: mude as migrações e gere de novo.
--
-- Para recriar o banco em um projeto NOVO do Supabase:
--   1. Supabase > SQL Editor > New query
--   2. Cole este arquivo inteiro e clique em Run (roda uma vez só, em projeto vazio)
--   3. Siga docs/DOCUMENTACAO.md, parte "Reconstruir do zero", para criar a conta de administrador
--
-- Migrações incluídas, na ordem: 20261009142509_estrutura_inicial.sql, 20261009180000_empresas_e_equipe.sql, 20261009180100_funcoes_sessao_equipe.sql, 20261009180150_funcoes_admin.sql, 20261009180200_limpeza.sql, 20261009190000_dados_da_empresa.sql, 20261009200000_permissoes_da_equipe.sql, 20261015160000_busca_receita.sql, 20261022190000_kanban_responsavel.sql, 20261022200000_excluir_lote.sql, 20261022210000_exportacao_travada.sql, 20261022220000_importacao_aprovada.sql, 20261022230000_clientes.sql

begin;

-- =====================================================================
-- 20261009142509_estrutura_inicial.sql
-- =====================================================================
-- PHAR Prospector: estrutura inicial
-- Contas (profiles), contatos (prospects), regras por usuário e funções do painel admin.

create schema if not exists private;

-- ---------- contas ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '' check (char_length(nome) <= 120),
  empresa text not null default '' check (char_length(empresa) <= 120),
  status text not null default 'pendente' check (status in ('pendente','ativa','bloqueada')),
  is_admin boolean not null default false,
  criado_em timestamptz not null default now(),
  liberado_em timestamptz
);
comment on table public.profiles is 'Uma linha por conta. status controla o acesso: pendente, ativa ou bloqueada.';

-- ---------- contatos ----------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  empresa text not null default '' check (char_length(empresa) <= 120),
  contato text not null default '' check (char_length(contato) <= 120),
  cargo text not null default '' check (char_length(cargo) <= 80),
  telefone text not null default '' check (char_length(telefone) <= 30),
  email text not null default '' check (char_length(email) <= 120),
  cidade text not null default '' check (char_length(cidade) <= 80),
  uf text not null default '' check (char_length(uf) <= 2),
  segmento text not null default '' check (char_length(segmento) <= 80),
  porte text not null default '' check (char_length(porte) <= 20),
  origem text not null default '' check (char_length(origem) <= 40),
  link text not null default '' check (char_length(link) <= 200),
  interesse text not null default '' check (char_length(interesse) <= 200),
  status text not null default 'novo'
    check (status in ('novo','contatado','conversa','diagnostico','proposta','depois','cliente','perdido')),
  proximo_contato date,
  ultimo_contato date,
  observacoes text not null default '' check (char_length(observacoes) <= 4000),
  historico jsonb not null default '[]'::jsonb
    check (jsonb_typeof(historico) = 'array' and jsonb_array_length(historico) <= 200 and char_length(historico::text) <= 300000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint prospects_tem_nome check (empresa <> '' or contato <> '')
);
comment on table public.prospects is 'Contatos de prospecção. Cada linha pertence a uma conta (user_id) e só ela enxerga.';
create index prospects_user_proximo_idx on public.prospects (user_id, proximo_contato);

-- ---------- funções de apoio (schema private: não ficam expostas na API) ----------
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin and p.status = 'ativa'
  );
$$;

create function private.conta_ativa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'ativa'
  );
$$;

-- cria a conta (pendente) quando alguém se cadastra
create function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nome, empresa)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'nome', ''), 120),
    left(coalesce(new.raw_user_meta_data->>'empresa', ''), 120)
  );
  return new;
end;
$$;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function private.novo_usuario();

-- limite de contatos por conta
create function private.limite_prospects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.prospects x where x.user_id = new.user_id) >= 5000 then
    raise exception 'limite de contatos atingido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger antes_inserir_prospect before insert on public.prospects
  for each row execute function private.limite_prospects();

-- dono e data de criação não mudam; atualizado_em é sempre do servidor
create function private.tocar_prospect() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := old.user_id;
  new.criado_em := old.criado_em;
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger antes_atualizar_prospect before update on public.prospects
  for each row execute function private.tocar_prospect();

-- ---------- regras de acesso (RLS) ----------
alter table public.profiles enable row level security;
alter table public.prospects enable row level security;

create policy "conta: ver a propria" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "contatos: ver os proprios" on public.prospects
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.conta_ativa()));

create policy "contatos: criar os proprios" on public.prospects
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.conta_ativa()));

create policy "contatos: editar os proprios" on public.prospects
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.conta_ativa()))
  with check (user_id = (select auth.uid()) and (select private.conta_ativa()));

create policy "contatos: excluir os proprios" on public.prospects
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.conta_ativa()));

-- ---------- permissões ----------
revoke all on public.profiles from anon, authenticated;
revoke all on public.prospects from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.prospects to authenticated;

grant usage on schema private to authenticated;
revoke all on function private.is_admin() from public;
revoke all on function private.conta_ativa() from public;
revoke all on function private.novo_usuario() from public;
revoke all on function private.limite_prospects() from public;
revoke all on function private.tocar_prospect() from public;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.conta_ativa() to authenticated;

-- ---------- painel admin ----------
-- Lista as contas com a contagem de contatos. Não devolve o conteúdo dos contatos.
create function public.admin_contas()
returns table (
  id uuid, nome text, empresa text, email text, status text, is_admin boolean,
  criado_em timestamptz, liberado_em timestamptz, ultimo_acesso timestamptz,
  email_confirmado boolean, contatos bigint
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.empresa, u.email::text, p.status, p.is_admin,
         p.criado_em, p.liberado_em, u.last_sign_in_at,
         u.email_confirmed_at is not null,
         (select count(*) from public.prospects x where x.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where private.is_admin()
  order by p.criado_em desc;
$$;

create function public.admin_definir_status(alvo uuid, novo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  if novo not in ('pendente','ativa','bloqueada') then
    raise exception 'status invalido' using errcode = '22023';
  end if;
  if alvo = (select auth.uid()) then
    raise exception 'nao e possivel alterar a propria conta' using errcode = '22023';
  end if;
  update public.profiles
     set status = novo,
         liberado_em = case when novo = 'ativa' then coalesce(liberado_em, now()) else liberado_em end
   where id = alvo;
  if not found then
    raise exception 'conta nao encontrada' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_contas() from public, anon;
revoke all on function public.admin_definir_status(uuid, text) from public, anon;
grant execute on function public.admin_contas() to authenticated;
grant execute on function public.admin_definir_status(uuid, text) to authenticated;

-- =====================================================================
-- 20261009180000_empresas_e_equipe.sql
-- =====================================================================
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

-- =====================================================================
-- 20261009180100_funcoes_sessao_equipe.sql
-- =====================================================================
-- PHAR Prospector: sessão e equipe (funções chamadas pelo site).

-- Convite não é apagado: muda de estado. Assim fica o registro de quem autorizou quem.
alter table private.convites
  add column estado text not null default 'pendente' check (estado in ('pendente','aceito','cancelado'));

-- cadastro: só convite pendente dispensa a criação de uma empresa nova
create or replace function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := left(coalesce(new.raw_user_meta_data->>'nome', ''), 120);
  v_empresa text := left(btrim(coalesce(new.raw_user_meta_data->>'empresa', '')), 120);
  v_emp uuid;
begin
  if not exists (select 1 from private.convites c where c.email = lower(new.email) and c.estado = 'pendente') then
    insert into public.empresas (nome) values (private.nome_empresa_padrao(v_empresa, v_nome))
    returning id into v_emp;
  end if;
  insert into public.profiles (id, nome, empresa, status, papel, empresa_id)
  values (new.id, v_nome, v_empresa, 'ativa', case when v_emp is null then 'membro' else 'dono' end, v_emp);
  return new;
end;
$$;

-- ---------- sessão: quem sou, em que empresa estou ----------
-- Também aceita convite pendente para o e-mail (já confirmado) de quem está entrando.
create function public.minha_sessao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
  e public.empresas;
  c private.convites;
  v_email text;
  v_confirmado boolean;
  v_antiga uuid;
  v_nova uuid;
  v_ef uuid;
  v_sim boolean := false;
begin
  if v_uid is null then
    raise exception 'sem login' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('usuario', null, 'empresa', null, 'simulando', false);
  end if;
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmado
  from auth.users u where u.id = v_uid;

  if v_confirmado and not p.is_admin then
    select * into c from private.convites where email = v_email and estado = 'pendente';
    if found then
      if p.empresa_id is not distinct from c.empresa_id then
        update private.convites set estado = 'aceito' where id = c.id;
      else
        v_antiga := p.empresa_id;
        -- só troca de empresa quem está sozinho em uma empresa sem contatos
        if v_antiga is null or (
             not exists (select 1 from public.profiles o where o.empresa_id = v_antiga and o.id <> v_uid)
             and not exists (select 1 from public.prospects x where x.empresa_id = v_antiga)
           ) then
          update public.profiles set empresa_id = c.empresa_id, papel = 'membro', status = 'ativa' where id = v_uid;
          update private.convites set estado = 'aceito' where id = c.id;
          -- a empresa antiga fica vazia e deixa de aparecer no painel admin
          select * into p from public.profiles where id = v_uid;
        end if;
      end if;
    end if;
  end if;

  -- conta ativa sem empresa e sem convite (ex.: convite cancelado antes do primeiro acesso)
  if p.empresa_id is null and p.status = 'ativa'
     and not exists (select 1 from private.convites where email = v_email and estado = 'pendente') then
    insert into public.empresas (nome) values (private.nome_empresa_padrao(p.empresa, p.nome))
    returning id into v_nova;
    update public.profiles set empresa_id = v_nova, papel = 'dono' where id = v_uid;
    select * into p from public.profiles where id = v_uid;
  end if;

  v_ef := p.empresa_id;
  if p.is_admin and p.status = 'ativa' and p.simulando is not null then
    v_ef := p.simulando;
    v_sim := true;
  end if;
  select * into e from public.empresas where id = v_ef;

  return jsonb_build_object(
    'usuario', jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'email', v_email,
      'papel', case when v_sim then 'dono' else p.papel end,
      'is_admin', p.is_admin and p.status = 'ativa',
      'status', p.status),
    'empresa', case when e.id is null then null
      else jsonb_build_object('id', e.id, 'nome', e.nome, 'status', e.status) end,
    'simulando', v_sim,
    'convite_pendente', exists (select 1 from private.convites where email = v_email and estado = 'pendente')
  );
end;
$$;

-- ---------- equipe ----------
create function public.equipe_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.minha_empresa();
begin
  if v_emp is null or not private.conta_ativa() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'membros', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', u.email, 'papel', p.papel, 'ultimo_acesso', u.last_sign_in_at)
        order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
      from public.profiles p join auth.users u on u.id = p.id
      where p.empresa_id = v_emp and p.status = 'ativa'),
    'convites', case when private.sou_dono() then (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'criado_em', c.criado_em)
        order by c.criado_em), '[]'::jsonb)
      from private.convites c where c.empresa_id = v_emp and c.estado = 'pendente') else '[]'::jsonb end,
    'pode_gerenciar', private.sou_dono()
  );
end;
$$;

create function public.equipe_convidar(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.minha_empresa();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_alvo uuid;
  v_emp_alvo uuid;
begin
  if v_emp is null or not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120 then
    raise exception 'email_invalido' using errcode = 'P0001';
  end if;
  if (select count(*) from public.profiles p where p.empresa_id = v_emp)
     + (select count(*) from private.convites c where c.empresa_id = v_emp and c.estado = 'pendente') >= 20 then
    raise exception 'limite_equipe' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.convites c where c.email = v_email and c.empresa_id = v_emp and c.estado = 'pendente') then
    raise exception 'ja_convidado' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.convites c where c.email = v_email and c.estado = 'pendente') then
    raise exception 'indisponivel' using errcode = 'P0001';
  end if;
  select u.id, p.empresa_id into v_alvo, v_emp_alvo
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = v_email;
  if found then
    if v_emp_alvo = v_emp then
      raise exception 'ja_membro' using errcode = 'P0001';
    end if;
    -- quem já usa o sistema em outra empresa (com colegas ou contatos) não é movido por convite
    if exists (select 1 from public.profiles p where p.id = v_alvo and p.is_admin)
       or (v_emp_alvo is not null and (
            exists (select 1 from public.profiles o where o.empresa_id = v_emp_alvo and o.id <> v_alvo)
            or exists (select 1 from public.prospects x where x.empresa_id = v_emp_alvo))) then
      raise exception 'indisponivel' using errcode = 'P0001';
    end if;
  end if;
  insert into private.convites (empresa_id, email, criado_por) values (v_emp, v_email, (select auth.uid()))
  on conflict (email) do update
    set empresa_id = excluded.empresa_id, criado_por = excluded.criado_por, criado_em = now(), estado = 'pendente';
end;
$$;

create function public.equipe_cancelar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update private.convites set estado = 'cancelado'
   where id = p_id and empresa_id = private.minha_empresa() and estado = 'pendente';
end;
$$;

create function public.equipe_remover(p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.minha_empresa();
begin
  if v_emp is null or not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_usuario = (select auth.uid()) then
    raise exception 'voce_mesmo' using errcode = 'P0001';
  end if;
  update public.profiles
     set empresa_id = null, papel = 'membro', status = 'bloqueada'
   where id = p_usuario and empresa_id = v_emp and papel <> 'dono' and not is_admin;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
end;
$$;

create function public.empresa_renomear(p_nome text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_nome text := btrim(coalesce(p_nome, ''));
begin
  if not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if char_length(v_nome) < 1 or char_length(v_nome) > 120 then
    raise exception 'nome_invalido' using errcode = 'P0001';
  end if;
  update public.empresas set nome = v_nome where id = private.minha_empresa();
end;
$$;

revoke all on function public.minha_sessao() from public, anon;
revoke all on function public.equipe_listar() from public, anon;
revoke all on function public.equipe_convidar(text) from public, anon;
revoke all on function public.equipe_cancelar_convite(uuid) from public, anon;
revoke all on function public.equipe_remover(uuid) from public, anon;
revoke all on function public.empresa_renomear(text) from public, anon;
grant execute on function public.minha_sessao() to authenticated;
grant execute on function public.equipe_listar() to authenticated;
grant execute on function public.equipe_convidar(text) to authenticated;
grant execute on function public.equipe_cancelar_convite(uuid) to authenticated;
grant execute on function public.equipe_remover(uuid) to authenticated;
grant execute on function public.empresa_renomear(text) to authenticated;

-- =====================================================================
-- 20261009180150_funcoes_admin.sql
-- =====================================================================
-- PHAR Prospector: painel admin (funções chamadas pelo site).

create function public.admin_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_minha uuid;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select p.empresa_id into v_minha from public.profiles p where p.id = (select auth.uid());
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'status', e.status,
      'criado_em', e.criado_em, 'liberado_em', e.liberado_em,
      'propria', e.id = v_minha,
      'contatos', (select count(*) from public.prospects x where x.empresa_id = e.id),
      'convites', (select count(*) from private.convites c where c.empresa_id = e.id and c.estado = 'pendente'),
      'ultimo_acesso', (select max(u.last_sign_in_at) from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id),
      'membros', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'nome', p.nome, 'email', u.email, 'papel', p.papel, 'is_admin', p.is_admin,
          'email_confirmado', u.email_confirmed_at is not null, 'ultimo_acesso', u.last_sign_in_at)
          order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
        from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id)
    ) order by e.criado_em desc), '[]'::jsonb)
    from public.empresas e
    -- empresa vazia (sem usuários, contatos nem convite pendente) não aparece
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
       or exists (select 1 from private.convites c where c.empresa_id = e.id and c.estado = 'pendente')
  );
end;
$$;

create function public.admin_empresa_status(alvo uuid, novo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if novo not in ('pendente','ativa','bloqueada') then
    raise exception 'status_invalido' using errcode = '22023';
  end if;
  if alvo = (select p.empresa_id from public.profiles p where p.id = (select auth.uid())) then
    raise exception 'propria_empresa' using errcode = '22023';
  end if;
  update public.empresas
     set status = novo,
         liberado_em = case when novo = 'ativa' then coalesce(liberado_em, now()) else liberado_em end
   where id = alvo;
  if not found then
    raise exception 'nao_encontrada' using errcode = 'P0002';
  end if;
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe) values ((select auth.uid()), 'status', alvo, novo);
end;
$$;

-- liga (alvo = id da empresa) ou desliga (alvo nulo) o modo simular
create function public.admin_simular(alvo uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_atual uuid; v_minha uuid;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select p.simulando, p.empresa_id into v_atual, v_minha from public.profiles p where p.id = v_uid;
  if alvo is not null and alvo = v_minha then
    alvo := null;
  end if;
  if alvo is not null and not exists (select 1 from public.empresas e where e.id = alvo) then
    raise exception 'nao_encontrada' using errcode = 'P0002';
  end if;
  if v_atual is not null and v_atual is distinct from alvo then
    insert into private.auditoria (admin_id, acao, empresa_id) values (v_uid, 'simular_fim', v_atual);
  end if;
  if alvo is not null and alvo is distinct from v_atual then
    insert into private.auditoria (admin_id, acao, empresa_id) values (v_uid, 'simular_inicio', alvo);
  end if;
  update public.profiles set simulando = alvo where id = v_uid;
end;
$$;

-- números gerais para os gráficos do admin (sem conteúdo de contato)
create function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'por_status', (
      select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      from (select x.status, count(*) as n from public.prospects x group by x.status) s),
    'contatos_dias', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia), '[]'::jsonb)
      from (select (x.criado_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
            from public.prospects x group by 1) d),
    'empresas_dias', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia), '[]'::jsonb)
      from (select (e.criado_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
            from public.empresas e
            where exists (select 1 from public.profiles p where p.empresa_id = e.id)
            group by 1) d),
    'usuarios', (select count(*) from public.profiles p where p.empresa_id is not null and p.status = 'ativa')
  );
end;
$$;

-- cópia completa para backup: todas as empresas com todos os contatos
create function public.admin_exportar() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  insert into private.auditoria (admin_id, acao) values ((select auth.uid()), 'exportar');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'status', e.status, 'criado_em', e.criado_em,
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
          'cadastrado_por', (select p.nome from public.profiles p where p.id = x.user_id))
          order by x.criado_em), '[]'::jsonb)
        from public.prospects x where x.empresa_id = e.id)
    ) order by lower(e.nome)), '[]'::jsonb)
    from public.empresas e
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
  );
end;
$$;

revoke all on function public.admin_empresas() from public, anon;
revoke all on function public.admin_empresa_status(uuid, text) from public, anon;
revoke all on function public.admin_simular(uuid) from public, anon;
revoke all on function public.admin_painel() from public, anon;
revoke all on function public.admin_exportar() from public, anon;
grant execute on function public.admin_empresas() to authenticated;
grant execute on function public.admin_empresa_status(uuid, text) to authenticated;
grant execute on function public.admin_simular(uuid) to authenticated;
grant execute on function public.admin_painel() to authenticated;
grant execute on function public.admin_exportar() to authenticated;

-- =====================================================================
-- 20261009180200_limpeza.sql
-- =====================================================================
-- PHAR Prospector: limpeza depois da mudança para empresas. Aplicada pelo SQL Editor do Supabase.
-- user_id vira "quem cadastrou": se a pessoa sair do sistema, o contato continua na empresa.
alter table public.prospects drop constraint prospects_user_id_fkey;
alter table public.prospects alter column user_id drop not null;
alter table public.prospects add constraint prospects_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- índice e funções da versão anterior (uma conta por pessoa), que o site não usa mais
drop index if exists public.prospects_user_proximo_idx;
drop function if exists public.admin_contas();
drop function if exists public.admin_definir_status(uuid, text);

-- =====================================================================
-- 20261009190000_dados_da_empresa.sql
-- =====================================================================
-- PHAR Prospector: cadastro completo da empresa (CNPJ ou CPF, razão social, contatos e endereço).
-- Só o responsável pela conta (ou o admin simulando) altera; todos os usuários da empresa leem.

alter table public.empresas
  add column razao_social text not null default '' check (char_length(razao_social) <= 160),
  -- só letras e números: CPF (11 dígitos) ou CNPJ (14 posições; o CNPJ novo pode ter letras)
  add column documento text not null default '' check (documento ~ '^(\d{11}|[A-Z0-9]{12}\d{2})?$'),
  add column segmento text not null default '' check (char_length(segmento) <= 80),
  add column telefone text not null default '' check (char_length(telefone) <= 30),
  add column email text not null default '' check (char_length(email) <= 120),
  add column site text not null default '' check (char_length(site) <= 200),
  add column instagram text not null default '' check (char_length(instagram) <= 80),
  add column cep text not null default '' check (cep ~ '^(\d{8})?$'),
  add column logradouro text not null default '' check (char_length(logradouro) <= 160),
  add column numero text not null default '' check (char_length(numero) <= 20),
  add column complemento text not null default '' check (char_length(complemento) <= 80),
  add column bairro text not null default '' check (char_length(bairro) <= 80),
  add column cidade text not null default '' check (char_length(cidade) <= 80),
  add column uf text not null default '' check (uf ~ '^([A-Z]{2})?$'),
  add column descricao text not null default '' check (char_length(descricao) <= 500),
  add column dados_em timestamptz;

-- cadastro completo = nome, documento, telefone, cidade e estado preenchidos
create function private.empresa_completa(e public.empresas) returns boolean
language sql stable set search_path = '' as $$
  select e.nome <> '' and e.documento <> '' and e.telefone <> '' and e.cidade <> '' and e.uf <> '';
$$;
revoke all on function private.empresa_completa(public.empresas) from public;

create function public.empresa_salvar(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.minha_empresa();
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_doc text := upper(regexp_replace(coalesce(p->>'documento', ''), '[^0-9A-Za-z]', '', 'g'));
  v_cep text := regexp_replace(coalesce(p->>'cep', ''), '\D', '', 'g');
  v_uf text := upper(btrim(coalesce(p->>'uf', '')));
  v_email text := lower(btrim(coalesce(p->>'email', '')));
begin
  if v_emp is null or not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if char_length(v_nome) < 1 or char_length(v_nome) > 120 then
    raise exception 'nome_invalido' using errcode = 'P0001';
  end if;
  if v_doc <> '' and v_doc !~ '^(\d{11}|[A-Z0-9]{12}\d{2})$' then
    raise exception 'documento_invalido' using errcode = 'P0001';
  end if;
  if v_cep <> '' and v_cep !~ '^\d{8}$' then
    raise exception 'cep_invalido' using errcode = 'P0001';
  end if;
  if v_uf <> '' and v_uf !~ '^[A-Z]{2}$' then
    raise exception 'uf_invalida' using errcode = 'P0001';
  end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120) then
    raise exception 'email_invalido' using errcode = 'P0001';
  end if;
  update public.empresas set
    nome = v_nome,
    razao_social = left(btrim(coalesce(p->>'razao_social', '')), 160),
    documento = v_doc,
    segmento = left(btrim(coalesce(p->>'segmento', '')), 80),
    telefone = left(btrim(coalesce(p->>'telefone', '')), 30),
    email = v_email,
    site = left(btrim(coalesce(p->>'site', '')), 200),
    instagram = left(btrim(coalesce(p->>'instagram', '')), 80),
    cep = v_cep,
    logradouro = left(btrim(coalesce(p->>'logradouro', '')), 160),
    numero = left(btrim(coalesce(p->>'numero', '')), 20),
    complemento = left(btrim(coalesce(p->>'complemento', '')), 80),
    bairro = left(btrim(coalesce(p->>'bairro', '')), 80),
    cidade = left(btrim(coalesce(p->>'cidade', '')), 80),
    uf = v_uf,
    descricao = left(btrim(coalesce(p->>'descricao', '')), 500),
    dados_em = now()
  where id = v_emp;
end;
$$;
revoke all on function public.empresa_salvar(jsonb) from public, anon;
grant execute on function public.empresa_salvar(jsonb) to authenticated;

-- painel admin: a lista de empresas passa a trazer os dados do cadastro
create or replace function public.admin_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_minha uuid;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select p.empresa_id into v_minha from public.profiles p where p.id = (select auth.uid());
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'status', e.status,
      'criado_em', e.criado_em, 'liberado_em', e.liberado_em,
      'propria', e.id = v_minha,
      'completo', private.empresa_completa(e),
      'razao_social', e.razao_social, 'documento', e.documento, 'segmento', e.segmento,
      'telefone', e.telefone, 'email', e.email, 'site', e.site, 'instagram', e.instagram,
      'cidade', e.cidade, 'uf', e.uf,
      'contatos', (select count(*) from public.prospects x where x.empresa_id = e.id),
      'convites', (select count(*) from private.convites c where c.empresa_id = e.id and c.estado = 'pendente'),
      'ultimo_acesso', (select max(u.last_sign_in_at) from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id),
      'membros', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'nome', p.nome, 'email', u.email, 'papel', p.papel, 'is_admin', p.is_admin,
          'email_confirmado', u.email_confirmed_at is not null, 'ultimo_acesso', u.last_sign_in_at)
          order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
        from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id)
    ) order by e.criado_em desc), '[]'::jsonb)
    from public.empresas e
    -- empresa vazia (sem usuários, contatos nem convite pendente) não aparece
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
       or exists (select 1 from private.convites c where c.empresa_id = e.id and c.estado = 'pendente')
  );
end;
$$;

-- backup: cada empresa vai com os dados do cadastro
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
          'cadastrado_por', (select p.nome from public.profiles p where p.id = x.user_id))
          order by x.criado_em), '[]'::jsonb)
        from public.prospects x where x.empresa_id = e.id)
    ) order by lower(e.nome)), '[]'::jsonb)
    from public.empresas e
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
  );
end;
$$;

-- =====================================================================
-- 20261009200000_permissoes_da_equipe.sql
-- =====================================================================
-- PHAR Prospector: permissões por colaborador.
-- O responsável pela conta marca o que cada pessoa da equipe pode ver e fazer.
-- O responsável (e o admin em modo simular) sempre pode tudo.

-- ---------- lista de permissões e valores iniciais ----------
--   ver_painel   ver a aba Painel (gráficos)                        só tela
--   ver_todos    ver os contatos de toda a equipe; sem ela, só os que a própria pessoa cadastrou
--   criar        cadastrar contatos
--   editar       editar contatos e registrar conversas
--   excluir      excluir contatos
--   exportar     baixar a planilha (CSV) dos contatos               só tela
--   ver_equipe   ver quem faz parte da equipe
--   ver_empresa  ver o cadastro da empresa (CNPJ, endereço)
create function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"ver_painel":true,"ver_todos":true,"criar":true,"editar":true,"excluir":false,"exportar":false,"ver_equipe":true,"ver_empresa":true}'::jsonb;
$$;

-- só as chaves conhecidas, sempre verdadeiro ou falso; o que faltar recebe o valor inicial
create function private.permissoes_limpas(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(d.key,
    case when jsonb_typeof(coalesce(p, '{}'::jsonb) -> d.key) = 'boolean' then coalesce(p, '{}'::jsonb) -> d.key else d.value end)
  from jsonb_each(private.permissoes_padrao()) d;
$$;

alter table public.profiles add column permissoes jsonb not null default '{}'::jsonb;
alter table private.convites add column permissoes jsonb not null default '{}'::jsonb;
comment on column public.profiles.permissoes is 'O que o colaborador pode ver e fazer. Vazio = valores iniciais. Não vale para o responsável (pode tudo).';

-- a pessoa logada pode fazer isso?
create function private.pode(p_chave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p.papel = 'dono' or (p.is_admin and p.simulando is not null) then true
      else (private.permissoes_limpas(p.permissoes) ->> p_chave)::boolean
    end
    from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'ativa'
  ), false);
$$;

revoke all on function private.permissoes_padrao() from public;
revoke all on function private.permissoes_limpas(jsonb) from public;
revoke all on function private.pode(text) from public;
grant execute on function private.pode(text) to authenticated;

-- ---------- regras de acesso passam a olhar as permissões ----------
alter policy "contatos: ver os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid())));
alter policy "contatos: criar na empresa" on public.prospects
  with check (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
              and (select private.pode('criar')));
alter policy "contatos: editar os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
         and (select private.pode('editar'))
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid())))
  with check (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()));
alter policy "contatos: excluir os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
         and (select private.pode('excluir'))
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid())));
alter policy "empresa: ver a que estou usando" on public.empresas
  using (id = (select private.minha_empresa()) and (select private.pode('ver_empresa')));

-- ---------- sessão: devolve também as permissões de quem entrou ----------
create or replace function public.minha_sessao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
  e public.empresas;
  c private.convites;
  v_email text;
  v_confirmado boolean;
  v_antiga uuid;
  v_nova uuid;
  v_ef uuid;
  v_sim boolean := false;
  v_tudo boolean;
begin
  if v_uid is null then
    raise exception 'sem login' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('usuario', null, 'empresa', null, 'simulando', false);
  end if;
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmado
  from auth.users u where u.id = v_uid;

  if v_confirmado and not p.is_admin then
    select * into c from private.convites where email = v_email and estado = 'pendente';
    if found then
      if p.empresa_id is not distinct from c.empresa_id then
        update private.convites set estado = 'aceito' where id = c.id;
        if p.papel <> 'dono' then
          update public.profiles set permissoes = private.permissoes_limpas(c.permissoes) where id = v_uid;
          select * into p from public.profiles where id = v_uid;
        end if;
      else
        v_antiga := p.empresa_id;
        -- só troca de empresa quem está sozinho em uma empresa sem contatos
        if v_antiga is null or (
             not exists (select 1 from public.profiles o where o.empresa_id = v_antiga and o.id <> v_uid)
             and not exists (select 1 from public.prospects x where x.empresa_id = v_antiga)
           ) then
          update public.profiles
             set empresa_id = c.empresa_id, papel = 'membro', status = 'ativa',
                 permissoes = private.permissoes_limpas(c.permissoes)
           where id = v_uid;
          update private.convites set estado = 'aceito' where id = c.id;
          -- a empresa antiga fica vazia e deixa de aparecer no painel admin
          select * into p from public.profiles where id = v_uid;
        end if;
      end if;
    end if;
  end if;

  -- conta ativa sem empresa e sem convite (ex.: convite cancelado antes do primeiro acesso)
  if p.empresa_id is null and p.status = 'ativa'
     and not exists (select 1 from private.convites where email = v_email and estado = 'pendente') then
    insert into public.empresas (nome) values (private.nome_empresa_padrao(p.empresa, p.nome))
    returning id into v_nova;
    update public.profiles set empresa_id = v_nova, papel = 'dono' where id = v_uid;
    select * into p from public.profiles where id = v_uid;
  end if;

  v_ef := p.empresa_id;
  if p.is_admin and p.status = 'ativa' and p.simulando is not null then
    v_ef := p.simulando;
    v_sim := true;
  end if;
  select * into e from public.empresas where id = v_ef;
  v_tudo := v_sim or p.papel = 'dono';

  return jsonb_build_object(
    'usuario', jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'email', v_email,
      'papel', case when v_sim then 'dono' else p.papel end,
      'is_admin', p.is_admin and p.status = 'ativa',
      'status', p.status),
    'empresa', case when e.id is null then null
      else jsonb_build_object('id', e.id, 'nome', e.nome, 'status', e.status) end,
    'simulando', v_sim,
    'permissoes', case when v_tudo
      then (select jsonb_object_agg(k, true) from jsonb_object_keys(private.permissoes_padrao()) k)
      else private.permissoes_limpas(p.permissoes) end,
    'convite_pendente', exists (select 1 from private.convites where email = v_email and estado = 'pendente')
  );
end;
$$;

-- ---------- equipe: lista com as permissões de cada pessoa ----------
create or replace function public.equipe_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := private.minha_empresa();
  v_uid uuid := (select auth.uid());
  v_dono boolean := private.sou_dono();
  v_ve boolean := private.pode('ver_equipe');
begin
  if v_emp is null or not private.conta_ativa() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'membros', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', u.email, 'papel', p.papel, 'ultimo_acesso', u.last_sign_in_at,
        'permissoes', case when v_dono and p.papel <> 'dono' then private.permissoes_limpas(p.permissoes) else null end)
        order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
      from public.profiles p join auth.users u on u.id = p.id
      -- sem a permissão de ver a equipe, a pessoa só recebe a própria linha
      where p.empresa_id = v_emp and p.status = 'ativa' and (v_ve or p.id = v_uid)),
    'convites', case when v_dono then (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'criado_em', c.criado_em,
        'permissoes', private.permissoes_limpas(c.permissoes))
        order by c.criado_em), '[]'::jsonb)
      from private.convites c where c.empresa_id = v_emp and c.estado = 'pendente') else '[]'::jsonb end,
    'pode_gerenciar', v_dono,
    'padrao', private.permissoes_padrao()
  );
end;
$$;

-- autorizar um e-mail já com as permissões marcadas
create function public.equipe_autorizar(p_email text, p_permissoes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- as conferências (responsável, limite, e-mail repetido) são as mesmas de equipe_convidar
  perform public.equipe_convidar(p_email);
  update private.convites set permissoes = private.permissoes_limpas(p_permissoes)
   where email = lower(btrim(p_email)) and empresa_id = private.minha_empresa() and estado = 'pendente';
end;
$$;

-- mudar as permissões de um colaborador ou de um e-mail autorizado que ainda não se cadastrou
create function public.equipe_permissoes(p_permissoes jsonb, p_usuario uuid default null, p_convite uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := private.minha_empresa();
begin
  if v_emp is null or not private.conta_ativa() or not private.sou_dono() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_usuario is not null then
    update public.profiles set permissoes = private.permissoes_limpas(p_permissoes)
     where id = p_usuario and empresa_id = v_emp and papel <> 'dono' and status = 'ativa';
  elsif p_convite is not null then
    update private.convites set permissoes = private.permissoes_limpas(p_permissoes)
     where id = p_convite and empresa_id = v_emp and estado = 'pendente';
  else
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  if not found then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.equipe_autorizar(text, jsonb) from public, anon;
revoke all on function public.equipe_permissoes(jsonb, uuid, uuid) from public, anon;
grant execute on function public.equipe_autorizar(text, jsonb) to authenticated;
grant execute on function public.equipe_permissoes(jsonb, uuid, uuid) to authenticated;
-- o site passa a usar equipe_autorizar; a função antiga fica só para uso interno
revoke execute on function public.equipe_convidar(text) from authenticated;

-- =====================================================================
-- 20261015160000_busca_receita.sql
-- =====================================================================
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

-- =====================================================================
-- 20261022190000_kanban_responsavel.sql
-- =====================================================================
-- Fase A do PLANO-CRM (Kanban): responsável pelo contato e data em que virou cliente.
-- - prospects.responsavel: pessoa da equipe que cuida do contato. Começa em quem cadastrou.
--   Só o responsável da empresa (papel dono) ou o admin em modo simular troca. Vale no banco (gatilho).
-- - prospects.cliente_desde: preenchida pelo banco quando o status vira "cliente" (Fechado);
--   limpa quando sai de "cliente". A tela não grava esse campo (edição fica para a Fase F).
-- - Colaborador sem ver_todos passa a ver, editar e excluir os contatos que cadastrou OU dos quais é responsável.

alter table public.prospects
  add column if not exists responsavel uuid references auth.users(id) on delete set null,
  add column if not exists cliente_desde date;

create index if not exists prospects_responsavel_idx on public.prospects (responsavel);

-- contatos que já existiam: responsável = quem cadastrou; os já fechados recebem a data mais próxima que houver
update public.prospects set responsavel = user_id where responsavel is null and user_id is not null;
update public.prospects set cliente_desde = coalesce(ultimo_contato, (atualizado_em at time zone 'America/Sao_Paulo')::date)
  where status = 'cliente' and cliente_desde is null;

create or replace function private.regras_prospect() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_eu uuid := (select auth.uid());
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- responsável
  if tg_op = 'INSERT' then
    if v_eu is not null and not private.sou_dono() then
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
revoke all on function private.regras_prospect() from public;

-- roda depois de antes_inserir_prospect (ordem alfabética), que já gravou user_id
create trigger antes_salvar_regras_prospect before insert or update on public.prospects
  for each row execute function private.regras_prospect();

alter policy "contatos: ver os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa())
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid()) or responsavel = (select auth.uid())));
alter policy "contatos: editar os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()) and (select private.pode('editar'))
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid()) or responsavel = (select auth.uid())));
alter policy "contatos: excluir os da empresa" on public.prospects
  using (empresa_id = (select private.minha_empresa()) and (select private.conta_ativa()) and (select private.pode('excluir'))
         and ((select private.pode('ver_todos')) or user_id = (select auth.uid()) or responsavel = (select auth.uid())));

-- backup: inclui responsável e cliente desde
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
          'cliente_desde', x.cliente_desde)
          order by x.criado_em), '[]'::jsonb)
        from public.prospects x where x.empresa_id = e.id)
    ) order by lower(e.nome)), '[]'::jsonb)
    from public.empresas e
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
  );
end;
$$;

-- =====================================================================
-- 20261022200000_excluir_lote.sql
-- =====================================================================
-- Fase B do PLANO-CRM: excluir contatos em lote, com registro na auditoria.
-- A exclusão roda com o login de quem chamou (security invoker): valem as regras da tabela
-- (permissão excluir, empresa ativa, sem ver_todos só os que cadastrou ou dos quais é responsável).
-- Contatos que a pessoa não alcança são simplesmente pulados e não entram na contagem.
-- Cada chamada grava uma linha em private.auditoria: quem (admin_id), empresa, acao 'excluir_lote' e
-- a contagem no detalhe. Os dados excluídos não são guardados.

create or replace function private.registrar_exclusao(p_excluidos int, p_pedidos int) returns void
language sql security definer set search_path = '' as $$
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'excluir_lote', private.minha_empresa(),
          'excluidos=' || p_excluidos || '; pedidos=' || p_pedidos);
$$;
revoke all on function private.registrar_exclusao(int, int) from public;
grant execute on function private.registrar_exclusao(int, int) to authenticated;

create or replace function public.prospects_excluir_lote(p_ids uuid[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_pedidos int := coalesce(array_length(p_ids, 1), 0);
  v_excluidos int;
begin
  if not (private.conta_ativa() and private.pode('excluir')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_pedidos > 10000 then
    raise exception 'lista grande demais' using errcode = '22023';
  end if;
  delete from public.prospects x where x.id = any (p_ids);
  get diagnostics v_excluidos = row_count;
  if v_excluidos > 0 then
    perform private.registrar_exclusao(v_excluidos, v_pedidos);
  end if;
  return jsonb_build_object('excluidos', v_excluidos, 'pulados', v_pedidos - v_excluidos);
end;
$$;
revoke all on function public.prospects_excluir_lote(uuid[]) from public, anon;
grant execute on function public.prospects_excluir_lote(uuid[]) to authenticated;

-- =====================================================================
-- 20261022210000_exportacao_travada.sql
-- =====================================================================
-- Fase D do PLANO-CRM: exportação de contatos travada; só o administrador geral libera, por empresa.
-- - empresas.exportacao_liberada (começa desligada) e empresas.exportacao_ate (nula = sem prazo).
--   Vale como liberada só se exportacao_liberada e (exportacao_ate nula ou no futuro).
-- - admin_exportacao(alvo, modo): 'liberar', 'liberar_24h' ou 'bloquear'. Grava na auditoria.
-- - exportar_contatos(): confere liberação e permissão (responsável ou "exportar") e devolve os contatos
--   que a pessoa enxerga (roda com o login dela, valem as regras da tabela). Grava cada exportação na auditoria.
--   O admin em modo simular segue a regra da empresa simulada; o backup geral continua em admin_exportar.
-- - minha_sessao e admin_empresas passam a informar a situação da exportação.

alter table public.empresas
  add column if not exists exportacao_liberada boolean not null default false,
  add column if not exists exportacao_ate timestamptz;

create or replace function private.exportacao_ok(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.exportacao_liberada and (e.exportacao_ate is null or e.exportacao_ate > now())
                   from public.empresas e where e.id = p_empresa), false);
$$;
revoke all on function private.exportacao_ok(uuid) from public;
grant execute on function private.exportacao_ok(uuid) to authenticated;

-- nomes da equipe da própria empresa, para as colunas "Cadastrado por" e "Responsável" da planilha
create or replace function private.nomes_da_empresa() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(p.id, coalesce(nullif(p.nome, ''), u.email)), '{}'::jsonb)
  from public.profiles p join auth.users u on u.id = p.id
  where p.empresa_id = private.minha_empresa();
$$;
revoke all on function private.nomes_da_empresa() from public;
grant execute on function private.nomes_da_empresa() to authenticated;

create or replace function private.registrar_exportacao(p_qtd int) returns void
language sql security definer set search_path = '' as $$
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'exportar_contatos', private.minha_empresa(), 'contatos=' || p_qtd);
$$;
revoke all on function private.registrar_exportacao(int) from public;
grant execute on function private.registrar_exportacao(int) to authenticated;

create or replace function public.exportar_contatos() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_nomes jsonb;
  v_linhas jsonb;
begin
  if not (private.conta_ativa() and private.pode('exportar')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if not private.exportacao_ok(private.minha_empresa()) then
    raise exception 'exportacao_bloqueada' using errcode = '42501';
  end if;
  v_nomes := private.nomes_da_empresa();
  select coalesce(jsonb_agg(jsonb_build_object(
      'empresa', x.empresa, 'contato', x.contato, 'cargo', x.cargo, 'telefone', x.telefone, 'email', x.email,
      'cidade', x.cidade, 'uf', x.uf, 'segmento', x.segmento, 'porte', x.porte, 'origem', x.origem,
      'link', x.link, 'interesse', x.interesse, 'status', x.status,
      'ultimo_contato', x.ultimo_contato, 'proximo_contato', x.proximo_contato,
      'observacoes', x.observacoes, 'historico', x.historico,
      'cadastrado_por', v_nomes ->> x.user_id::text, 'responsavel', v_nomes ->> x.responsavel::text,
      'cliente_desde', x.cliente_desde, 'cnpj', x.cnpj, 'criado_em', x.criado_em)
      order by x.criado_em desc), '[]'::jsonb)
    into v_linhas
  from public.prospects x
  where x.empresa_id = private.minha_empresa();
  perform private.registrar_exportacao(jsonb_array_length(v_linhas));
  return v_linhas;
end;
$$;
revoke all on function public.exportar_contatos() from public, anon;
grant execute on function public.exportar_contatos() to authenticated;

create or replace function public.admin_exportacao(alvo uuid, modo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ate timestamptz;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if modo not in ('liberar', 'liberar_24h', 'bloquear') then
    raise exception 'modo_invalido' using errcode = '22023';
  end if;
  v_ate := case when modo = 'liberar_24h' then now() + interval '24 hours' end;
  update public.empresas
     set exportacao_liberada = modo <> 'bloquear', exportacao_ate = v_ate
   where id = alvo;
  if not found then
    raise exception 'nao_encontrada' using errcode = 'P0002';
  end if;
  insert into private.auditoria (admin_id, acao, empresa_id, detalhe)
  values ((select auth.uid()), 'exportacao', alvo, modo || coalesce(' até ' || to_char(v_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), ''));
  return jsonb_build_object('liberada', modo <> 'bloquear', 'ate', v_ate);
end;
$$;
revoke all on function public.admin_exportacao(uuid, text) from public, anon;
grant execute on function public.admin_exportacao(uuid, text) to authenticated;

-- igual à versão anterior; a empresa passa a trazer exportacao_liberada (já considerando o prazo) e exportacao_ate
create or replace function public.minha_sessao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
  e public.empresas;
  c private.convites;
  v_email text;
  v_confirmado boolean;
  v_antiga uuid;
  v_nova uuid;
  v_ef uuid;
  v_sim boolean := false;
  v_tudo boolean;
begin
  if v_uid is null then
    raise exception 'sem login' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('usuario', null, 'empresa', null, 'simulando', false);
  end if;
  select lower(u.email), u.email_confirmed_at is not null into v_email, v_confirmado
  from auth.users u where u.id = v_uid;

  if v_confirmado and not p.is_admin then
    select * into c from private.convites where email = v_email and estado = 'pendente';
    if found then
      if p.empresa_id is not distinct from c.empresa_id then
        update private.convites set estado = 'aceito' where id = c.id;
        if p.papel <> 'dono' then
          update public.profiles set permissoes = private.permissoes_limpas(c.permissoes) where id = v_uid;
          select * into p from public.profiles where id = v_uid;
        end if;
      else
        v_antiga := p.empresa_id;
        -- só troca de empresa quem está sozinho em uma empresa sem contatos
        if v_antiga is null or (
             not exists (select 1 from public.profiles o where o.empresa_id = v_antiga and o.id <> v_uid)
             and not exists (select 1 from public.prospects x where x.empresa_id = v_antiga)
           ) then
          update public.profiles
             set empresa_id = c.empresa_id, papel = 'membro', status = 'ativa',
                 permissoes = private.permissoes_limpas(c.permissoes)
           where id = v_uid;
          update private.convites set estado = 'aceito' where id = c.id;
          -- a empresa antiga fica vazia e deixa de aparecer no painel admin
          select * into p from public.profiles where id = v_uid;
        end if;
      end if;
    end if;
  end if;

  -- conta ativa sem empresa e sem convite (ex.: convite cancelado antes do primeiro acesso)
  if p.empresa_id is null and p.status = 'ativa'
     and not exists (select 1 from private.convites where email = v_email and estado = 'pendente') then
    insert into public.empresas (nome) values (private.nome_empresa_padrao(p.empresa, p.nome))
    returning id into v_nova;
    update public.profiles set empresa_id = v_nova, papel = 'dono' where id = v_uid;
    select * into p from public.profiles where id = v_uid;
  end if;

  v_ef := p.empresa_id;
  if p.is_admin and p.status = 'ativa' and p.simulando is not null then
    v_ef := p.simulando;
    v_sim := true;
  end if;
  select * into e from public.empresas where id = v_ef;
  v_tudo := v_sim or p.papel = 'dono';

  return jsonb_build_object(
    'usuario', jsonb_build_object(
      'id', p.id, 'nome', p.nome, 'email', v_email,
      'papel', case when v_sim then 'dono' else p.papel end,
      'is_admin', p.is_admin and p.status = 'ativa',
      'status', p.status),
    'empresa', case when e.id is null then null
      else jsonb_build_object('id', e.id, 'nome', e.nome, 'status', e.status,
        'exportacao_liberada', private.exportacao_ok(e.id), 'exportacao_ate', e.exportacao_ate) end,
    'simulando', v_sim,
    'permissoes', case when v_tudo
      then (select jsonb_object_agg(k, true) from jsonb_object_keys(private.permissoes_padrao()) k)
      else private.permissoes_limpas(p.permissoes) end,
    'convite_pendente', exists (select 1 from private.convites where email = v_email and estado = 'pendente')
  );
end;
$$;

-- igual à versão anterior, mais a situação da exportação de cada empresa
create or replace function public.admin_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_minha uuid;
begin
  if not private.is_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select p.empresa_id into v_minha from public.profiles p where p.id = (select auth.uid());
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'status', e.status,
      'criado_em', e.criado_em, 'liberado_em', e.liberado_em,
      'propria', e.id = v_minha,
      'completo', private.empresa_completa(e),
      'razao_social', e.razao_social, 'documento', e.documento, 'segmento', e.segmento,
      'telefone', e.telefone, 'email', e.email, 'site', e.site, 'instagram', e.instagram,
      'cidade', e.cidade, 'uf', e.uf,
      'exportacao_liberada', e.exportacao_liberada, 'exportacao_ate', e.exportacao_ate,
      'exportacao_ok', private.exportacao_ok(e.id),
      'contatos', (select count(*) from public.prospects x where x.empresa_id = e.id),
      'convites', (select count(*) from private.convites c where c.empresa_id = e.id and c.estado = 'pendente'),
      'ultimo_acesso', (select max(u.last_sign_in_at) from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id),
      'membros', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'nome', p.nome, 'email', u.email, 'papel', p.papel, 'is_admin', p.is_admin,
          'email_confirmado', u.email_confirmed_at is not null, 'ultimo_acesso', u.last_sign_in_at)
          order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
        from public.profiles p join auth.users u on u.id = p.id where p.empresa_id = e.id)
    ) order by e.criado_em desc), '[]'::jsonb)
    from public.empresas e
    -- empresa vazia (sem usuários, contatos nem convite pendente) não aparece
    where exists (select 1 from public.profiles p where p.empresa_id = e.id)
       or exists (select 1 from public.prospects x where x.empresa_id = e.id)
       or exists (select 1 from private.convites c where c.empresa_id = e.id and c.estado = 'pendente')
  );
end;
$$;

-- =====================================================================
-- 20261022220000_importacao_aprovada.sql
-- =====================================================================
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

-- =====================================================================
-- 20261022230000_clientes.sql
-- =====================================================================
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

commit;
