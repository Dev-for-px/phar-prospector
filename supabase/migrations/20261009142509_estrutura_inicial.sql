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
