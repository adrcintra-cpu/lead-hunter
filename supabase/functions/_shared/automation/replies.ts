// Classificação de respostas por regras (fallback quando a IA não está disponível)
// e preenchimento de templates com dados reais do lead.

import { CATEGORY_TO_CLASS, REPLY_CATEGORIES, type ContextField, type ReplyAnalysis, type ReplyCategory, type ReplyClass } from './types.ts';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const RULES: { cat: ReplyCategory; re: RegExp; confidence: number }[] = [
  { cat: 'sem_contato', re: /\b(parar|pare|remov|descadastr|sair da lista|nao (me )?(mande|envie|mandem|enviem|contate|procure)|nao quero (mais )?receber|nao (entre|entrem) (mais )?em contato|stop|unsubscribe|lgpd)/, confidence: 0.9 },
  { cat: 'ausente', re: /(ferias|fora do escritorio|ausente ate|estou ausente|out of office|retorno (no dia|em)|resposta automatica)/, confidence: 0.85 },
  { cat: 'posteriormente', re: /(mais (pra|para) frente|outro momento|proximo (mes|ano|semestre)|depois d[oa]s? |me (procure|chame|procura|chama) (em|no|na|daqui|depois|mais)|retorne (em|no|na|daqui|depois)|daqui a? ?(uns|alguns)? ?\d* ?(dias|semanas|meses)|agora nao|nao e (o )?momento|no momento nao|fim do ano|ano que vem)/, confidence: 0.75 },
  { cat: 'nao_interessado', re: /(nao (tenho|temos) interesse|sem interesse|nao (preciso|precisamos)|nao nos interessa|agradeco,? mas|obrigad[oa],? mas nao|dispenso|nao quero\b)/, confidence: 0.85 },
  { cat: 'reuniao', re: /(reuniao|agendar|marcar (uma )?(conversa|call|horario)|ligacao|me liga|pode (me )?ligar|\bcall\b|horario|disponivel (amanha|segunda|terca|quarta|quinta|sexta)|semana que vem)/, confidence: 0.8 },
  { cat: 'orcamento', re: /(orcamento|cotacao|quanto custa|qual (o )?(valor|preco)|valores|precos?\b|tabela de preco|proposta comercial|manda (uma )?proposta)/, confidence: 0.8 },
  { cat: 'objecao', re: /(muito caro|caro demais|ja (temos|possuimos|usamos|trabalhamos com)|sem (verba|budget|orcamento)|nao temos (verba|budget)|fornecedor|contrato (vigente|com))/, confidence: 0.7 },
  { cat: 'informacoes', re: /(mais informac|como funciona|me (envie|manda|mande|passa) (mais )?(detalhes|material|informac|apresentacao|catalogo)|pode (me )?(enviar|mandar|explicar)|quero saber|gostaria de saber|catalogo|portfolio)/, confidence: 0.75 },
  { cat: 'interessado', re: /(interess|gostei|quero|pode ser|vamos conversar|faz sentido|\bbora\b|\btop\b|legal,? (vamos|pode))/, confidence: 0.7 },
];

/** Próxima ação sugerida para cada categoria (usada pelas regras e quando a IA não sugere). */
export const DEFAULT_ACTION: Record<ReplyCategory, string> = {
  interessado: 'Responder pessoalmente e propor uma conversa.',
  informacoes: 'Enviar as informações pedidas (apresentação ou material).',
  orcamento: 'Preparar e enviar o orçamento.',
  reuniao: 'Responder com 2 ou 3 horários para a reunião.',
  objecao: 'Responder à objeção com um argumento ou caso de uso, sem insistir.',
  posteriormente: 'Retomar o contato na data combinada.',
  nao_interessado: 'Agradecer e encerrar a prospecção.',
  sem_contato: 'Não entrar mais em contato.',
  nao_identificado: 'Ler a resposta e decidir o próximo passo.',
  ausente: 'Aguardar o retorno da pessoa; a cadência continua.',
};

/** Prazo de retorno quando a pessoa pede para falar depois (dias). */
export function followUpDaysFrom(text: string): number | undefined {
  const t = norm(text);
  const m = /(\d+)\s*(dias|semanas|meses)/.exec(t);
  if (m) return Number(m[1]) * (m[2] === 'dias' ? 1 : m[2] === 'semanas' ? 7 : 30);
  if (/proxima semana|semana que vem/.test(t)) return 7;
  if (/proximo mes|mes que vem/.test(t)) return 30;
  if (/proximo semestre/.test(t)) return 180;
  if (/ano que vem|proximo ano/.test(t)) return 90;
  return undefined;
}

