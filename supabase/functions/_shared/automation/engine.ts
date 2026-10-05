// Motor de automação no servidor (service role). Usado por cadence-runner, whatsapp-webhook e email-webhook.
// As decisões (o que fazer em cada etapa, como reagir a uma resposta) vêm dos mesmos módulos puros
// que o app usa no modo de teste: planner.ts e replies.ts.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PROMPT_VERSION } from '../ai/prompts.ts';
import { withDefaults } from '../ai/assistantDefaults.ts';
import { hasClaude, logRun, MODEL, runTask } from '../ai/claude.ts';
import { hasWhatsapp, sendWhatsapp, toE164Digits, waMeLink } from '../channels/metaWhatsapp.ts';
import { sendEmail } from '../channels/resend.ts';
import { nextDayWindow, plan, startOfDayBRT, type Effect, type PlanContext } from './planner.ts';
import { ADVANCED_STAGES, analyzeReplyRules, messageStage, normalizeAnalysis, parseSubject, renderTemplate, replyDecision, withOptOutFooter, type TemplateData } from './replies.ts';
import { DEFAULT_SEND_WINDOW, REPLY_CATEGORY_LABEL, type Cadence, type CadenceStep, type ContextField, type MessageDraft, type ReplyAnalysis, type SendChannel, type SendWindow } from './types.ts';

// deno-lint-ignore no-explicit-any
export type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export function adminClient(): Db {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.');
  return createClient(url, key, { auth: { persistSession: false } });
}

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
const sameDigits = (a?: string | null, b?: string | null) => {
  const x = digits(a);
  const y = digits(b);
  return !!x && !!y && (x === y || x.endsWith(y) || y.endsWith(x)) && Math.min(x.length, y.length) >= 10;
};
const nameOf = (c: Row) => c.trade_name ?? c.legal_name;

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export async function log(db: Db, ownerId: string, leadId: string, type: string, description: string, payload: Row = {}) {
  await db.from('lead_activities').insert({ owner_id: ownerId, lead_id: leadId, type, description, payload, actor_id: null });
}

async function createTask(db: Db, ownerId: string, t: { leadId?: string; campaignId?: string; title: string; description?: string; ownerName?: string; dueAt?: string; source: string; actionUrl?: string }) {
  await db.from('tasks').insert({
    owner_id: ownerId,
    lead_id: t.leadId ?? null,
    campaign_id: t.campaignId ?? null,
    title: t.title,
    description: t.description ?? null,
    owner_name: t.ownerName ?? null,
    due_at: t.dueAt ?? null,
    source: t.source,
    action_url: t.actionUrl ?? null,
  });
  if (t.leadId) await log(db, ownerId, t.leadId, 'task_created', `Tarefa criada: ${t.title}${t.ownerName ? ` (para ${t.ownerName})` : ''}`);
}

async function setStage(db: Db, leadId: string, stage: string) {
  // O trigger log_stage_change grava a atividade.
  await db.from('leads').update({ stage }).eq('id', leadId);
}

function isSuppressed(supp: Row[], company: Row, lead: Row): boolean {
  return supp.some(
    (s) =>
      (s.kind === 'phone' && (sameDigits(s.value, company.whatsapp) || sameDigits(s.value, company.phone))) ||
      (s.kind === 'email' && lead.email && s.value.toLowerCase() === String(lead.email).toLowerCase()) ||
      (s.kind === 'cnpj' && company.cnpj && digits(s.value) === digits(company.cnpj)),
  );
}

function companyForAI(c: Row) {
  return {
    legalName: c.legal_name,
    tradeName: c.trade_name,
    segment: c.segment,
    city: c.city,
    state: c.state,
    website: c.website,
    instagram: c.instagram,
    linkedin: c.linkedin,
    employeesRange: c.employees_range,
    companySize: c.company_size,
    cnae: c.cnae,
    fieldProvenance: c.field_provenance,
  };
}

