// Tipos da automação (campanhas, cadências, envios, respostas, tarefas).
// Compartilhados entre o app (src/) e as Edge Functions (supabase/functions/).

export type SendChannel = 'whatsapp' | 'email';

/** O que fazer quando uma condição é verdadeira ou falsa. */
export type StepAction = 'continue' | 'stop' | 'task_and_stop' | 'skip_next';

export type ConditionKind = 'replied' | 'interested' | 'read';

export type CadenceStep =
  | {
      id: string;
      type: 'send';
      channel: SendChannel;
      /** ai: a IA escreve com os dados do lead; template: texto com variáveis {{empresa}} etc. */
      mode: 'ai' | 'template';
      /** Texto do template, ou instruções extras para a IA. */
      template: string;
      /** Só e-mail. Aceita variáveis. */
      subject?: string;
      /** Nome do template aprovado na Meta (exigido para iniciar conversa no WhatsApp). */
      whatsappTemplate?: string;
      label?: string;
    }
  | { id: string; type: 'wait'; days: number; label?: string }
  | { id: string; type: 'condition'; condition: ConditionKind; ifTrue: StepAction; ifFalse: StepAction; label?: string }
  | { id: string; type: 'task'; title: string; label?: string }
  | { id: string; type: 'stage'; stage: string; label?: string };

export interface Cadence {
  id: string;
  name: string;
  description?: string;
  /** Qualquer resposta do lead encerra a cadência (padrão recomendado). */
  stopOnReply: boolean;
  steps: CadenceStep[];
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = 'rascunho' | 'agendada' | 'ativa' | 'pausada' | 'finalizada';
export type CampaignChannel = 'whatsapp' | 'email' | 'multicanal';

export interface CampaignAudience {
  segments: string[];
  cities: string[];
  minScore: number;
  stages: string[];
  tags: string[];
  listId?: string;
}

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  audience: CampaignAudience;
  channel: CampaignChannel;
  cadenceId: string;
  ownerName: string;
  status: CampaignStatus;
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Máximo de envios por dia nesta campanha (vazio = sem limite). WhatsApp conta as mensagens preparadas na fila. */
  dailyLimitEmail?: number;
  dailyLimitWhatsapp?: number;
  /** Leads novos das buscas que se encaixam no público entram sozinhos (a campanha não finaliza sozinha). */
  autoEnroll?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Campo do lead usado para personalizar uma mensagem ("contexto utilizado"). */
export interface ContextField {
  field: string;
  label: string;
  value: string;
}

export interface MessageDraft {
  channel: SendChannel;
  subject?: string;
  body: string;
  context: ContextField[];
  model: string;
  template: string;
  editedByUser: boolean;
  generatedAt: string;
}

export type EnrollmentStatus = 'pendente' | 'ativa' | 'pausada' | 'concluida' | 'interrompida';

export interface Enrollment {
  id: string;
  campaignId: string;
  cadenceId: string;
  leadId: string;
  stepIndex: number;
  status: EnrollmentStatus;
  nextRunAt?: string;
  startedAt?: string;
  lastStepAt?: string;
  stopReason?: string;
  /** Primeira mensagem, gerada e revisável antes de ativar a campanha. */
  draft?: MessageDraft;
  createdAt: string;
  updatedAt: string;
}

export type ReplyClass = 'interessado' | 'reuniao' | 'duvida' | 'nao_interessado' | 'opt_out' | 'ausente' | 'outro';

export const REPLY_LABEL: Record<ReplyClass, string> = {
  interessado: 'Interessado',
  reuniao: 'Quer reunião',
  duvida: 'Dúvida',
  nao_interessado: 'Não interessado',
  opt_out: 'Pediu para não receber',
  ausente: 'Resposta automática (ausente)',
  outro: 'Outro',
};

/**
 * Categoria detalhada da resposta (o que a pessoa quis dizer). A classificação gravada no banco
 * (ReplyClass) continua com os valores antigos; a categoria vai no histórico e na próxima ação.
 */
export type ReplyCategory =
  | 'interessado'
  | 'informacoes'
  | 'orcamento'
  | 'reuniao'
  | 'objecao'
  | 'posteriormente'
  | 'nao_interessado'
  | 'sem_contato'
  | 'nao_identificado'
  | 'ausente';

export const REPLY_CATEGORY_LABEL: Record<ReplyCategory, string> = {
  interessado: 'Interessado',
  informacoes: 'Solicitou informações',
  orcamento: 'Solicitou orçamento',
  reuniao: 'Solicitou reunião',
  objecao: 'Objeção',
  posteriormente: 'Falar posteriormente',
  nao_interessado: 'Não interessado',
  sem_contato: 'Não deseja mais contato',
  nao_identificado: 'Não identificado',
  ausente: 'Resposta automática (ausência)',
};

export const REPLY_CATEGORIES = Object.keys(REPLY_CATEGORY_LABEL) as ReplyCategory[];

/** Categoria → classificação gravada (compatível com o banco e as métricas). */
export const CATEGORY_TO_CLASS: Record<ReplyCategory, ReplyClass> = {
  interessado: 'interessado',
  informacoes: 'interessado',
  orcamento: 'interessado',
  reuniao: 'reuniao',
  objecao: 'outro',
  posteriormente: 'outro',
  nao_interessado: 'nao_interessado',
  sem_contato: 'opt_out',
  nao_identificado: 'outro',
  ausente: 'ausente',
};

/** Resultado da análise de uma resposta. */
export interface ReplyAnalysis {
  category: ReplyCategory;
  classification: ReplyClass;
  confidence: number;
  summary: string;
  suggestedAction: string;
  /** Em quantos dias voltar a falar (quando a pessoa pediu para falar depois). */
  followUpDays?: number;
}

export interface InboundMessage {
  id: string;
  leadId: string;
  channel: SendChannel;
  fromAddress: string;
  body: string;
  receivedAt: string;
  externalId?: string;
  campaignId?: string;
  enrollmentId?: string;
  classification?: ReplyClass;
  confidence?: number;
  summary?: string;
}

export type TaskStatus = 'aberta' | 'concluida';
export type TaskSource = 'manual' | 'cadencia' | 'resposta';

export interface Task {
  id: string;
  leadId?: string;
  campaignId?: string;
  title: string;
  description?: string;
  ownerName?: string;
  dueAt?: string;
  status: TaskStatus;
  source: TaskSource;
  /** Link pronto para a ação (ex.: wa.me), quando houver. */
  actionUrl?: string;
  createdAt: string;
  doneAt?: string;
}

/** Janela de envio: só manda mensagens neste horário (hora de Brasília). */
export interface SendWindow {
  startHour: number;
  endHour: number;
  weekdaysOnly: boolean;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { startHour: 9, endHour: 18, weekdaysOnly: true };