/** Análise por regras (modo de teste e reserva quando a IA não responde). */
export function analyzeReplyRules(text: string): ReplyAnalysis {
  const t = norm(text);
  const hit = RULES.find((r) => r.re.test(t));
  const category: ReplyCategory = hit ? hit.cat : t.includes('?') ? 'informacoes' : 'nao_identificado';
  const confidence = hit ? hit.confidence : t.includes('?') ? 0.55 : 0.4;
  return {
    category,
    classification: CATEGORY_TO_CLASS[category],
    confidence,
    summary: summarize(text),
    suggestedAction: DEFAULT_ACTION[category],
    followUpDays: category === 'posteriormente' ? followUpDaysFrom(text) ?? 30 : undefined,
  };
}

/** Compatibilidade: devolve só a classificação antiga. */
export function classifyReplyRules(text: string): { classification: ReplyClass; confidence: number; summary: string } {
  const a = analyzeReplyRules(text);
  return { classification: a.classification, confidence: a.confidence, summary: a.summary };
}

/** Normaliza a saída da IA (inclusive de uma versão antiga da função, que só devolvia a classificação). */
export function normalizeAnalysis(raw: Partial<ReplyAnalysis> & { classification?: ReplyClass }, text: string): ReplyAnalysis {
  const fallback = analyzeReplyRules(text);
  let category = raw.category && REPLY_CATEGORIES.includes(raw.category) ? raw.category : undefined;
  if (!category && raw.classification) {
    const fromOld: Record<ReplyClass, ReplyCategory> = { interessado: 'interessado', reuniao: 'reuniao', duvida: 'informacoes', nao_interessado: 'nao_interessado', opt_out: 'sem_contato', ausente: 'ausente', outro: 'nao_identificado' };
    category = fromOld[raw.classification];
  }
  category ??= fallback.category;
  const days = Number(raw.followUpDays);
  return {
    category,
    classification: CATEGORY_TO_CLASS[category],
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : fallback.confidence,
    summary: raw.summary?.trim() || fallback.summary,
    suggestedAction: raw.suggestedAction?.trim() || DEFAULT_ACTION[category],
    followUpDays: category === 'posteriormente' ? (days > 0 ? Math.round(days) : fallback.followUpDays ?? 30) : undefined,
  };
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

/**
 * O que fazer quando o lead responde, por categoria. Aceita também a classificação antiga
 * (respostas registradas antes desta versão).
 */
export function replyDecision(cat: ReplyCategory | ReplyClass, companyName: string): ReplyDecision {
  const c: ReplyCategory = cat === 'duvida' ? 'informacoes' : cat === 'opt_out' ? 'sem_contato' : cat === 'outro' ? 'nao_identificado' : (cat as ReplyCategory);
  const pause = (reason: string, to: 'interessado' | 'respondeu', title?: string, description?: string): ReplyDecision => ({
    enrollments: 'pause',
    reason,
    stage: { to, force: false },
    task: title ? { title, description } : undefined,
    suppress: false,
  });
  switch (c) {
    case 'ausente':
      return { enrollments: 'none', suppress: false }; // resposta automática: a cadência segue
    case 'sem_contato':
      return { enrollments: 'stop', reason: 'pediu para não receber mensagens (opt-out)', stage: { to: 'nao_interessado', force: true }, suppress: true };
    case 'nao_interessado':
      return { enrollments: 'stop', reason: 'lead não tem interesse', stage: { to: 'nao_interessado', force: true }, suppress: false };
    case 'interessado':
      return pause('lead respondeu com interesse', 'interessado', `Responder ${companyName} — interessado`, 'A IA classificou a resposta como interesse. Responda pessoalmente.');
    case 'informacoes':
      return pause('lead pediu informações', 'interessado', `Enviar informações para ${companyName}`, 'O lead pediu mais informações.');
    case 'orcamento':
      return pause('lead pediu orçamento', 'interessado', `Enviar orçamento para ${companyName}`, 'O lead pediu valores ou orçamento.');
    case 'reuniao':
      return pause('lead pediu reunião', 'interessado', `Agendar reunião com ${companyName}`, 'O lead pediu reunião ou ligação.');
    case 'objecao':
      return pause('lead apresentou uma objeção', 'respondeu', `Tratar objeção de ${companyName}`);
    case 'posteriormente':
      // Sem tarefa: o próximo contato fica agendado na data combinada.
      return pause('lead pediu para falar depois', 'respondeu');
    default:
      return pause('lead respondeu', 'respondeu', `Ler resposta de ${companyName}`, 'A IA não conseguiu classificar com segurança.');
  }
}
