-- Lead Hunter — Automação (parte 2/2): CRM, campanhas, cadências, envios, respostas e tarefas.
-- Nada aqui apaga dados: só adiciona colunas/tabelas e migra as etapas antigas.

-- ---------- Pipeline ----------
update leads set stage = 'qualificado' where stage = 'contato_preparado';
update leads set stage = 'nao_interessado' where stage = 'descartado';

create or replace function stage_label(s lead_stage) returns text language sql immutable as $$
  select case s
    when 'novo' then 'Novo'
    when 'qualificado' then 'Qualificado'
    when 'em_cadencia' then 'Em cadência'
    when 'contatado' then 'Contatado'
    when 'respondeu' then 'Respondeu'
    when 'interessado' then 'Interessado'
    when 'reuniao' then 'Reunião'
    when 'proposta' then 'Proposta'
    when 'cliente' then 'Cliente'
    when 'nao_interessado' then 'Não interessado'
    when 'sem_resposta' then 'Sem resposta'
    when 'contato_preparado' then 'Contato preparado'
    when 'descartado' then 'Descartado'
  end
$$;

-- ---------- CRM no lead ----------
alter table leads
  add column if not exists contact_name text,
  add column if not exists contact_role text,
  add column if not exists email text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists owner_name text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists last_contact_at timestamptz,
  -- Consentimento (opt-in) para WhatsApp: sem ele não há envio automático.
  add column if not exists whatsapp_consent_at timestamptz,
  add column if not exists whatsapp_consent_source text;

create index if not exists leads_owner_email_idx on leads (owner_id, lower(email)) where email is not null;

-- ---------- Remetente ----------
alter table profiles
  add column if not exists sender_email text,
  add column if not exists signature text,
  add column if not exists send_window jsonb;

-- ---------- Cadências ----------
create table if not exists cadences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  stop_on_reply boolean not null default true,
  -- Lista de passos (send/wait/condition/task/stage). Formato em _shared/automation/types.ts.
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Campanhas ----------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  objective text not null default '',
  audience jsonb not null default '{}'::jsonb,
  channel text not null default 'multicanal' check (channel in ('whatsapp','email','multicanal')),
  cadence_id uuid references cadences(id) on delete restrict,
  owner_name text,
  status text not null default 'rascunho' check (status in ('rascunho','agendada','ativa','pausada','finalizada')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Lead dentro de uma campanha ----------
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  cadence_id uuid not null references cadences(id) on delete restrict,
  lead_id uuid not null references leads(id) on delete cascade,
  step_index int not null default 0,
  status text not null default 'pendente' check (status in ('pendente','ativa','pausada','concluida','interrompida')),
  next_run_at timestamptz,
  started_at timestamptz,
  last_step_at timestamptz,
  stop_reason text,
  -- Mensagem preparada e revisada antes de ativar (canal, assunto, texto, contexto, modelo).
  draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index if not exists enrollments_due_idx on enrollments (next_run_at) where status = 'ativa';
create index if not exists enrollments_lead_idx on enrollments (lead_id);

-- ---------- Mensagens enviadas ----------
alter table messages
  add column if not exists campaign_id uuid references campaigns(id) on delete set null,
  add column if not exists enrollment_id uuid references enrollments(id) on delete set null,
  add column if not exists step_index int,
  add column if not exists subject text,
  add column if not exists sender text,
  add column if not exists recipient text,
  add column if not exists template text,
  add column if not exists context jsonb,
  add column if not exists provider text,
  add column if not exists external_id text,
  add column if not exists sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text;
create index if not exists messages_external_idx on messages (provider, external_id) where external_id is not null;
create index if not exists messages_campaign_idx on messages (campaign_id) where campaign_id is not null;

-- ---------- Respostas recebidas ----------
create table if not exists inbound_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel message_channel not null,
  from_address text not null,
  body text not null,
  received_at timestamptz not null default now(),
  external_id text,
  campaign_id uuid references campaigns(id) on delete set null,
  enrollment_id uuid references enrollments(id) on delete set null,
  classification text check (classification in ('interessado','reuniao','duvida','nao_interessado','opt_out','ausente','outro')),
  confidence real,
  summary text
);
create index if not exists inbound_lead_idx on inbound_messages (lead_id, received_at desc);
create unique index if not exists inbound_external_idx on inbound_messages (owner_id, channel, external_id) where external_id is not null;

-- ---------- Tarefas humanas ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  title text not null,
  description text,
  owner_name text,
  due_at timestamptz,
  status text not null default 'aberta' check (status in ('aberta','concluida')),
  source text not null default 'manual' check (source in ('manual','cadencia','resposta')),
  action_url text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists tasks_open_idx on tasks (owner_id, status, due_at);

-- ---------- updated_at ----------
do $$
declare t text;
begin
  foreach t in array array['cadences','campaigns','enrollments']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------- RLS: cada usuário só vê o que é seu ----------
do $$
declare t text;
begin
  foreach t in array array['cadences','campaigns','enrollments','tasks']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "dono: ler" on %I for select using (owner_id = auth.uid())', t);
    execute format('create policy "dono: inserir" on %I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "dono: alterar" on %I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "dono: excluir" on %I for delete using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Respostas recebidas: o usuário lê, registra (simulação/manual) e corrige a classificação.
-- Webhooks gravam com a service role (fora da RLS).
alter table inbound_messages enable row level security;
create policy "dono: ler" on inbound_messages for select using (owner_id = auth.uid());
create policy "dono: inserir" on inbound_messages for insert with check (owner_id = auth.uid());
create policy "dono: alterar" on inbound_messages for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Vínculos só entre registros do mesmo dono.
create policy "campanha e lead do mesmo dono" on enrollments as restrictive for insert
  with check (
    exists (select 1 from campaigns c where c.id = campaign_id and c.owner_id = auth.uid())
    and exists (select 1 from leads d where d.id = lead_id and d.owner_id = auth.uid())
  );
