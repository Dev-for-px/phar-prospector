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
