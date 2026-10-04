-- Lead Hunter — Automação (parte 1/2): novos valores de enum.
-- Fica numa migration separada porque o Postgres não deixa usar um valor de enum
-- na mesma transação em que ele foi criado.

-- Pipeline novo (os valores antigos continuam existindo; a parte 2 migra os dados).
alter type lead_stage add value if not exists 'em_cadencia' after 'qualificado';
alter type lead_stage add value if not exists 'interessado' after 'respondeu';
alter type lead_stage add value if not exists 'nao_interessado';
alter type lead_stage add value if not exists 'sem_resposta';

-- Ciclo de vida da mensagem enviada pela API oficial / provedor de e-mail.
alter type message_status add value if not exists 'queued';
alter type message_status add value if not exists 'sent';
alter type message_status add value if not exists 'delivered';
alter type message_status add value if not exists 'read';
alter type message_status add value if not exists 'replied';
alter type message_status add value if not exists 'failed';

-- Linha do tempo do lead.
alter type activity_type add value if not exists 'lead_updated';
alter type activity_type add value if not exists 'consent_recorded';
alter type activity_type add value if not exists 'campaign_enrolled';
alter type activity_type add value if not exists 'cadence_step';
alter type activity_type add value if not exists 'cadence_paused';
alter type activity_type add value if not exists 'cadence_resumed';
alter type activity_type add value if not exists 'cadence_stopped';
alter type activity_type add value if not exists 'cadence_completed';
alter type activity_type add value if not exists 'message_sent';
alter type activity_type add value if not exists 'message_status';
alter type activity_type add value if not exists 'message_failed';
alter type activity_type add value if not exists 'reply_received';
alter type activity_type add value if not exists 'reply_classified';
alter type activity_type add value if not exists 'task_created';
alter type activity_type add value if not exists 'task_done';
