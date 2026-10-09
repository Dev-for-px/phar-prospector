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
