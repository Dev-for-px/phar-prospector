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
