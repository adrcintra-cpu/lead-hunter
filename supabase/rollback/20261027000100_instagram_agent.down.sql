-- Desfaz o Instagram Agent: remove só as tabelas criadas por ele (e seus dados).
-- Nada do restante do OxyHub é afetado.
drop table if exists instagram_messages;
drop table if exists instagram_conversations;
drop table if exists instagram_interactions;
drop table if exists instagram_opportunities;
drop table if exists instagram_logs;
drop table if exists instagram_settings;
drop table if exists instagram_tokens;
drop table if exists instagram_accounts;
