// Persistência da navegação em menus (tabela chatbot_navigations) e integração com a resposta automática.

import { hasClaude, logRun, runTask } from '../ai/claude.ts';
import { log, upsertReplyTask } from './engine.ts';
import { classifyTurn, decide, FINAL, menuKey, needsAi, rankOptions, type Action, type NavState } from './menuNav.ts';
import { menuOptions } from './replies.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type NavMode = 'automatico' | 'supervisionado' | 'desligado';
export type NavOutcome =
  | { kind: 'send'; messageId: string; body: string; template: 'menu' | 'humano' }
  | { kind: 'skip' } // tratada (aguardando, supervisionado ou bloqueada): sem resposta automática
  | { kind: 'pass' }; // não é navegação: segue a conversa normal

const STATUS_LABEL: Record<string, string> = {
  MENU_DETECTADO: 'Menu detectado',
  NAVEGANDO_MENU: 'Navegando no menu',
  AGUARDANDO_TRANSFERENCIA: 'Aguardando transferência',
  ATENDIMENTO_HUMANO_PROVAVEL: 'Atendimento humano provável',
  RESPONSAVEL_IDENTIFICADO: 'Responsável identificado',
  CONTATO_COMERCIAL_INICIADO: 'Contato comercial iniciado',
  BLOQUEADO_POR_CHATBOT: 'Bloqueado por chatbot',
  SEM_RESPOSTA: 'Sem resposta',
};

async function companyName(db: Row, leadId: string): Promise<string> {
  const { data } = await db.from('leads').select('companies(legal_name, trade_name)').eq('id', leadId).maybeSingle();
  const c = data?.companies;
  return (c?.trade_name || c?.legal_name || 'o lead') as string;
}

/** Responsável indicado que o BEELIE já anotou (classificação da resposta). */
function referral(intel: Row | null | undefined, since: string): Record<string, string> | null {
  const f = intel?.facts ?? {};
  const name = f.referred_name?.value;
  if (!name || String(f.referred_name?.at ?? '') < since) return null;
  const out: Record<string, string> = { nome: String(name) };
  if (f.referred_role?.value) out.departamento = String(f.referred_role.value);
  const contact = String(f.referred_contact?.value ?? '');
  if (/@/.test(contact)) out.email = contact;
  else if (/\d{8,}/.test(contact.replace(/\D/g, ''))) out.telefone = contact;
  out.contexto = 'Indicado no atendimento do WhatsApp';
  return out;
}

/**
 * Decide o que fazer com a mensagem recebida quando há (ou começa) uma navegação em menu.
 * Grava o estado e o histórico; devolve o texto a enviar (o rascunho `draftId` é atualizado com ele).
 */
