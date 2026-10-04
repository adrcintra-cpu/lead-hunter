// Classificação de respostas por regras (fallback quando a IA não está disponível)
// e preenchimento de templates com dados reais do lead.

import type { ContextField, ReplyClass } from './types.ts';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const RULES: { cls: ReplyClass; re: RegExp; confidence: number }[] = [
  { cls: 'opt_out', re: /\b(parar|pare|remov|descadastr|sair da lista|nao (me )?(mande|envie|mandem|enviem)|nao quero receber|stop|unsubscribe|lgpd)/, confidence: 0.9 },
  { cls: 'ausente', re: /(ferias|fora do escritorio|ausente|out of office|retorno (no dia|em)|resposta automatica)/, confidence: 0.85 },
  { cls: 'nao_interessado', re: /(nao (tenho|temos) interesse|sem interesse|nao (preciso|precisamos)|ja (temos|possuimos|usamos)|nao e (o )?momento|agradeco,? mas|obrigad[oa],? mas nao)/, confidence: 0.85 },
  { cls: 'reuniao', re: /(reuniao|agendar|marcar|ligacao|me liga|pode ligar|call|horario|disponivel (amanha|segunda|terca|quarta|quinta|sexta)|semana que vem)/, confidence: 0.8 },
  { cls: 'interessado', re: /(interess|quero saber|pode (me )?mandar|me (envie|manda)|gostaria|mais informac|como funciona|valores?|preco|orcamento|proposta)/, confidence: 0.75 },
];

export function classifyReplyRules(text: string): { classification: ReplyClass; confidence: number; summary: string } {
  const t = norm(text);
  for (const r of RULES) if (r.re.test(t)) return { classification: r.cls, confidence: r.confidence, summary: summarize(text) };
  if (t.includes('?')) return { classification: 'duvida', confidence: 0.6, summary: summarize(text) };
  return { classification: 'outro', confidence: 0.4, summary: summarize(text) };
}

function summarize(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 120 ? `${one.slice(0, 117)}…` : one;
}

export interface TemplateData {
  empresa?: string;
  nome?: string;
  cargo?: string;
  cidade?: string;
  estado?: string;
  segmento?: string;
  site?: string;
  remetente?: string;
  minha_empresa?: string;
  oferta?: string;
}

const LABELS: Record<keyof TemplateData, string> = {
  empresa: 'Empresa',
  nome: 'Nome do contato',
  cargo: 'Cargo',
  cidade: 'Cidade',
  estado: 'Estado',
  segmento: 'Segmento',
  site: 'Site',
  remetente: 'Seu nome',
  minha_empresa: 'Sua empresa',
  oferta: 'Sua oferta',
};

/**
 * Troca {{variavel}} pelos dados reais. Variável sem dado vira [VARIAVEL] para o usuário
 * completar: nunca inventamos o valor. Devolve também quais campos foram usados.
 */
export function renderTemplate(tpl: string, data: TemplateData): { text: string; context: ContextField[]; missing: string[] } {
  const used = new Map<string, ContextField>();
  const missing: string[] = [];
  const text = tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const k = key as keyof TemplateData;
    const v = data[k];
    if (v) {
      if (!['remetente', 'minha_empresa', 'oferta'].includes(k)) used.set(k, { field: k, label: LABELS[k] ?? k, value: v });
      return v;
    }
    missing.push(key);
    return `[${key.toUpperCase()}]`;
  });
  return { text, context: [...used.values()], missing };
}

// ---------- Regras compartilhadas entre o app (modo de teste) e o servidor ----------

/** Rodapé de descadastro: todo e-mail automático leva (LGPD / boa prática anti-spam). */
export const OPT_OUT_FOOTER = 'Para não receber mais mensagens, responda PARAR.';

export function withOptOutFooter(body: string): string {
  return body.includes(OPT_OUT_FOOTER) ? body : `${body.trimEnd()}\n\n—\n${OPT_OUT_FOOTER}`;
}

/** Separa "Assunto: ..." do corpo gerado pela IA. */
export function parseSubject(raw: string): { subject?: string; body: string } {
  const m = /^Assunto:\s*(.+)\n+/i.exec(raw);
  return m ? { subject: m[1].trim(), body: raw.slice(m[0].length) } : { body: raw };
}

/** Posição do envio dentro da cadência: muda o tom da mensagem. */
export function messageStage(steps: { type: string }[], stepIndex: number): 'primeira' | 'acompanhamento' | 'ultimo' {
  const sends = steps.map((s, i) => (s.type === 'send' ? i : -1)).filter((i) => i >= 0);
  if (stepIndex === sends[0]) return 'primeira';
  if (stepIndex === sends[sends.length - 1] && sends.length > 2) return 'ultimo';
  return 'acompanhamento';
}

export interface ReplyDecision {
  /** O que fazer com as cadências ativas do lead. */
  enrollments: 'none' | 'stop' | 'pause';
  reason?: string;
  /** Nova etapa. `force` muda mesmo se o lead já estiver mais adiante no funil. */
  stage?: { to: 'interessado' | 'respondeu' | 'nao_interessado'; force: boolean };
  task?: { title: string; description?: string };
  /** Bloquear o contato (opt-out). */
  suppress: boolean;
}

/** Etapas que uma resposta não faz retroceder (exceto recusa/opt-out). */
export const ADVANCED_STAGES = ['cliente', 'proposta', 'reuniao'];

export function replyDecision(cls: ReplyClass, companyName: string): ReplyDecision {
  switch (cls) {
    case 'ausente':
      return { enrollments: 'none', suppress: false }; // resposta automática: a cadência segue
    case 'opt_out':
      return { enrollments: 'stop', reason: 'pediu para não receber mensagens (opt-out)', stage: { to: 'nao_interessado', force: true }, suppress: true };
    case 'nao_interessado':
      return { enrollments: 'stop', reason: 'lead não tem interesse', stage: { to: 'nao_interessado', force: true }, suppress: false };
    case 'interessado':
      return { enrollments: 'pause', reason: 'lead respondeu com interesse', stage: { to: 'interessado', force: false }, task: { title: `Responder ${companyName} — interessado`, description: 'A IA classificou a resposta como interesse. Responda pessoalmente.' }, suppress: false };
    case 'reuniao':
      return { enrollments: 'pause', reason: 'lead pediu reunião', stage: { to: 'interessado', force: false }, task: { title: `Agendar reunião com ${companyName}`, description: 'O lead pediu reunião ou ligação.' }, suppress: false };
    case 'duvida':
      return { enrollments: 'pause', reason: 'lead respondeu com uma dúvida', stage: { to: 'respondeu', force: false }, task: { title: `Responder dúvida de ${companyName}` }, suppress: false };
    default:
      return { enrollments: 'pause', reason: 'lead respondeu', stage: { to: 'respondeu', force: false }, task: { title: `Ler resposta de ${companyName}`, description: 'A IA não conseguiu classificar com segurança.' }, suppress: false };
  }
}