function leadContext(c: Row, lead: Row): ContextField[] {
  const f: ContextField[] = [];
  const add = (field: string, label: string, value?: string | null) => value && f.push({ field, label, value: String(value) });
  add('empresa', 'Empresa', nameOf(c));
  add('segmento', 'Segmento', c.segment);
  add('cidade', 'Cidade', c.city && `${c.city}/${c.state}`);
  add('site', 'Site', c.website);
  add('nome', 'Contato', lead.contact_name);
  add('cargo', 'Cargo', lead.contact_role);
  return f;
}

function templateData(lead: Row, c: Row, p: Row): TemplateData {
  return {
    empresa: nameOf(c),
    nome: lead.contact_name?.split(' ')[0] || undefined,
    cargo: lead.contact_role || undefined,
    cidade: c.city,
    estado: c.state,
    segmento: String(c.segment ?? '').toLowerCase(),
    site: c.website || undefined,
    remetente: p.full_name || undefined,
    minha_empresa: p.company_name || undefined,
    oferta: p.offer || undefined,
  };
}

/** Mesmo comportamento de AutomationService.compose no app. */
/** Mensagens já enviadas e notas do lead: o follow-up continua a conversa em vez de repetir. */
async function conversationContext(db: Db, lead: Row) {
  const [{ data: msgs }, { data: notes }] = await Promise.all([
    db.from('messages').select('channel, final_content, sent_at').eq('lead_id', lead.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(4),
    db.from('lead_notes').select('body').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(3),
  ]);
  const history = ((msgs ?? []) as Row[]).reverse().map((m) => ({
    channel: m.channel === 'whatsapp' ? 'WhatsApp' : m.channel === 'email' ? 'E-mail' : 'LinkedIn',
    date: new Date(m.sent_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    text: String(m.final_content).slice(0, 600),
  }));
  const days = lead.last_contact_at ? Math.max(0, Math.floor((Date.now() - new Date(lead.last_contact_at).getTime()) / 864e5)) : undefined;
  return { history, daysSinceLastContact: days, notes: ((notes ?? []) as Row[]).map((n) => String(n.body)) };
}

async function compose(db: Db, ownerId: string, lead: Row, c: Row, p: Row, cad: Cadence, stepIndex: number, campaignName?: string): Promise<MessageDraft> {
  const step = cad.steps[stepIndex] as Extract<CadenceStep, { type: 'send' }>;
  const stage = messageStage(cad.steps, stepIndex);
  const at = new Date().toISOString();
  const data = templateData(lead, c, p);
  if (step.mode === 'template' && step.template.trim()) {
    const body = renderTemplate(step.template, data);
    return {
      channel: step.channel,
      subject: step.subject ? renderTemplate(step.subject, data).text : undefined,
      body: step.channel === 'email' ? withOptOutFooter(body.text) : body.text,
      context: body.context,
      model: 'template',
      template: step.whatsappTemplate || step.label || 'Template',
      editedByUser: false,
      generatedAt: at,
    };
  }
  if (!hasClaude()) throw new Error('Etapa com IA, mas ANTHROPIC_API_KEY não está configurada.');
  const started = Date.now();
  let raw: string;
  try {
    const run = await runTask<string>('generateApproach', {
      company: companyForAI(c),
      channel: step.channel,
      options: {
        variant: 0,
        senderName: p.full_name,
        senderCompany: p.company_name,
        offer: p.offer,
        contactName: lead.contact_name,
        contactRole: lead.contact_role,
        stage,
        instructions: step.template || undefined,
        ...(await conversationContext(db, lead)),
        campaignName,
      },
    });
    raw = run.output;
    await logRun(db, ownerId, 'generateApproach', started, 'ok', run.usage);
  } catch (e) {
    await logRun(db, ownerId, 'generateApproach', started, 'error', {});
    throw e;
  }
  const parsed = parseSubject(raw);
  let body = parsed.body;
  if (step.channel === 'email') {
    if (p.signature && !body.includes(p.signature)) body = `${body}\n\n${p.signature}`;
    body = withOptOutFooter(body);
  }
  return {
    channel: step.channel,
    subject: parsed.subject ?? (step.subject ? renderTemplate(step.subject, data).text : undefined),
    body,
    context: leadContext(c, lead),
    model: MODEL,
    template: step.whatsappTemplate ? `IA + template Meta “${step.whatsappTemplate}”` : `IA — ${stage === 'primeira' ? 'mensagem inicial' : stage === 'ultimo' ? 'último contato' : 'acompanhamento'}`,
    editedByUser: false,
    generatedAt: at,
  };
}

// ---------- Executor de cadências ----------

export interface RunSummary {
  activated: number;
  processed: number;
  sent: number;
  failed: number;
  finished: number;
  errors: string[];
}

export async function runDue(db: Db, limit = 50): Promise<RunSummary> {
  const now = new Date();
  const sum: RunSummary = { activated: 0, processed: 0, sent: 0, failed: 0, finished: 0, errors: [] };

  // Campanhas agendadas que chegaram na hora.
  const scheduled: Row[] = await must(db.from('campaigns').select('id').eq('status', 'agendada').lte('scheduled_at', now.toISOString()));
  for (const c of scheduled) {
    await db.from('campaigns').update({ status: 'ativa', started_at: now.toISOString() }).eq('id', c.id);
    sum.activated++;
  }

  const due: Row[] = await must(
    db
      .from('enrollments')
      .select('*, campaigns!inner(id, name, status, owner_name, daily_limit_email, daily_limit_whatsapp, auto_enroll), leads!inner(current_score)')
      .eq('status', 'ativa')
      .eq('campaigns.status', 'ativa')
      .lte('next_run_at', now.toISOString())
      .order('next_run_at')
      .limit(limit),
  );

  // Melhores leads primeiro: com limite diário, são eles que usam a cota do dia.
  due.sort((a, b) => (b.leads?.current_score ?? 0) - (a.leads?.current_score ?? 0));
  const touched = new Map<string, boolean>(); // campanha → entrada automática
  for (const e of due) {
    // Trava otimista: só uma execução pega cada inscrição.
    const claimed: Row[] = await must(db.from('enrollments').update({ next_run_at: null }).eq('id', e.id).eq('next_run_at', e.next_run_at).select('id'));
    if (!claimed.length) continue;
    touched.set(e.campaign_id, !!e.campaigns?.auto_enroll);
    try {
      const r = await runEnrollment(db, e, e.campaigns);
      sum.sent += r.sent;
      sum.failed += r.failed;
      sum.processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sum.errors.push(`${e.id}: ${msg}`);
      // Tenta de novo em 1 h, sem perder a etapa.
      await db.from('enrollments').update({ next_run_at: new Date(Date.now() + 3600_000).toISOString() }).eq('id', e.id);
    }
  }

  // Campanha sem ninguém ativo termina sozinha (exceto com entrada automática: novos leads ainda podem chegar).
  for (const [id, autoEnroll] of touched) {
    if (autoEnroll) continue;
    const es: Row[] = await must(db.from('enrollments').select('status').eq('campaign_id', id));
    if (es.length && es.every((x) => x.status === 'concluida' || x.status === 'interrompida')) {
      await db.from('campaigns').update({ status: 'finalizada', finished_at: new Date().toISOString() }).eq('id', id);
      sum.finished++;
    }
  }
  return sum;
}

async function runEnrollment(db: Db, e: Row, camp: Row): Promise<{ sent: number; failed: number }> {
  const owner = e.owner_id as string;
  const [lead, cadRow, profile] = await Promise.all([
    must<Row | null>(db.from('leads').select('*').eq('id', e.lead_id).maybeSingle()),
    must<Row | null>(db.from('cadences').select('*').eq('id', e.cadence_id).maybeSingle()),
    must<Row | null>(db.from('profiles').select('*').eq('id', owner).maybeSingle()),
  ]);
  const company: Row | null = lead ? await must(db.from('companies').select('*').eq('id', lead.company_id).maybeSingle()) : null;
  if (!lead || !cadRow || !company) {
    await db.from('enrollments').update({ status: 'interrompida', stop_reason: 'Lead ou cadência não existe mais.' }).eq('id', e.id);
    return { sent: 0, failed: 0 };
  }
  const cad: Cadence = { id: cadRow.id, name: cadRow.name, stopOnReply: cadRow.stop_on_reply, steps: cadRow.steps ?? [], createdAt: cadRow.created_at, updatedAt: cadRow.updated_at };
  const p = profile ?? {};

  const [supp, replies, msgs] = await Promise.all([
    must<Row[]>(db.from('suppression_list').select('kind, value').eq('owner_id', owner)),
    must<Row[]>(db.from('inbound_messages').select('classification, received_at').eq('lead_id', lead.id).gte('received_at', e.started_at ?? e.created_at)),
    must<Row[]>(db.from('messages').select('status').eq('enrollment_id', e.id)),
  ]);
  const real = replies.filter((r) => r.classification !== 'ausente');
  const ctx: PlanContext = {
    now: new Date(),
    replied: real.length > 0,
    interested: real.some((r) => r.classification === 'interessado' || r.classification === 'reuniao'),
    read: msgs.some((m) => m.status === 'read' || m.status === 'replied'),
    suppressed: isSuppressed(supp, company, lead),
    hasWhatsapp: !!company.whatsapp,
    hasWhatsappConsent: !!lead.whatsapp_consent_at,
    // WhatsApp sem API por padrão: a etapa vira tarefa com wa.me. A API oficial (Meta) só é usada
    // se WHATSAPP_AUTO=true e as credenciais estiverem configuradas.
    whatsappAuto: Deno.env.get('WHATSAPP_AUTO') === 'true' && hasWhatsapp(),
    closed: ['cliente', 'nao_interessado'].includes(lead.stage),
    hasEmail: !!lead.email,
    window: (p.send_window as SendWindow) ?? DEFAULT_SEND_WINDOW,
  };

  const result = plan(cad, e.step_index, ctx);

  // Limite diário da campanha: sem cota hoje, a etapa fica para a primeira janela de amanhã.
  const send = result.effects.find((x) => x.kind === 'send' || x.kind === 'manual_whatsapp');
  if (send && 'step' in send) {
    const limit = send.step.channel === 'email' ? camp?.daily_limit_email : camp?.daily_limit_whatsapp;
    if (limit) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', e.campaign_id)
        .eq('channel', send.step.channel)
        .gte('created_at', startOfDayBRT(new Date()).toISOString());
      if ((count ?? 0) >= limit) {
        await db.from('enrollments').update({ next_run_at: nextDayWindow(new Date(), ctx.window).toISOString() }).eq('id', e.id);
        return { sent: 0, failed: 0 };
      }
    }
  }

  let sent = 0;
  let failed = 0;
  for (const eff of result.effects) {
    const r = await applyEffect(db, eff, e, camp, lead, company, p, cad);
    if (r === 'sent') sent++;
    if (r === 'failed') failed++;
  }

  await db
    .from('enrollments')
    .update({ step_index: result.stepIndex, status: result.status, next_run_at: result.nextRunAt?.toISOString() ?? null, last_step_at: new Date().toISOString(), stop_reason: result.stopReason ?? null })
    .eq('id', e.id);

  if (result.status === 'concluida') {
    await log(db, owner, lead.id, 'cadence_completed', 'Cadência concluída sem resposta', { enrollmentId: e.id });
    const { data: fresh } = await db.from('leads').select('stage').eq('id', lead.id).maybeSingle();
    if (fresh && (fresh.stage === 'em_cadencia' || fresh.stage === 'contatado')) await setStage(db, lead.id, 'sem_resposta');
  } else if (result.status === 'interrompida' && result.stopReason) {
    await log(db, owner, lead.id, 'cadence_stopped', `Cadência encerrada: ${result.stopReason}`, { enrollmentId: e.id });
  } else if (result.nextRunAt) {
    const when = result.nextRunAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await log(db, owner, lead.id, 'cadence_step', `Próxima etapa em ${when}`, { enrollmentId: e.id, stepIndex: result.stepIndex });
  }
  return { sent, failed };
}

async function applyEffect(db: Db, eff: Effect, e: Row, camp: Row, lead: Row, c: Row, p: Row, cad: Cadence): Promise<'sent' | 'failed' | 'other'> {
  const owner = e.owner_id as string;
  if (eff.kind === 'skipped') {
    await log(db, owner, lead.id, 'cadence_step', `Etapa ${eff.stepIndex + 1} pulada: ${eff.reason}`, { enrollmentId: e.id });
    return 'other';
  }
  if (eff.kind === 'task') {
    await createTask(db, owner, { leadId: lead.id, campaignId: e.campaign_id, title: eff.title, source: 'cadencia', ownerName: camp?.owner_name });
    return 'other';
  }
  if (eff.kind === 'stage') {
    await setStage(db, lead.id, eff.stage);
    return 'other';
  }

  // Envio: usa a mensagem revisada na preparação (primeiro envio) ou compõe agora.
  const firstSend = cad.steps.findIndex((s) => s.type === 'send');
  const draft: MessageDraft =
    eff.stepIndex === firstSend && e.draft && e.draft.channel === eff.step.channel ? e.draft : await compose(db, owner, lead, c, p, cad, eff.stepIndex, camp?.name);
  const channel: SendChannel = eff.step.channel;
  const sender = channel === 'email' ? p.sender_email || Deno.env.get('EMAIL_FROM_FALLBACK') || null : null;
  const recipient = channel === 'email' ? lead.email : toE164Digits(c.whatsapp ?? '');
  const base = {
    owner_id: owner,
    lead_id: lead.id,
    channel,
    generated_content: draft.body,
    final_content: draft.body,
    model: draft.model,
    prompt_version: PROMPT_VERSION,
    campaign_id: e.campaign_id,
    enrollment_id: e.id,
    step_index: eff.stepIndex,
    subject: draft.subject ?? null,
    sender,
    recipient,
    template: draft.template,
    context: draft.context,
  };

  if (eff.kind === 'manual_whatsapp') {
    await db.from('messages').insert({ ...base, status: 'draft', template: `${draft.template} (envio manual)` });
    await createTask(db, owner, {
      leadId: lead.id,
      campaignId: e.campaign_id,
      title: `Enviar WhatsApp para ${nameOf(c)}`,
      description: 'Mensagem pronta. Revise, abra o WhatsApp pelo link, envie e clique em “Marcar como enviado”.',
      source: 'cadencia',
      ownerName: camp?.owner_name,
      actionUrl: waMeLink(c.whatsapp, draft.body),
    });
    return 'other';
  }

  const msg: Row = await must(db.from('messages').insert({ ...base, status: 'queued' }).select('id').single());
  try {
    let r: { externalId: string; provider: string };
    if (channel === 'whatsapp') {
      // Texto livre só dentro de 24 h da última mensagem do contato; fora disso, template aprovado.
      if (!eff.step.whatsappTemplate) {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { data: recent } = await db.from('inbound_messages').select('id').eq('lead_id', lead.id).eq('channel', 'whatsapp').gte('received_at', since).limit(1);
        if (!recent?.length) throw new Error('Fora da janela de 24 h do WhatsApp: informe na etapa um template aprovado pela Meta.');
      }
      r = await sendWhatsapp({ to: c.whatsapp, text: draft.body, templateName: eff.step.whatsappTemplate });
    } else {
      if (!sender) throw new Error('Remetente de e-mail não configurado (Configurações → Envio).');
      r = await sendEmail({ from: sender, fromName: p.full_name || p.company_name || undefined, to: lead.email, subject: draft.subject || `Contato — ${p.company_name ?? ''}`.trim(), text: draft.body });
    }
    const sentAt = new Date().toISOString();
    await db.from('messages').update({ status: 'sent', external_id: r.externalId, provider: r.provider, sent_at: sentAt }).eq('id', msg.id);
    await db.from('leads').update({ last_contact_at: sentAt }).eq('id', lead.id);
    await log(db, owner, lead.id, 'message_sent', `${channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} enviado${camp?.name ? ` (${camp.name})` : ''}`, { messageId: msg.id, channel, provider: r.provider });
    return 'sent';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.from('messages').update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: reason }).eq('id', msg.id);
    await log(db, owner, lead.id, 'message_failed', `Falha no envio de ${channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'}: ${reason}`, { messageId: msg.id });
    return 'failed';
  }
}

