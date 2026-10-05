-- Lead Hunter — resposta automática da BEELIE e áudio (incremental, só adiciona colunas).
-- auto_reply: a BEELIE responde sozinha no WhatsApp conectado (dentro do horário de envio e com limite diário).
-- reply_format: 'texto' ou 'audio' (voz gerada pela IA). voice: voz usada no áudio.

alter table assistant_settings add column if not exists auto_reply boolean not null default true;
alter table assistant_settings add column if not exists reply_format text not null default 'texto';
alter table assistant_settings add column if not exists voice text not null default 'nova';

alter table assistant_settings drop constraint if exists assistant_settings_reply_format_check;
alter table assistant_settings add constraint assistant_settings_reply_format_check check (reply_format in ('texto', 'audio'));
