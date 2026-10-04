-- EXEMPLO (não é aplicado automaticamente: o nome não segue o padrão de migration).
-- Agenda o executor de cadências a cada 5 minutos com pg_cron + pg_net.
-- 1) Habilite as extensões pg_cron e pg_net no painel do Supabase (Database → Extensions).
-- 2) Guarde o segredo no Vault (nunca no código):
--      select vault.create_secret('<mesmo valor do secret CRON_SECRET da função>', 'cron_secret');
-- 3) Troque <PROJECT_REF> e rode no SQL Editor:

select cron.schedule(
  'lead-hunter-cadence-runner',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cadence-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
