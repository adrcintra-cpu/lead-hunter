-- Navegação do BEELIE em menus de atendimento automático (WhatsApp).
-- Só acrescenta: 1 tabela nova e 2 colunas novas com valor padrão. Não altera nem apaga nada existente.

create table if not exists chatbot_navigations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  lead_id uuid not null references leads(id) on delete cascade,
  status text not null default 'MENU_DETECTADO' check (status in (
    'MENU_DETECTADO','NAVEGANDO_MENU','AGUARDANDO_TRANSFERENCIA','ATENDIMENTO_HUMANO_PROVAVEL',
    'RESPONSAVEL_IDENTIFICADO','CONTATO_COMERCIAL_INICIADO','BLOQUEADO_POR_CHATBOT','SEM_RESPOSTA')),
  attendance text not null default 'automatizado' check (attendance in ('automatizado','humano_provavel','indefinido')),
  steps int not null default 0,
  -- Cada etapa: { at, menu: [{n,label}], chosen: {n,label}, reason, result }
  path jsonb not null default '[]'::jsonb,
  -- Menus já vistos + opção escolhida em cada um (evita repetir e entrar em loop)
  tried jsonb not null default '[]'::jsonb,
  human_evidence text,
  -- Responsável indicado: { nome, departamento, telefone, email, contexto }
  contact jsonb,
  next_action text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Uma tentativa aberta por lead; as encerradas ficam como histórico.
create unique index if not exists chatbot_navigations_open on chatbot_navigations (lead_id) where closed_at is null;
create index if not exists chatbot_navigations_owner on chatbot_navigations (owner_id, started_at desc);

create trigger trg_chatbot_navigations_updated before update on chatbot_navigations
  for each row execute function set_updated_at();

alter table chatbot_navigations enable row level security;
-- A equipe lê; quem grava é só o servidor (Edge Functions com a chave de serviço).
create policy "equipe: ler" on chatbot_navigations for select using (owner_id = (select public.current_owner()));

-- Modo da navegação e limite de etapas (configuráveis em Configurações → Assistente).
alter table assistant_settings
  add column if not exists menu_mode text not null default 'automatico' check (menu_mode in ('automatico','supervisionado','desligado')),
  add column if not exists menu_max_steps int not null default 5 check (menu_max_steps between 1 and 10);
