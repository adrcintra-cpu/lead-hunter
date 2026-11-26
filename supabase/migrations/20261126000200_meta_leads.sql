-- Meta Leads: leads dos formulários de anúncio (Facebook/Instagram) via API oficial da Meta.
-- Tokens ficam cifrados em meta_page_tokens (só o servidor lê). O resto é lido pela equipe (current_owner()).

create table if not exists public.meta_pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  page_name text,
  instagram_username text,
  status text not null default 'conectado' check (status in ('conectado','desconectado','erro')),
  scopes text[] not null default '{}',
  subscribed boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  unique (owner_id, page_id)
);

create table if not exists public.meta_page_tokens (
  page_ref uuid primary key references public.meta_pages(id) on delete cascade,
  token_enc text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_lead_forms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  page_ref uuid not null references public.meta_pages(id) on delete cascade,
  form_id text not null,
  name text,
  status text,
  leads_count integer,
  created_time timestamptz,
  last_import_at timestamptz,
  unique (owner_id, form_id)
);

create table if not exists public.meta_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  meta_lead_id text not null,
  page_ref uuid references public.meta_pages(id) on delete set null,
  form_id text,
  form_name text,
  ad_id text,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  platform text,
  is_organic boolean,
  created_time timestamptz,
  field_data jsonb not null default '[]'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  lead_id uuid references public.leads(id) on delete set null,
  imported_via text not null default 'webhook' check (imported_via in ('webhook','importacao')),
  enrolled_at timestamptz,
  skip_reason text,
  created_at timestamptz not null default now(),
  unique (owner_id, meta_lead_id)
);
create index if not exists meta_leads_owner_time on public.meta_leads (owner_id, created_time desc);
create index if not exists meta_leads_lead on public.meta_leads (lead_id);

create table if not exists public.meta_sync_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  status text not null check (status in ('ok','erro','ignorado')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists meta_sync_logs_owner on public.meta_sync_logs (owner_id, created_at desc);

create table if not exists public.meta_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  auto_first_contact boolean not null default true,
  campaign_id uuid references public.campaigns(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.meta_pages enable row level security;
alter table public.meta_page_tokens enable row level security;
alter table public.meta_lead_forms enable row level security;
alter table public.meta_leads enable row level security;
alter table public.meta_sync_logs enable row level security;
alter table public.meta_settings enable row level security;

create policy "equipe: ler" on public.meta_pages for select to authenticated using (owner_id = (select current_owner()));
create policy "equipe: ler" on public.meta_lead_forms for select to authenticated using (owner_id = (select current_owner()));
create policy "equipe: ler" on public.meta_leads for select to authenticated using (owner_id = (select current_owner()));
create policy "equipe: ler" on public.meta_sync_logs for select to authenticated using (owner_id = (select current_owner()));
create policy "equipe: ler" on public.meta_settings for select to authenticated using (owner_id = (select current_owner()));
create policy "equipe: admin cria" on public.meta_settings for insert to authenticated with check (owner_id = (select current_owner()) and (select is_admin()));
create policy "equipe: admin altera" on public.meta_settings for update to authenticated using (owner_id = (select current_owner()) and (select is_admin())) with check (owner_id = (select current_owner()));
-- meta_page_tokens: sem políticas (só o servidor, com service role)
revoke all on public.meta_page_tokens from anon, authenticated;
create index if not exists meta_leads_page on public.meta_leads (page_ref);
create index if not exists meta_lead_forms_page on public.meta_lead_forms (page_ref);
create index if not exists meta_settings_campaign on public.meta_settings (campaign_id);
