-- Lead Hunter — schema inicial
-- Todas as tabelas privadas por usuário (owner_id = auth.uid()) com RLS.

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type lead_stage as enum ('novo','qualificado','contato_preparado','contatado','respondeu','reuniao','proposta','cliente','descartado');
create type whatsapp_status as enum ('confirmado','provavel','desconhecido');
create type score_tier as enum ('alta','media','baixa');
create type search_status as enum ('draft','running','done','error');
create type message_channel as enum ('whatsapp','email','linkedin');
create type message_status as enum ('draft','copied','opened_whatsapp');
create type activity_type as enum ('discovered','scored','analyzed','stage_changed','message_generated','message_copied','whatsapp_opened','note_added','list_added','list_removed');
create type suppression_kind as enum ('phone','email','cnpj');

-- ---------- updated_at ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Tabelas ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  company_name text not null default '',
  offer text not null default '',
  icp_segments text[] not null default '{}',
  icp_regions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  legal_name text not null,
  trade_name text,
  cnpj text,
  segment text not null,
  city text not null,
  state char(2) not null,
  address text,
  lat double precision,
  lng double precision,
  website text,
  phone text,
  whatsapp text,
  whatsapp_status whatsapp_status not null default 'desconhecido',
  instagram text,
  linkedin text,
  employees_range text,
  employees_min int,
  field_provenance jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, dedupe_key)
);

create table searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  raw_query text not null,
  parsed_criteria jsonb not null,
  confirmed_criteria jsonb,
  status search_status not null default 'draft',
  providers_used text[] not null default '{}',
  ignored_criteria text[] not null default '{}',
  result_count int not null default 0,
  new_count int not null default 0,
  duplicates_removed int not null default 0,
  saved_search_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  stage lead_stage not null default 'novo',
  current_score int not null default 0 check (current_score between 0 and 100),
  score_tier score_tier not null default 'baixa',
  first_search_id uuid references searches(id) on delete set null,
  origin text not null,
  discovered_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, company_id)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text,
  role text,
  email text,
  phone text,
  source text not null,
  legal_basis text not null default 'legitimo_interesse',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  search_id uuid references searches(id) on delete set null,
  provider text not null,
  external_id text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz -- respeita termos de cache dos providers (ex.: Google Places)
);

create table lead_scores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  score int not null check (score between 0 and 100),
  tier score_tier not null,
  rule_score int not null,
  ai_adjustment int not null check (ai_adjustment between -15 and 15),
  breakdown jsonb not null,
  justification text not null,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table company_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  sections jsonb not null, -- cada item: { text, kind: fact|inference|unavailable, evidenceField }
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  body text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  type activity_type not null,
  description text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_lists (
  list_id uuid not null references lists(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  raw_query text not null,
  criteria jsonb not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table searches add constraint searches_saved_fk foreign key (saved_search_id) references saved_searches(id) on delete set null;

create table search_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  search_id uuid not null references searches(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  rank int not null,
  provider text not null,
  was_duplicate boolean not null default false
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel message_channel not null,
  generated_content text not null,
  final_content text not null,
  status message_status not null default 'draft',
  model text not null,
  prompt_version text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind suppression_kind not null,
  value text not null,
  reason text not null default 'Opt-out',
  created_at timestamptz not null default now(),
  unique (owner_id, kind, value)
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fn text not null,
  model text not null,
  prompt_version text not null,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  status text not null check (status in ('ok','error')),
  created_at timestamptz not null default now()
);

-- ---------- Índices ----------
create index on leads (owner_id, stage);
create index on leads (owner_id, current_score desc);
create index on companies (owner_id, city);
create index on companies (owner_id, segment);
create index on lead_activities (lead_id, created_at desc);
create index on lead_scores (lead_id, created_at desc);
create index on search_results (search_id, rank);
create index on messages (lead_id, created_at desc);

-- ---------- Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','companies','searches','leads','contacts','lead_notes','lists','saved_searches','messages']
  loop
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Mudança de etapa sempre vira atividade, por qualquer caminho.
create or replace function log_stage_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    insert into lead_activities (owner_id, lead_id, type, description, payload, actor_id)
    values (new.owner_id, new.id, 'stage_changed', 'Etapa alterada',
            jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());
    new.last_activity_at = now();
  end if;
  return new;
end $$;
create trigger trg_leads_stage before update of stage on leads for each row execute function log_stage_change();

-- Perfil criado junto com o usuário.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- RLS ----------
alter table profiles enable row level security;
create policy "perfil próprio: ler" on profiles for select using (id = auth.uid());
create policy "perfil próprio: editar" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  -- Tabelas com CRUD completo do dono.
  foreach t in array array['companies','searches','leads','contacts','lead_sources','company_analyses','lead_notes','lists','lead_lists','saved_searches','search_results','messages','suppression_list','lead_scores']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "dono: ler" on %I for select using (owner_id = auth.uid())', t);
    execute format('create policy "dono: inserir" on %I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "dono: alterar" on %I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "dono: excluir" on %I for delete using (owner_id = auth.uid())', t);
  end loop;

  -- Auditoria: somente leitura e inserção. Sem update/delete.
  foreach t in array array['lead_activities','ai_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "dono: ler" on %I for select using (owner_id = auth.uid())', t);
    execute format('create policy "dono: inserir" on %I for insert with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Vínculos só entre registros do mesmo dono.
create policy "lista e lead do mesmo dono" on lead_lists as restrictive for insert
  with check (
    exists (select 1 from lists l where l.id = list_id and l.owner_id = auth.uid())
    and exists (select 1 from leads d where d.id = lead_id and d.owner_id = auth.uid())
  );
