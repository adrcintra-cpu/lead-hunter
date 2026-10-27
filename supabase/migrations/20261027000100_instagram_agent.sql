-- Lead Hunter — Instagram Agent (módulo novo, isolado).
-- Só CRIA tabelas novas com prefixo instagram_. Não altera, renomeia nem apaga nada existente.
-- O módulo nasce DESLIGADO (instagram_settings.enabled = false).
-- Acesso segue a equipe: todos da conta leem; admin/vendedor gravam (can_write); conta e
-- configurações só o admin. Tokens da Meta ficam numa tabela sem nenhuma política: só o
-- backend (service role) lê, e o valor vai criptografado (AES-GCM, chave em secret da função).
-- Para desfazer: ver supabase/rollback/20261027000100_instagram_agent.down.sql (fora da pasta de migrations, para o db push não rodá-lo).

-- Conta do Instagram conectada (dados visíveis; sem token).
create table if not exists instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  page_id text,
  status text not null default 'conectado' check (status in ('conectado', 'expirado', 'erro', 'desconectado')),
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, ig_user_id)
);

-- Token criptografado: RLS ligada e nenhuma política = invisível para o site.
create table if not exists instagram_tokens (
  account_id uuid primary key references instagram_accounts(id) on delete cascade,
  token_enc text not null,
  updated_at timestamptz not null default now()
);

create table if not exists instagram_settings (
  owner_id uuid primary key default public.current_owner() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  account_id uuid references instagram_accounts(id) on delete set null,
  mode text not null default 'observador' check (mode in ('observador', 'assistido', 'automatico')),
  persona_extra text,               -- complemento da personalidade do BEELIE só para o Instagram
  segments text[] not null default '{}',
  regions text[] not null default '{}',
  keywords text[] not null default '{}',
  hashtags text[] not null default '{}',
  criteria jsonb not null default '{}'::jsonb,   -- critérios e pesos da nota (transparentes)
  min_score integer not null default 60 check (min_score between 0 and 100),
  auto_reply boolean not null default false,
  hours jsonb,                                   -- horários de atendimento
  handoff_rules text,                            -- quando passar para humano
  daily_ai_limit integer not null default 100 check (daily_ai_limit between 0 and 2000),
  updated_at timestamptz not null default now()
);

-- Perfil analisado / oportunidade (um por @ na conta).
create table if not exists instagram_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  username text not null,
  company_id uuid references companies(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  name text,
  segment text,
  city text,
  bio text,
  followers integer,
  media_count integer,
  last_post_at timestamptz,
  score integer check (score between 0 and 100),
  score_breakdown jsonb,     -- pontos por critério
  reason text,               -- justificativa do Claude
  description text,
  source text not null default 'lead_hunter' check (source in ('lead_hunter', 'hashtag', 'manual', 'direct', 'comentario')),
  status text not null default 'nova' check (status in ('nova', 'descartada', 'no_lead_hunter')),
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists instagram_opportunities_user on instagram_opportunities (owner_id, lower(username));
create index if not exists instagram_opportunities_score on instagram_opportunities (owner_id, score desc);

-- Interações: sugerida → aprovada → executada → confirmada (ou descartada). Sugestão nunca conta como feita.
create table if not exists instagram_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  opportunity_id uuid references instagram_opportunities(id) on delete set null,
  kind text not null check (kind in ('comentario_terceiro', 'resposta_comentario', 'resposta_privada')),
  media_id text,
  comment_id text,
  permalink text,
  context text,
  suggestion text,
  final_text text,
  goal text,
  relevance integer check (relevance between 0 and 100),
  status text not null default 'sugerida' check (status in ('sugerida', 'aprovada', 'executada', 'confirmada', 'descartada', 'falhou')),
  manual boolean not null default false,   -- feita por você no app (sem API)
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  external_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists instagram_interactions_ext on instagram_interactions (owner_id, external_id) where external_id is not null;
create index if not exists instagram_interactions_status on instagram_interactions (owner_id, status, created_at desc);

-- Inbox (Direct).
create table if not exists instagram_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  account_id uuid not null references instagram_accounts(id) on delete cascade,
  igsid text not null,                -- id da pessoa na conta (Meta)
  username text,
  name text,
  lead_id uuid references leads(id) on delete set null,
  opportunity_id uuid references instagram_opportunities(id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta', 'humano', 'encerrada')),
  classification text check (classification in ('interessado', 'reuniao', 'duvida', 'suporte', 'nao_interessado', 'opt_out', 'outro')),
  summary text,
  last_inbound_at timestamptz,        -- controla a janela de 24 h
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, igsid)
);
create index if not exists instagram_conversations_recent on instagram_conversations (owner_id, last_message_at desc);