// ---------- Status de entrega (webhooks) ----------

const ORDER = ['queued', 'sent', 'delivered', 'read', 'replied'];

/** Atualiza o status de uma mensagem pelo ID do provedor, sem regredir (lido não volta a entregue). */
export async function updateDelivery(db: Db, provider: string, externalId: string, status: 'sent' | 'delivered' | 'read' | 'failed', at: string, reason?: string) {
  const { data: m } = await db.from('messages').select('id, owner_id, lead_id, channel, status').eq('provider', provider).eq('external_id', externalId).maybeSingle();
  if (!m) return false;
  if (status === 'failed') {
    await db.from('messages').update({ status: 'failed', failed_at: at, failure_reason: reason ?? 'Falha informada pelo provedor' }).eq('id', m.id);
    await log(db, m.owner_id, m.lead_id, 'message_failed', `${m.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} não entregue: ${reason ?? 'falha no provedor'}`, { messageId: m.id });
    return true;
  }
  if (m.status === 'failed' || ORDER.indexOf(status) <= ORDER.indexOf(m.status)) return true;
  const patch: Row = { status };
  if (status === 'delivered') patch.delivered_at = at;
  if (status === 'read') patch.read_at = at;
  await db.from('messages').update(patch).eq('id', m.id);
  return true;
}

