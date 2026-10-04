// Planejador de cadências: decide o que fazer com uma inscrição, sem efeitos colaterais.
// Usado pelo app (modo de teste, relógio simulado) e pelo executor no servidor.

import type { Cadence, CadenceStep, SendChannel, SendWindow, StepAction } from './types.ts';

export interface PlanContext {
  now: Date;
  /** O lead respondeu depois que a inscrição começou (respostas automáticas de ausência não contam). */
  replied: boolean;
  interested: boolean;
  read: boolean;
  suppressed: boolean;
  hasWhatsapp: boolean;
  hasWhatsappConsent: boolean;
  hasEmail: boolean;
  window: SendWindow;
}

export type Effect =
  | { kind: 'send'; channel: SendChannel; step: Extract<CadenceStep, { type: 'send' }>; stepIndex: number }
  /** WhatsApp sem opt-in: vira tarefa humana com o link wa.me. */
  | { kind: 'manual_whatsapp'; step: Extract<CadenceStep, { type: 'send' }>; stepIndex: number }
  | { kind: 'skipped'; reason: string; stepIndex: number }
  | { kind: 'task'; title: string; stepIndex: number }
  | { kind: 'stage'; stage: string; stepIndex: number };

export interface Plan {
  effects: Effect[];
  stepIndex: number;
  status: 'ativa' | 'concluida' | 'interrompida';
  nextRunAt?: Date;
  stopReason?: string;
}

const BRT_OFFSET_H = -3; // Brasil sem horário de verão desde 2019

function brtParts(d: Date) {
  const local = new Date(d.getTime() + BRT_OFFSET_H * 3600_000);
  return { hour: local.getUTCHours(), day: local.getUTCDay(), local };
}

/** Está dentro da janela de envio? */
export function inWindow(d: Date, w: SendWindow): boolean {
  const { hour, day } = brtParts(d);
  if (w.weekdaysOnly && (day === 0 || day === 6)) return false;
  return hour >= w.startHour && hour < w.endHour;
}

/** Próximo início de janela a partir de d (ou d, se já estiver dentro). */
export function nextWindowStart(d: Date, w: SendWindow): Date {
  if (inWindow(d, w)) return d;
  const { local } = brtParts(d);
  const cand = new Date(local);
  cand.setUTCMinutes(0, 0, 0);
  if (local.getUTCHours() >= w.startHour) cand.setUTCDate(cand.getUTCDate() + 1);
  cand.setUTCHours(w.startHour);
  while (w.weekdaysOnly && (cand.getUTCDay() === 0 || cand.getUTCDay() === 6)) cand.setUTCDate(cand.getUTCDate() + 1);
  return new Date(cand.getTime() - BRT_OFFSET_H * 3600_000);
}

function evaluate(kind: 'replied' | 'interested' | 'read', ctx: PlanContext): boolean {
  return kind === 'replied' ? ctx.replied : kind === 'interested' ? ctx.interested : ctx.read;
}

/**
 * Executa a cadência a partir de stepIndex até o próximo ponto de espera.
 * Envios fora da janela ficam adiados; esperas agendam a próxima execução.
 */
export function plan(cadence: Cadence, stepIndex: number, ctx: PlanContext): Plan {
  const effects: Effect[] = [];
  let i = stepIndex;
  for (let guard = 0; guard < 100; guard++) {
    if (ctx.suppressed) return { effects, stepIndex: i, status: 'interrompida', stopReason: 'Contato pediu para não receber mensagens (opt-out).' };
    if (cadence.stopOnReply && ctx.replied) return { effects, stepIndex: i, status: 'interrompida', stopReason: 'O lead respondeu.' };
    if (i >= cadence.steps.length) return { effects, stepIndex: i, status: 'concluida' };
    const step = cadence.steps[i];

    if (step.type === 'wait') {
      const days = Math.max(0, Number(step.days) || 0);
      return { effects, stepIndex: i + 1, status: 'ativa', nextRunAt: new Date(ctx.now.getTime() + days * 864e5) };
    }

    if (step.type === 'send') {
      if (!inWindow(ctx.now, ctx.window)) {
        return { effects, stepIndex: i, status: 'ativa', nextRunAt: nextWindowStart(ctx.now, ctx.window) };
      }
      if (step.channel === 'whatsapp') {
        if (!ctx.hasWhatsapp) effects.push({ kind: 'skipped', reason: 'Lead sem WhatsApp cadastrado.', stepIndex: i });
        else if (!ctx.hasWhatsappConsent) effects.push({ kind: 'manual_whatsapp', step, stepIndex: i });
        else effects.push({ kind: 'send', channel: 'whatsapp', step, stepIndex: i });
      } else if (!ctx.hasEmail) {
        effects.push({ kind: 'skipped', reason: 'Lead sem e-mail cadastrado.', stepIndex: i });
      } else {
        effects.push({ kind: 'send', channel: 'email', step, stepIndex: i });
      }
      i += 1;
      continue;
    }

    if (step.type === 'condition') {
      const action: StepAction = evaluate(step.condition, ctx) ? step.ifTrue : step.ifFalse;
      if (action === 'stop') return { effects, stepIndex: i + 1, status: 'interrompida', stopReason: `Condição da etapa ${i + 1}: encerrar.` };
      if (action === 'task_and_stop') {
        effects.push({ kind: 'task', title: 'Dar continuidade ao contato', stepIndex: i });
        return { effects, stepIndex: i + 1, status: 'interrompida', stopReason: `Condição da etapa ${i + 1}: tarefa criada e cadência encerrada.` };
      }
      i += action === 'skip_next' ? 2 : 1;
      continue;
    }

    if (step.type === 'task') {
      effects.push({ kind: 'task', title: step.title, stepIndex: i });
      i += 1;
      continue;
    }

    // stage
    effects.push({ kind: 'stage', stage: step.stage, stepIndex: i });
    i += 1;
  }
  return { effects, stepIndex: i, status: 'interrompida', stopReason: 'Cadência com laço infinito.' };
}

/** Texto curto de uma etapa, para listas e linha do tempo. */
export function describeStep(step: CadenceStep): string {
  switch (step.type) {
    case 'send':
      return `${step.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · ${step.mode === 'ai' ? 'mensagem personalizada pela IA' : 'template'}`;
    case 'wait':
      return `Aguardar ${step.days} ${step.days === 1 ? 'dia' : 'dias'}`;
    case 'condition': {
      const c = { replied: 'respondeu', interested: 'demonstrou interesse', read: 'leu a mensagem' }[step.condition];
      const a = (x: StepAction) => ({ continue: 'continuar', stop: 'parar', task_and_stop: 'criar tarefa e parar', skip_next: 'pular a próxima etapa' })[x];
      return `Se ${c}: ${a(step.ifTrue)} · senão: ${a(step.ifFalse)}`;
    }
    case 'task':
      return `Criar tarefa: ${step.title}`;
    case 'stage':
      return `Mover para a etapa ${step.stage}`;
  }
}
