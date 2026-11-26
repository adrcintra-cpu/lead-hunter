-- Chat do Beelie no site do Oxyhub: conversas de visitantes (sem login).
-- Escrita só pelo servidor (função site-chat, service role); o dono lê as conversas dele.
create table if not exists public.site_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null unique,
  ip_hash text,
  topic text,
  messages jsonb not null default '[]'::jsonb,
  user_messages int not null default 0,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_chats_ip_day on public.site_chats (ip_hash, created_at desc);
create index if not exists site_chats_owner on public.site_chats (owner_id, created_at desc);
create index if not exists site_chats_lead on public.site_chats (lead_id);

alter table public.site_chats enable row level security;
drop policy if exists site_chats_owner_read on public.site_chats;
create policy site_chats_owner_read on public.site_chats for select to authenticated using (owner_id = (select auth.uid()));
