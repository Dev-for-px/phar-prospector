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
