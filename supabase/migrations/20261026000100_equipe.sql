-- Lead Hunter — equipe: outras pessoas usam a mesma conta, com papéis.
-- Incremental: não apaga tabelas, colunas nem dados. As políticas "dono: ..." continuam como estão;
-- as novas políticas "equipe: ..." só ACRESCENTAM acesso para quem foi convidado.
--
-- Papéis: admin (tudo, inclusive Configurações, WhatsApp e equipe), vendedor (leads, buscas, campanhas,
-- tarefas e mensagens; sem Configurações), leitura (só vê). O dono da conta é sempre admin.
-- Todos da equipe veem os mesmos dados (os da conta do dono).

create table if not exists team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'vendedor' check (role in ('admin', 'vendedor', 'leitura')),
  name text,
  email text,
  created_at timestamptz not null default now(),
  check (user_id <> owner_id)
);
create index if not exists team_members_owner on team_members (owner_id);

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'vendedor' check (role in ('admin', 'vendedor', 'leitura')),
  name text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (owner_id, email)
);

-- Conta em uso (a do dono, para quem é da equipe) e papel de quem está logado.
create or replace function public.current_owner() returns uuid
  language sql stable security definer set search_path = public as $$
  select coalesce((select owner_id from team_members where user_id = auth.uid()), auth.uid())
$$;
create or replace function public.team_role() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select role from team_members where user_id = auth.uid()), 'admin')
$$;
create or replace function public.can_write() returns boolean
  language sql stable security definer set search_path = public as $$ select public.team_role() <> 'leitura' $$;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$ select public.team_role() = 'admin' $$;

-- Aceita o convite feito para o e-mail de quem acabou de entrar (chamado pelo site após o login).
create or replace function public.accept_invite() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  inv team_invites;
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or mail = '' then return null; end if;
  if exists (select 1 from team_members where user_id = auth.uid()) then
    return (select jsonb_build_object('owner_id', owner_id, 'role', role) from team_members where user_id = auth.uid());
  end if;
  select * into inv from team_invites where lower(email) = mail and accepted_at is null and owner_id <> auth.uid()
    order by created_at desc limit 1;
  if inv.id is null then return null; end if;
  insert into team_members (user_id, owner_id, role, name, email) values (auth.uid(), inv.owner_id, inv.role, inv.name, mail);
  update team_invites set accepted_at = now() where id = inv.id;
  return jsonb_build_object('owner_id', inv.owner_id, 'role', inv.role);
end $$;

alter table team_members enable row level security;
alter table team_invites enable row level security;
create policy "equipe: ler membros" on team_members for select using (user_id = auth.uid() or owner_id = (select public.current_owner()));
create policy "equipe: admin altera membros" on team_members for update using (owner_id = (select public.current_owner()) and (select public.is_admin())) with check (owner_id = (select public.current_owner()));
create policy "equipe: admin remove membros" on team_members for delete using (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: ler convites" on team_invites for select using (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: admin convida" on team_invites for insert with check (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: admin altera convite" on team_invites for update using (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: admin apaga convite" on team_invites for delete using (owner_id = (select public.current_owner()) and (select public.is_admin()));

-- Tabelas da conta: a equipe lê; admin e vendedor gravam. Novos registros ficam na conta do dono.
do $$
declare t text;
begin
  foreach t in array array['companies','searches','leads','contacts','lead_sources','company_analyses','lead_notes','lists','lead_lists','saved_searches','search_results','messages','suppression_list','lead_scores','campaigns','cadences','enrollments','tasks','inbound_messages']
  loop
    execute format('create policy "equipe: ler" on %I for select using (owner_id = (select public.current_owner()))', t);
    execute format('create policy "equipe: inserir" on %I for insert with check (owner_id = (select public.current_owner()) and (select public.can_write()))', t);
    execute format('create policy "equipe: alterar" on %I for update using (owner_id = (select public.current_owner()) and (select public.can_write())) with check (owner_id = (select public.current_owner()))', t);
    if t <> 'inbound_messages' then
      execute format('create policy "equipe: excluir" on %I for delete using (owner_id = (select public.current_owner()) and (select public.can_write()))', t);
    end if;
    execute format('alter table %I alter column owner_id set default public.current_owner()', t);
  end loop;
  -- Histórico e auditoria: só ler e acrescentar.
  foreach t in array array['lead_activities','ai_runs']
  loop
    execute format('create policy "equipe: ler" on %I for select using (owner_id = (select public.current_owner()))', t);
    execute format('create policy "equipe: inserir" on %I for insert with check (owner_id = (select public.current_owner()))', t);
    execute format('alter table %I alter column owner_id set default public.current_owner()', t);
  end loop;
end $$;

-- Configurações da conta: a equipe lê; só admin altera.
create policy "equipe: ler" on profiles for select using (id = (select public.current_owner()));
create policy "equipe: admin edita" on profiles for update using (id = (select public.current_owner()) and (select public.is_admin())) with check (id = (select public.current_owner()));
create policy "equipe: ler" on assistant_settings for select using (owner_id = (select public.current_owner()));
create policy "equipe: admin altera" on assistant_settings for update using (owner_id = (select public.current_owner()) and (select public.is_admin())) with check (owner_id = (select public.current_owner()));
create policy "equipe: admin cria" on assistant_settings for insert with check (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: ler" on whatsapp_connections for select using (user_id = (select public.current_owner()));

-- As duas regras "do mesmo dono" (restritivas) passam a valer para a conta do dono, não só para quem está logado.
drop policy if exists "campanha e lead do mesmo dono" on enrollments;
create policy "campanha e lead do mesmo dono" on enrollments as restrictive for insert
  with check (
    exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = (select public.current_owner()))
    and exists (select 1 from leads d where d.id = lead_id and d.owner_id = (select public.current_owner()))
  );
drop policy if exists "lista e lead do mesmo dono" on lead_lists;
create policy "lista e lead do mesmo dono" on lead_lists as restrictive for insert
  with check (
    exists (select 1 from lists l where l.id = list_id and l.owner_id = (select public.current_owner()))
    and exists (select 1 from leads d where d.id = lead_id and d.owner_id = (select public.current_owner()))
  );

grant execute on function public.current_owner(), public.team_role(), public.can_write(), public.is_admin(), public.accept_invite() to authenticated;