create table if not exists instagram_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  conversation_id uuid not null references instagram_conversations(id) on delete cascade,
  direction text not null check (direction in ('entrada', 'saida')),
  body text,
  attachments jsonb,
  suggested text,                     -- resposta sugerida pelo BEELIE (ainda não enviada)
  status text not null default 'recebida' check (status in ('recebida', 'sugerida', 'aprovada', 'enviada', 'falhou')),
  sent_by uuid references auth.users(id) on delete set null,
  auto boolean not null default false,
  external_id text,                   -- mid da Meta: evita gravar o mesmo webhook duas vezes
  failure_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists instagram_messages_ext on instagram_messages (conversation_id, external_id) where external_id is not null;
create index if not exists instagram_messages_conv on instagram_messages (conversation_id, created_at);

-- Registro de operações, aprovações e erros (só acrescenta).
create table if not exists instagram_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  status text not null default 'ok' check (status in ('ok', 'erro', 'bloqueado')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists instagram_logs_recent on instagram_logs (owner_id, created_at desc);

-- updated_at automático (função já existente no banco).
do $$
declare t text;
begin
  foreach t in array array['instagram_accounts','instagram_settings','instagram_opportunities','instagram_interactions','instagram_conversations']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$I', t);
    execute format('create trigger trg_%1$s_updated before update on %1$I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Acesso (RLS).
alter table instagram_accounts enable row level security;
alter table instagram_tokens enable row level security;   -- sem políticas de propósito
revoke all on instagram_tokens from anon, authenticated;   -- e sem acesso direto, mesmo se alguém criar política
alter table instagram_settings enable row level security;
alter table instagram_opportunities enable row level security;
alter table instagram_interactions enable row level security;
alter table instagram_conversations enable row level security;
alter table instagram_messages enable row level security;
alter table instagram_logs enable row level security;

-- Conta e configurações: equipe lê; só admin altera. (Conectar/desconectar passa pela função, com service role.)
create policy "equipe: ler" on instagram_accounts for select using (owner_id = (select public.current_owner()));
create policy "equipe: ler" on instagram_settings for select using (owner_id = (select public.current_owner()));
create policy "equipe: admin cria" on instagram_settings for insert with check (owner_id = (select public.current_owner()) and (select public.is_admin()));
create policy "equipe: admin altera" on instagram_settings for update using (owner_id = (select public.current_owner()) and (select public.is_admin())) with check (owner_id = (select public.current_owner()));

-- Dados do dia a dia: equipe lê; admin e vendedor gravam.
do $$
declare t text;
begin
  foreach t in array array['instagram_opportunities','instagram_interactions','instagram_conversations','instagram_messages']
  loop
    execute format('create policy "equipe: ler" on %I for select using (owner_id = (select public.current_owner()))', t);
    execute format('create policy "equipe: inserir" on %I for insert with check (owner_id = (select public.current_owner()) and (select public.can_write()))', t);
    execute format('create policy "equipe: alterar" on %I for update using (owner_id = (select public.current_owner()) and (select public.can_write())) with check (owner_id = (select public.current_owner()))', t);
  end loop;
end $$;
create policy "equipe: excluir" on instagram_opportunities for delete using (owner_id = (select public.current_owner()) and (select public.can_write()));

-- Log: equipe lê e acrescenta; ninguém altera nem apaga.
create policy "equipe: ler" on instagram_logs for select using (owner_id = (select public.current_owner()));
create policy "equipe: inserir" on instagram_logs for insert with check (owner_id = (select public.current_owner()));
