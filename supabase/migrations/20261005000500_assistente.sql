-- Lead Hunter — persona, base de conhecimento e playbooks do assistente de IA (incremental).
-- Uma linha por usuário. Sem linha, o sistema usa o texto padrão da OXYCOM (BEELIE).

create table if not exists assistant_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name text,
  persona text,
  knowledge text,
  playbooks text,
  updated_at timestamptz not null default now()
);

alter table assistant_settings enable row level security;
drop policy if exists "dono: ler" on assistant_settings;
create policy "dono: ler" on assistant_settings for select using (owner_id = auth.uid());
drop policy if exists "dono: inserir" on assistant_settings;
create policy "dono: inserir" on assistant_settings for insert with check (owner_id = auth.uid());
drop policy if exists "dono: alterar" on assistant_settings;
create policy "dono: alterar" on assistant_settings for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
