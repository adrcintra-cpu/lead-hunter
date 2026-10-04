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
