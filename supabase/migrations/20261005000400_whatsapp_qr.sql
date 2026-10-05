-- Lead Hunter — conexão de WhatsApp por QR code (incremental, não altera dados existentes).
--
-- Duas tabelas separadas:
--   whatsapp_connections: metadados que o usuário pode ver (número, status, datas).
--   whatsapp_auth: chaves da sessão do WhatsApp, CRIPTOGRAFADAS pelo serviço (AES-256-GCM).
--                  Sem nenhuma policy: só o serviço (service role) lê e grava. O site nunca acessa.

create table if not exists whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  phone_number text,
  status text not null default 'desconectado'
    check (status in ('desconectado', 'aguardando_qr', 'conectando', 'conectado', 'reconectando', 'erro')),
  last_error text,
  connected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_whatsapp_connections_updated on whatsapp_connections;
create trigger trg_whatsapp_connections_updated before update on whatsapp_connections
  for each row execute function set_updated_at();

alter table whatsapp_connections enable row level security;
-- O usuário só lê a própria conexão. Quem grava é o serviço.
drop policy if exists "dono: ler" on whatsapp_connections;
create policy "dono: ler" on whatsapp_connections for select using (user_id = auth.uid());

create table if not exists whatsapp_auth (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null, -- JSON criptografado (iv.tag.dados em base64)
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- RLS ligada e nenhuma policy: inacessível pela API pública (anon/authenticated).
alter table whatsapp_auth enable row level security;
