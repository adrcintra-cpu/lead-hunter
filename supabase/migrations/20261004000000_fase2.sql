-- Lead Hunter — Fase 2: dados oficiais de CNPJ, origem por fonte e histórico de etapas legível.

-- Dados da Receita (BrasilAPI). "Porte" aqui é a classificação da Receita (ME, EPP, Demais),
-- não o número de funcionários.
alter table companies
  add column if not exists company_size text,
  add column if not exists cnae text,
  add column if not exists registration_status text,
  add column if not exists opened_at date;

create unique index if not exists companies_owner_cnpj_idx on companies (owner_id, cnpj) where cnpj is not null;

alter type activity_type add value if not exists 'enriched';

-- Consultas por fonte e validade (termos do Google Places: renovar dados guardados).
create index if not exists lead_sources_company_idx on lead_sources (company_id, fetched_at desc);
create index if not exists lead_sources_expires_idx on lead_sources (owner_id, expires_at) where expires_at is not null;

-- A atividade de mudança de etapa passa a ter o texto que a interface mostra.
create or replace function stage_label(s lead_stage) returns text language sql immutable as $$
  select case s
    when 'novo' then 'Novo'
    when 'qualificado' then 'Qualificado'
    when 'contato_preparado' then 'Contato preparado'
    when 'contatado' then 'Contatado'
    when 'respondeu' then 'Respondeu'
    when 'reuniao' then 'Reunião'
    when 'proposta' then 'Proposta'
    when 'cliente' then 'Cliente'
    when 'descartado' then 'Descartado'
  end
$$;

create or replace function log_stage_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    insert into lead_activities (owner_id, lead_id, type, description, payload, actor_id)
    values (new.owner_id, new.id, 'stage_changed',
            'Etapa: ' || stage_label(old.stage) || ' → ' || stage_label(new.stage),
            jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());
    new.last_activity_at = now();
  end if;
  return new;
end $$;
