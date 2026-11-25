-- Desempenho: as políticas "dono" chamavam auth.uid() uma vez POR LINHA (o Postgres não guarda o valor).
-- Com (select auth.uid()) a função roda uma vez por consulta. Mesma regra de acesso, só mais rápida.
do $$
declare
  p record;
  q text;
  c text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
  loop
    q := regexp_replace(coalesce(p.qual, ''), '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi');
    c := regexp_replace(coalesce(p.with_check, ''), '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi');
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then stmt := stmt || format(' using (%s)', q); end if;
    if p.with_check is not null then stmt := stmt || format(' with check (%s)', c); end if;
    execute stmt;
  end loop;
end $$;

-- Leitura incremental do app (por dono, mais recentes primeiro)
create index if not exists lead_activities_owner_created_idx on public.lead_activities (owner_id, created_at desc);
create index if not exists ai_runs_owner_created_idx on public.ai_runs (owner_id, created_at desc);