export async function navigate(
  db: Row,
  ownerId: string,
  leadId: string,
  opts: { draftId: string; text: string; intel?: Row | null; mode: NavMode; maxSteps: number },
): Promise<NavOutcome> {
  const now = new Date();
  const { data: open } = await db.from('chatbot_navigations').select('*').eq('lead_id', leadId).is('closed_at', null).maybeSingle();
  const row = open as Row | null;
  const turn = classifyTurn(opts.text);

  if (!row) {
    if (turn.kind !== 'menu' && turn.kind !== 'rejeicao') return { kind: 'pass' };
    // Robô já bloqueou nos últimos 7 dias: não tenta de novo (sem insistência).
    const week = new Date(now.getTime() - 7 * 864e5).toISOString();
    const { count: blocked } = await db.from('chatbot_navigations').select('id', { count: 'exact', head: true }).eq('lead_id', leadId).in('status', ['BLOQUEADO_POR_CHATBOT', 'SEM_RESPOSTA']).gte('closed_at', week);
    if ((blocked ?? 0) > 0) return { kind: 'skip' };
    if (opts.mode === 'desligado') {
      if (turn.kind !== 'menu') return { kind: 'pass' };
      const name = await companyName(db, leadId);
      await upsertReplyTask(db, ownerId, leadId, { title: `Atendimento automático: ${name}`, description: 'A empresa respondeu com um menu de atendimento automático. A navegação do BEELIE está desligada: responda o menu você mesmo ou procure outro canal.', dueAt: now.toISOString() });
      await log(db, ownerId, leadId, 'lead_updated', 'Menu de atendimento automático detectado. A navegação do BEELIE está desligada: a tarefa ficou com você.', { kind: 'menu_nav', status: 'desligado' });
      return { kind: 'skip' };
    }
  }

  const prev: NavState | null = row
    ? { status: row.status, attendance: row.attendance, steps: row.steps, path: row.path ?? [], tried: row.tried ?? [], human_evidence: row.human_evidence, contact: row.contact, next_action: row.next_action }
    : null;

  // Responsável indicado durante a conversa com a pessoa: registra e encerra.
  if (row && ['ATENDIMENTO_HUMANO_PROVAVEL', 'CONTATO_COMERCIAL_INICIADO'].includes(row.status)) {
    const ref = referral(opts.intel, row.started_at);
    if (ref) {
      const path = [...(prev!.path ?? []), { at: now.toISOString(), kind: 'responsavel', reason: `Indicaram ${ref.nome}${ref.departamento ? ` (${ref.departamento})` : ''}`, result: 'Responsável registrado no lead' }];
      await db.from('chatbot_navigations').update({ status: 'RESPONSAVEL_IDENTIFICADO', contact: ref, path, next_action: `Falar com ${ref.nome}`, closed_at: now.toISOString() }).eq('id', row.id);
      await log(db, ownerId, leadId, 'lead_updated', `Navegação: responsável identificado — ${ref.nome}${ref.departamento ? `, ${ref.departamento}` : ''}.`, { kind: 'menu_nav', status: 'RESPONSAVEL_IDENTIFICADO' });
      return { kind: 'pass' };
    }
  }

  // Última mensagem com menu (para quando o robô só diz "não entendi").
  let lastMenuText: string | null = null;
  if (turn.kind === 'rejeicao') {
    const { data: rec } = await db.from('inbound_messages').select('body').eq('lead_id', leadId).eq('channel', 'whatsapp').order('received_at', { ascending: false }).limit(6);
    lastMenuText = ((rec ?? []) as Row[]).map((r) => String(r.body ?? '')).slice(1).find((b) => menuOptions(b).length >= 2) ?? null;
  }

  // Menu sem opção óbvia: a IA interpreta (equivalências como "Relacionamento", "Linha industrial").
  let aiPick: { n: string; reason: string } | null = null;
  if (turn.kind === 'menu' && hasClaude()) {
    const key = menuKey(turn.options);
    const tried = (prev?.tried ?? []).filter((x) => x.menu === key).map((x) => x.n);
    if (needsAi(turn.options, tried)) {
      const started = Date.now();
      try {
        const r = await runTask<{ option: string | null; reason: string }>('chooseMenuOption', { menu: turn.options, tried, company: await companyName(db, leadId) });
        await logRun(db, ownerId, 'chooseMenuOption', started, 'ok', r.usage);
        const n = r.output?.option ? String(r.output.option).replace(/\D/g, '') : '';
        // Só vale opção que existe no menu e que as regras não proíbem.
        if (n && rankOptions(turn.options, tried).some((o) => o.n === n)) aiPick = { n, reason: String(r.output.reason ?? '').slice(0, 160) };
      } catch {
        await logRun(db, ownerId, 'chooseMenuOption', started, 'error', {});
      }
    }
  }

  // Resposta em segundos depois do BEELIE: sinal de máquina.
  const { data: lastOut } = await db.from('messages').select('sent_at').eq('lead_id', leadId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
  const instant = !!lastOut?.[0]?.sent_at && now.getTime() - new Date(lastOut[0].sent_at).getTime() <= 8000;

  const { state, action } = decide(prev, opts.text, { maxSteps: opts.maxSteps, now, lastMenuText, aiPick, instant });
  if (!state) return { kind: 'pass' };

  const fields = {
    status: state.status,
    attendance: state.attendance,
    steps: state.steps,
    path: state.path,
    tried: state.tried,
    human_evidence: state.human_evidence ?? null,
    contact: state.contact ?? null,
    next_action: state.next_action ?? null,
    closed_at: FINAL.includes(state.status) ? now.toISOString() : null,
  };
  if (row) {
    // Só grava se ninguém mexeu no meio do caminho (mensagens chegando juntas).
    const { data: upd } = await db.from('chatbot_navigations').update(fields).eq('id', row.id).eq('steps', row.steps).eq('status', row.status).select('id');
    if (!upd?.length) return { kind: 'skip' };
  } else {
    const { error } = await db.from('chatbot_navigations').insert({ owner_id: ownerId, lead_id: leadId, ...fields });
    if (error) return { kind: 'skip' }; // outra mensagem do mesmo robô já abriu a navegação
  }

  const last = state.path[state.path.length - 1];
  if (last && (!prev || prev.path.length !== state.path.length)) {
    await log(db, ownerId, leadId, 'lead_updated', `Navegação: ${last.reason}. ${last.result}. (${STATUS_LABEL[state.status]}, etapa ${state.steps})`, { kind: 'menu_nav', status: state.status, step: state.steps, chosen: last.chosen ?? null });
  }
  return finish(db, ownerId, leadId, action, state, opts);
}

async function finish(db: Row, ownerId: string, leadId: string, action: Action, state: NavState, opts: { draftId: string; mode: NavMode }): Promise<NavOutcome> {
  if (action.type === 'pass') return { kind: 'pass' };
  if (action.type === 'wait') return { kind: 'skip' };
  const name = await companyName(db, leadId);
  if (action.type === 'block') {
    await upsertReplyTask(db, ownerId, leadId, {
      title: `Atendimento automático: ${name}`,
      description: `O BEELIE tentou passar pelo menu do WhatsApp e não chegou a uma pessoa (${action.reason}). Próximo passo: tentar por outro canal autorizado — telefone, e-mail ou Instagram — sem insistir no WhatsApp.`,
      dueAt: new Date(Date.now() + 2 * 864e5).toISOString(),
    });
    return { kind: 'skip' };
  }
  const template = action.template === 'menu' ? 'IA — resposta sugerida (menu)' : 'IA — resposta sugerida (abordagem humana)';
  await db.from('messages').update({ final_content: action.text, generated_content: action.text, template }).eq('id', opts.draftId).eq('owner_id', ownerId);
  if (opts.mode === 'supervisionado') {
    await upsertReplyTask(db, ownerId, leadId, {
      title: `Atendimento automático: ${name}`,
      description: `Modo supervisionado: o BEELIE sugere responder “${action.text}”. ${state.path[state.path.length - 1]?.reason ?? ''}. Abra o perfil do lead e envie a resposta pronta.`,
      dueAt: new Date().toISOString(),
    });
    return { kind: 'skip' };
  }
  return { kind: 'send', messageId: opts.draftId, body: action.text, template: action.template };
}

/** Tentativas paradas há 24 h sem resposta do atendimento: encerra como SEM_RESPOSTA e passa para você. */
export async function closeSilentNavigations(db: Row, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 864e5).toISOString();
  const { data } = await db
    .from('chatbot_navigations')
    .select('id, owner_id, lead_id, path, status')
    .is('closed_at', null)
    .in('status', ['MENU_DETECTADO', 'NAVEGANDO_MENU', 'AGUARDANDO_TRANSFERENCIA', 'ATENDIMENTO_HUMANO_PROVAVEL'])
    .lt('updated_at', cutoff)
    .limit(50);
  let n = 0;
  for (const r of (data ?? []) as Row[]) {
    const path = [...(r.path ?? []), { at: now.toISOString(), kind: 'bloqueio', reason: 'Sem resposta do atendimento em 24 h', result: 'Navegação encerrada' }];
    const { data: upd } = await db.from('chatbot_navigations').update({ status: 'SEM_RESPOSTA', path, next_action: 'Tentar contato por outro canal', closed_at: now.toISOString() }).eq('id', r.id).is('closed_at', null).select('id');
    if (!upd?.length) continue;
    n++;
    const name = await companyName(db, r.lead_id);
    await log(db, r.owner_id, r.lead_id, 'lead_updated', 'Navegação: o atendimento não respondeu em 24 h. Encerrada como sem resposta.', { kind: 'menu_nav', status: 'SEM_RESPOSTA' });
    await upsertReplyTask(db, r.owner_id, r.lead_id, { title: `Atendimento automático: ${name}`, description: `O atendimento do WhatsApp parou de responder durante a navegação (${r.status === 'AGUARDANDO_TRANSFERENCIA' ? 'aguardando transferência' : 'no menu'}). Tente por outro canal autorizado.`, dueAt: now.toISOString() });
  }
  return n;
}
