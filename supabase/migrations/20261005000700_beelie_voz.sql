-- Lead Hunter — o BEELIE é masculino: a voz padrão do áudio passa a ser masculina (incremental).
-- Só muda o valor padrão da coluna para linhas novas; não altera dados existentes.
alter table assistant_settings alter column voice set default 'ash';
