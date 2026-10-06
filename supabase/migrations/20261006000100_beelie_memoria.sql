-- Lead Hunter — memória do Beelie (SDR conversacional) no lead (incremental, só adiciona).
-- Guarda: estágio da conversa, temperatura (frio/morno/quente), última intenção, se fala com a pessoa certa,
-- necessidade identificada, fatos com grau de certeza (confirmado/provável) e origem (conversa/humano/cadastro),
-- objeções e quais campos uma pessoa corrigiu (a IA não sobrescreve).
-- Nome, cargo e e-mail continuam nas colunas que já existem (contact_name, contact_role, email).
-- O "outro responsável" indicado na conversa vai para a tabela contacts, que já existe.
alter table leads add column if not exists beelie jsonb;
