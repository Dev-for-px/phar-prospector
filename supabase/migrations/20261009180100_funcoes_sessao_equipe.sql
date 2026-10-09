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
