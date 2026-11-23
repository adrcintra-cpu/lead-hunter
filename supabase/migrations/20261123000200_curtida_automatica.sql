-- Curtida automática (Like Media and Comments API da Meta, permissão instagram_manage_engagement).
-- Só ACRESCENTA colunas. Desligada por padrão; comentários continuam manuais (a API não comenta em posts de terceiros).
alter table engagement_settings add column if not exists auto_like boolean not null default false;
alter table engagement_settings add column if not exists daily_likes integer not null default 20;
alter table engagement_settings drop constraint if exists engagement_settings_daily_likes_check;
alter table engagement_settings add constraint engagement_settings_daily_likes_check check (daily_likes between 0 and 60);
alter table engagement_settings add column if not exists last_like_at timestamptz;

alter table engagement_queue add column if not exists media_id text;       -- id do post no Instagram (para curtir)
alter table engagement_queue add column if not exists liked_at timestamptz; -- curtido automaticamente em
alter table engagement_queue add column if not exists like_error text;      -- por que não curtiu (conta privada, permissão…)

-- Token de usuário de longa duração (a API de curtidas pede token de usuário). Mesma tabela fechada.
alter table instagram_tokens add column if not exists user_token_enc text;
