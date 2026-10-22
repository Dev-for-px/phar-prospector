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
