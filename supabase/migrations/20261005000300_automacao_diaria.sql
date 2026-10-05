-- Lead Hunter — automação diária (incremental, não altera dados existentes).

-- Limite de envios por dia e entrada automática de leads novos na campanha.
alter table campaigns
  add column if not exists daily_limit_email int check (daily_limit_email is null or daily_limit_email > 0),
  add column if not exists daily_limit_whatsapp int check (daily_limit_whatsapp is null or daily_limit_whatsapp > 0),
  add column if not exists auto_enroll boolean not null default false;

-- Busca salva com execução automática (diária ou semanal).
alter table saved_searches
  add column if not exists schedule text not null default 'off' check (schedule in ('off', 'diaria', 'semanal')),
  add column if not exists next_run_at timestamptz;

-- Contagem rápida dos envios do dia por campanha.
create index if not exists messages_campaign_day_idx on messages (campaign_id, channel, created_at) where campaign_id is not null;
