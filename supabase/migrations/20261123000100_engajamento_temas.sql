-- Temas escolhidos para o engajamento no Instagram (cada tema = hashtags) e a divisão do limite diário.
alter table engagement_settings add column if not exists themes jsonb not null default '[]'::jsonb;
alter table engagement_settings add column if not exists theme_share integer not null default 50 check (theme_share between 0 and 100);
alter table engagement_queue add column if not exists theme text;
