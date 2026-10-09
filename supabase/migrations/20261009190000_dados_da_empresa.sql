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
