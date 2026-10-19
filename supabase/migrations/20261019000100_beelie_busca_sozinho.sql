-- Busca automática do BEELIE: quando a fila de leads novos fica baixa, ele busca empresas
-- no Google pelo Brasil todo (rotação de segmento e cidade), sem depender do app aberto.
-- Só adiciona colunas (nada é apagado ou alterado). Começa desligada.
alter table assistant_settings
  add column if not exists hunter_enabled boolean not null default false,
  add column if not exists hunter_excluded text[] not null default '{}',
  add column if not exists hunter_cursor int not null default 0,
  add column if not exists hunter_day date,
  add column if not exists hunter_today int not null default 0;
