-- O BEELIE conversa com você pelo seu WhatsApp pessoal: avisos de lead em potencial,
-- relatório diário e contatos que você passa para ele cadastrar e prospectar.
-- Só adiciona colunas (nada é apagado ou alterado).
alter table assistant_settings
  add column if not exists owner_whatsapp text,
  add column if not exists owner_alerts boolean not null default true,
  add column if not exists owner_report_hour int check (owner_report_hour is null or owner_report_hour between 0 and 23),
  add column if not exists owner_report_sent_on date;
