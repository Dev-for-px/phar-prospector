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