// ---------- Respostas recebidas ----------

/** Encontra o lead pelo destinatário da última mensagem enviada (é quem está respondendo). */
export async function findLeadByRecipient(db: Db, channel: SendChannel, address: string): Promise<{ ownerId: string; leadId: string } | null> {
  const key = channel === 'email' ? address.trim().toLowerCase() : toE164Digits(address);
  const q = db.from('messages').select('owner_id, lead_id').eq('channel', channel).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
  const { data } = channel === 'email' ? await q.ilike('recipient', key) : await q.eq('recipient', key);
  if (data?.[0]) return { ownerId: data[0].owner_id, leadId: data[0].lead_id };
  if (channel === 'email') {
    const { data: leads } = await db.from('leads').select('id, owner_id').ilike('email', key).limit(1);
    if (leads?.[0]) return { ownerId: leads[0].owner_id, leadId: leads[0].id };
  }
  return null;
}

/** Categorias em que a IA não sugere resposta (o lead pediu para parar ou é resposta automática). */
const NO_SUGGESTION = new Set(['sem_contato', 'ausente']);

/**
 * Sugestão de resposta da IA para o vendedor revisar (nunca é enviada sozinha).
 * Objetivo: aquecer o lead e marcar uma conversa rápida. Grava como mensagem "draft".
 */
