-- Fase F do PLANO-CRM, parte 2 (F-2): data do cancelamento, para o painel de clientes contar "cancelamentos do mês".
-- - clientes.cancelado_em: o banco grava a data de hoje (Brasília) quando a ficha vira "cancelado" e limpa quando
--   sai de "cancelado". O que a tela mandar é ignorado.
-- - exportar_clientes e admin_exportar passam a levar a data do cancelamento.
-- O Kanban e o painel de clientes são só tela (js/clientes.js): os números são calculados no navegador
-- com as fichas que a pessoa enxerga.

alter table public.clientes add column if not exists cancelado_em date;
comment on column public.clientes.cancelado_em is 'Data em que a ficha virou cancelado (gravada pelo banco).';

-- fichas já canceladas: a data mais próxima que houver
update public.clientes set cancelado_em = (atualizado_em at time zone 'America/Sao_Paulo')::date
 where situacao = 'cancelado' and cancelado_em is null;

-- igual à versão anterior, mais a data do cancelamento
create or replace function private.tocar_cliente() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.prospect_id := old.prospect_id;
  new.empresa_id := old.empresa_id;
  new.criado_em := old.criado_em;
  new.atualizado_em := now();
  if new.situacao = 'cancelado' then
    new.cancelado_em := case when old.situacao = 'cancelado' then old.cancelado_em
                             else (now() at time zone 'America/Sao_Paulo')::date end;
  else
    new.cancelado_em := null;
  end if;
  return new;
end;
$$;

-- igual à versão anterior, mais cancelado_em
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
      'motivo_cancelamento', c.motivo_cancelamento, 'cancelado_em', c.cancelado_em, 'proxima_acao', c.proxima_acao,
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

-- igual à versão anterior, mais cliente_cancelado_em
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
          'cliente_renovacao', c.renovacao, 'cliente_motivo_cancelamento', c.motivo_cancelamento, 'cliente_cancelado_em', c.cancelado_em,
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
