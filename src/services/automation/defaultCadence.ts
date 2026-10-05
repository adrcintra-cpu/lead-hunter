import type { Cadence } from '@/core/types';

/** Cadência do exemplo da especificação: ponto de partida editável. */
export const DEFAULT_CADENCE = (): Omit<Cadence, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: 'Prospecção padrão — WhatsApp + e-mail',
  description: 'Mensagem inicial personalizada, e-mail se não responder, acompanhamento e último contato.',
  stopOnReply: true,
  steps: [
    { id: 's1', type: 'send', channel: 'whatsapp', mode: 'ai', template: '', whatsappTemplate: 'prospeccao_inicial', label: 'Dia 0 — mensagem inicial personalizada' },
    { id: 's2', type: 'wait', days: 3 },
    { id: 's3', type: 'condition', condition: 'replied', ifTrue: 'stop', ifFalse: 'continue' },
    { id: 's4', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'E-mail de acompanhamento' },
    { id: 's5', type: 'wait', days: 4 },
    { id: 's6', type: 'send', channel: 'whatsapp', mode: 'ai', template: '', whatsappTemplate: 'prospeccao_followup', label: 'WhatsApp de acompanhamento' },
    { id: 's7', type: 'wait', days: 7 },
    { id: 's8', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Último contato' },
  ],
});

/** Modelos prontos para criar cadências (editáveis depois). Os intervalos são só o ponto de partida. */
export const CADENCE_TEMPLATES: { key: string; label: string; build: () => Omit<Cadence, 'id' | 'createdAt' | 'updatedAt'> }[] = [
  {
    key: 'email-3-7-14',
    label: 'E-mail: 1º contato + follow-ups nos dias 3, 7 e 14',
    build: () => ({
      name: 'E-mail — 1º contato + follow-ups (dias 3, 7 e 14)',
      description: 'Primeiro contato; sem resposta, follow-up no dia 3, segundo follow-up no dia 7 e último contato no dia 14. Para ao responder.',
      stopOnReply: true,
      steps: [
        { id: 'e1', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Primeiro contato' },
        { id: 'e2', type: 'wait', days: 3 },
        { id: 'e3', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Follow-up' },
        { id: 'e4', type: 'wait', days: 4 },
        { id: 'e5', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Segundo follow-up' },
        { id: 'e6', type: 'wait', days: 7 },
        { id: 'e7', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Último contato' },
      ],
    }),
  },
  {
    key: 'semanal-4',
    label: 'Semanal: 4 semanas (WhatsApp manual + e-mail)',
    build: () => ({
      name: 'Follow-up semanal — 4 semanas',
      description: 'Um contato por semana, alternando WhatsApp (tarefa com link wa.me) e e-mail. Cada mensagem é escrita pela IA lendo o histórico, sem repetir a anterior. Para ao responder.',
      stopOnReply: true,
      steps: [
        { id: 'w1', type: 'send', channel: 'whatsapp', mode: 'ai', template: '', label: 'Semana 1 — WhatsApp' },
        { id: 'w2', type: 'wait', days: 7 },
        { id: 'w3', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Semana 2 — e-mail' },
        { id: 'w4', type: 'wait', days: 7 },
        { id: 'w5', type: 'send', channel: 'whatsapp', mode: 'ai', template: '', label: 'Semana 3 — WhatsApp' },
        { id: 'w6', type: 'wait', days: 7 },
        { id: 'w7', type: 'send', channel: 'email', mode: 'ai', template: '', label: 'Semana 4 — último contato' },
      ],
    }),
  },
];
