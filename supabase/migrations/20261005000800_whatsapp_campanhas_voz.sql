-- Lead Hunter — campanhas pelo WhatsApp conectado e voz padrão do BEELIE (incremental, sem alterar dados existentes).
-- whatsapp_qr_campaigns: as etapas de WhatsApp das campanhas saem sozinhas pelo WhatsApp conectado (QR).
--   Desligado (ou WhatsApp desconectado), viram tarefa com link wa.me, como antes.
alter table profiles add column if not exists whatsapp_qr_campaigns boolean not null default true;
-- Voz padrão para quem ainda não escolheu: cedar (masculina, jovem e natural). Linhas existentes não mudam.
alter table assistant_settings alter column voice set default 'cedar';
