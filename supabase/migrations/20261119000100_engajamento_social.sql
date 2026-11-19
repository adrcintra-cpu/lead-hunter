-- Engajamento social assistido (Instagram e LinkedIn). Só ACRESCENTA tabelas novas:
-- nada do que já existe muda. O OxySDR prepara (encontra o perfil/post e escreve o texto);
-- a pessoa abre o link, envia na rede e marca como feito. Nenhuma ação automática em perfis
-- de terceiros (as redes proíbem).

create table if not exists engagement_settings (
  owner_id uuid primary key default public.current_owner() references auth.users(id) on delete cascade,
  hashtags text[] not null default '{}',              -- hashtags do nicho para garimpar posts no Instagram
  daily_instagram integer not null default 10 check (daily_instagram between 0 and 40),
  daily_linkedin integer not null default 10 check (daily_linkedin between 0 and 40),
  linkedin_roles text not null default 'sócio, diretor, gerente comercial, gerente de marketing',
  updated_at timestamptz not null default now()
);

create table if not exists engagement_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default public.current_owner() references auth.users(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'linkedin')),
  kind text not null check (kind in ('comentario', 'convite', 'mensagem')),
  lead_id uuid references leads(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  opportunity_id uuid references instagram_opportunities(id) on delete set null,
  title text not null,                 -- quem: empresa, @perfil ou #hashtag
  profile_url text,                    -- perfil (ou busca no LinkedIn) para abrir
  target_url text,                     -- post a comentar
  context text,                        -- o que a IA leu (legenda do post, bio, etapa do lead)
  suggestion text not null,            -- texto sugerido pela IA (Sugestão de IA)
  final_text text,                     -- texto que a pessoa realmente usou
  status text not null default 'sugerida' check (status in ('sugerida', 'feita', 'descartada')),
  for_date date not null default current_date,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  ai_model text,
  created_at timestamptz not null default now()
);
create index if not exists engagement_queue_day on engagement_queue (owner_id, status, for_date);
-- Um pendente por lead/canal/tipo (não repete a mesma sugestão)
create unique index if not exists engagement_queue_pending_lead
  on engagement_queue (owner_id, channel, kind, lead_id) where status = 'sugerida' and lead_id is not null;
create unique index if not exists engagement_queue_pending_post
  on engagement_queue (owner_id, channel, kind, target_url) where status = 'sugerida' and target_url is not null and lead_id is null;

alter table engagement_settings enable row level security;
alter table engagement_queue enable row level security;

create policy "equipe: ler" on engagement_settings for select using (owner_id = (select public.current_owner()));
create policy "equipe: inserir" on engagement_settings for insert with check (owner_id = (select public.current_owner()) and (select public.can_write()));
create policy "equipe: alterar" on engagement_settings for update using (owner_id = (select public.current_owner()) and (select public.can_write())) with check (owner_id = (select public.current_owner()));

create policy "equipe: ler" on engagement_queue for select using (owner_id = (select public.current_owner()));
create policy "equipe: inserir" on engagement_queue for insert with check (owner_id = (select public.current_owner()) and (select public.can_write()));
create policy "equipe: alterar" on engagement_queue for update using (owner_id = (select public.current_owner()) and (select public.can_write())) with check (owner_id = (select public.current_owner()));

-- Respostas a comentários nos posts da própria conta (a API permite responder no que é seu).
alter table engagement_queue drop constraint if exists engagement_queue_kind_check;
alter table engagement_queue add constraint engagement_queue_kind_check check (kind in ('comentario', 'convite', 'mensagem', 'resposta'));
alter table engagement_queue add column if not exists external_id text;   -- id do comentário no Instagram
create unique index if not exists engagement_queue_external on engagement_queue (owner_id, external_id) where external_id is not null;
