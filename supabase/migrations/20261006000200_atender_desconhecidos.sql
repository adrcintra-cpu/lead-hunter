-- Opção "Atender quem chama sem ser lead": quando ligada, mensagens comerciais de números
-- desconhecidos no WhatsApp conectado viram lead e o Beelie responde. Desligada por padrão.
alter table assistant_settings add column if not exists answer_unknown boolean not null default false;
