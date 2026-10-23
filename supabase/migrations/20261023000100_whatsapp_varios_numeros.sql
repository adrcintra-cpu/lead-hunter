-- Lead Hunter — vários números de WhatsApp por conta (incremental: não apaga nem altera dados).
-- O número que já existe vira o "principal". As chaves de sessão dos números novos ficam na mesma
-- tabela whatsapp_auth, com prefixo próprio na coluna key (o serviço cuida disso).

alter table whatsapp_connections add column if not exists slot text not null default 'principal';
alter table whatsapp_connections add column if not exists label text;
alter table whatsapp_connections add column if not exists daily_limit int not null default 20
  check (daily_limit between 1 and 200);
alter table whatsapp_connections add column if not exists active boolean not null default true;

-- Antes: um número por usuário. Agora: um registro por usuário e por número.
alter table whatsapp_connections drop constraint if exists whatsapp_connections_user_id_key;
create unique index if not exists whatsapp_connections_user_slot on whatsapp_connections (user_id, slot);

-- Por qual número a mensagem saiu / chegou (o lead fica sempre com o mesmo número).
alter table messages add column if not exists wa_slot text;
alter table inbound_messages add column if not exists wa_slot text;
create index if not exists messages_wa_slot_day on messages (owner_id, wa_slot, created_at) where wa_slot is not null;