export interface ReplySuggestionDraft {
  id: string;
  body: string;
  intent: string;
  note: string;
}

async function suggestReplyDraft(db: Db, ownerId: string, lead: Row, company: Row, channel: SendChannel, category: string, campaignId?: string | null): Promise<ReplySuggestionDraft | null> {
  if (!hasClaude() || NO_SUGGESTION.has(category)) return null;
  const [{ data: sent }, { data: inb }, { data: p }] = await Promise.all([
    db.from('messages').select('final_content, sent_at, updated_at, status').eq('lead_id', lead.id).eq('channel', channel).order('created_at', { ascending: false }).limit(10),
    db.from('inbound_messages').select('body, received_at').eq('lead_id', lead.id).eq('channel', channel).order('received_at', { ascending: false }).limit(10),
    db.from('profiles').select('full_name, company_name, offer').eq('id', ownerId).maybeSingle(),
  ]);
  // Persona e base de conhecimento do usuário; sem tabela ou sem linha, usa o padrão.
  const { data: cfg } = await db.from('assistant_settings').select('name, persona, knowledge, playbooks').eq('owner_id', ownerId).maybeSingle().then(
    (r: { data: Row | null }) => r,
    () => ({ data: null }),
  );
  const assistant = withDefaults(cfg);
  const day = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const out = ((sent ?? []) as Row[])
    .filter((m) => m.sent_at || m.status === 'opened_whatsapp')
    .map((m) => ({ from: 'vendedor' as const, at: String(m.sent_at ?? m.updated_at), text: String(m.final_content ?? '').slice(0, 800) }));
  const ins = ((inb ?? []) as Row[]).map((r) => ({ from: 'lead' as const, at: String(r.received_at), text: String(r.body ?? '').slice(0, 800) }));
  const conversation = [...out, ...ins].sort((a, b) => a.at.localeCompare(b.at)).slice(-12).map((m) => ({ from: m.from, date: day(m.at), text: m.text }));
  if (!conversation.length || conversation[conversation.length - 1].from !== 'lead') return null;

  const started = Date.now();
  try {
    const run = await runTask<{ message: string; intent: string; note: string }>('suggestReply', {
      channel,
      category,
      sender: { name: p?.full_name, company: p?.company_name, offer: p?.offer },
      contact: { name: lead.contact_name, role: lead.contact_role },
      company: companyForAI(company),
      conversation,
      assistant,
    });
    await logRun(db, ownerId, 'suggestReply', started, 'ok', run.usage);
    const body = run.output.message?.trim();
    if (!body) return null;
    // Uma sugestão por vez: a anterior, se não foi enviada, é substituída.
    await db.from('messages').delete().eq('lead_id', lead.id).eq('channel', channel).eq('status', 'draft').like('template', 'IA — resposta sugerida%');
    const ins: Row = await must(db.from('messages').insert({
      owner_id: ownerId,
      lead_id: lead.id,
      channel,
      generated_content: body,
      final_content: body,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      campaign_id: campaignId ?? null,
      recipient: channel === 'email' ? lead.email : toE164Digits(company.whatsapp ?? ''),
      template: `IA — resposta sugerida (${run.output.intent})`,
      context: [],
      status: 'draft',
    }).select('id').single());
    return { id: ins.id, body, intent: run.output.intent, note: run.output.note ?? '' };
  } catch (err) {
    await logRun(db, ownerId, 'suggestReply', started, 'error', {});
    console.error('suggestReply', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Mesmo comportamento de AutomationService.receiveReply no app. */
export async function handleInbound(db: Db, i: { ownerId: string; leadId: string; channel: SendChannel; from: string; body: string; externalId?: string; receivedAt?: string }) {
  const text = i.body.trim();
  if (!text) return null;
  if (i.externalId) {
    const { data: dup } = await db.from('inbound_messages').select('id').eq('owner_id', i.ownerId).eq('channel', i.channel).eq('external_id', i.externalId).maybeSingle();
    if (dup) return dup; // webhook repetido
  }
  const lead: Row = await must(db.from('leads').select('*').eq('id', i.leadId).single());
  const company: Row = await must(db.from('companies').select('*').eq('id', lead.company_id).single());
  const name = nameOf(company);

  let cls: ReplyAnalysis = analyzeReplyRules(text);
  if (hasClaude()) {
    const started = Date.now();
    try {
      const run = await runTask<Partial<ReplyAnalysis>>('classifyReply', { text, context: `Empresa ${name}, etapa atual: ${lead.stage}` });
      cls = normalizeAnalysis(run.output, text);
      await logRun(db, i.ownerId, 'classifyReply', started, 'ok', run.usage);
    } catch {
      await logRun(db, i.ownerId, 'classifyReply', started, 'error', {});
    }
  }

  const active: Row[] = await must(db.from('enrollments').select('id, status, campaign_id').eq('lead_id', lead.id).in('status', ['ativa', 'pausada']));
  const enr = active[0];
  const camp: Row | null = enr ? await must(db.from('campaigns').select('id, owner_name').eq('id', enr.campaign_id).maybeSingle()) : null;
  const at = i.receivedAt ?? new Date().toISOString();

  const inbound = await must(
    db
      .from('inbound_messages')
      .insert({
        owner_id: i.ownerId,
        lead_id: lead.id,
        channel: i.channel,
        from_address: i.from,
        body: text,
        received_at: at,
        external_id: i.externalId ?? null,
        campaign_id: enr?.campaign_id ?? null,
        enrollment_id: enr?.id ?? null,
        classification: cls.classification,
        confidence: cls.confidence,
        summary: cls.summary,
      })
      .select('id')
      .single(),
  );

  const { data: last } = await db.from('messages').select('id').eq('lead_id', lead.id).eq('channel', i.channel).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
  if (last?.[0]) await db.from('messages').update({ status: 'replied', replied_at: at }).eq('id', last[0].id);
  // Próxima ação sugerida pela IA; "falar depois" agenda a data de retorno.
  const next: Row = {};
  if (cls.category !== 'ausente') {
    next.next_action = cls.suggestedAction;
    next.next_action_at =
      cls.category === 'sem_contato' || cls.category === 'nao_interessado'
        ? null
        : cls.category === 'posteriormente'
          ? new Date(Date.now() + (cls.followUpDays ?? 30) * 864e5).toISOString()
          : at;
  }
  await db.from('leads').update({ last_contact_at: at, ...next }).eq('id', lead.id);
  const inboundId = (inbound as Row).id;
  await log(db, i.ownerId, lead.id, 'reply_received', `Resposta recebida (${i.channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'})`, { inboundId });
  await log(db, i.ownerId, lead.id, 'reply_classified', `IA classificou como “${REPLY_CATEGORY_LABEL[cls.category]}”`, {
    inboundId,
    category: cls.category,
    classification: cls.classification,
    confidence: cls.confidence,
    summary: cls.summary,
    suggestedAction: cls.suggestedAction,
  });

  const d = replyDecision(cls.category, name);
  if (d.suppress) {
    const reason = `Pediu para não receber mensagens (${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`;
    const rows: Row[] = [];
    if (company.whatsapp) rows.push({ owner_id: i.ownerId, kind: 'phone', value: company.whatsapp, reason });
    if (company.phone && !sameDigits(company.phone, company.whatsapp)) rows.push({ owner_id: i.ownerId, kind: 'phone', value: company.phone, reason });
    if (lead.email && i.channel === 'email') rows.push({ owner_id: i.ownerId, kind: 'email', value: String(lead.email).toLowerCase(), reason });
    if (rows.length) await db.from('suppression_list').upsert(rows, { onConflict: 'owner_id,kind,value', ignoreDuplicates: true });
  }
  for (const e of active) {
    if (d.enrollments === 'stop') await db.from('enrollments').update({ status: 'interrompida', stop_reason: d.reason, next_run_at: null }).eq('id', e.id);
    if (d.enrollments === 'pause' && e.status === 'ativa') await db.from('enrollments').update({ status: 'pausada', stop_reason: d.reason }).eq('id', e.id);
    if (d.enrollments !== 'none') {
      const verb = d.enrollments === 'stop' ? 'cadence_stopped' : 'cadence_paused';
      await log(db, i.ownerId, lead.id, verb, `Cadência ${d.enrollments === 'stop' ? 'encerrada' : 'pausada'}: ${d.reason}`, { enrollmentId: e.id });
    }
  }
  if (d.stage && lead.stage !== d.stage.to && (d.stage.force || !ADVANCED_STAGES.includes(lead.stage))) await setStage(db, lead.id, d.stage.to);
  const suggestion = d.suppress ? null : await suggestReplyDraft(db, i.ownerId, lead, company, i.channel, cls.category, camp?.id);
  if (suggestion) await log(db, i.ownerId, lead.id, 'message_generated', 'IA sugeriu uma resposta', { kind: 'reply_suggestion', messageId: suggestion.id, note: suggestion.note, intent: suggestion.intent });
  if (d.task) {
    const extra = suggestion ? ` Resposta da IA pronta no perfil do lead (Gerar abordagem).${suggestion.note ? ` ${suggestion.note}` : ''}` : '';
    await createTask(db, i.ownerId, { leadId: lead.id, campaignId: camp?.id, title: d.task.title, description: `${d.task.description ?? ''}${extra}`.trim(), source: 'resposta', ownerName: camp?.owner_name ?? lead.owner_name, dueAt: at });
  }
  return { ...(inbound as Row), suggestion, category: cls.category };
}
