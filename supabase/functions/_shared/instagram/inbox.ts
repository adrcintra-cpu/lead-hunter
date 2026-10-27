// Instagram Agent — Inbox (Direct): receber, sugerir resposta com o BEELIE, enviar aprovado,
// passar para humano e registrar no CRM. Só pela API oficial (Messenger Platform para Instagram).
//
// Regras da Meta respeitadas aqui:
// - Só responde quem escreveu: texto livre dentro de 24 h da última mensagem da pessoa.
// - Texto de até 1000 bytes (UTF-8).
// - Nunca inicia conversa.

import { withDefaults } from '../ai/assistantDefaults.ts';
import type { MetaConfig, Fetch } from './graph.ts';
import { graph, MetaError } from './graph.ts';
import { logOp } from './accounts.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const WINDOW_MS = 24 * 3600_000;
export const MAX_BYTES = 1000;
export const IG_ORIGIN = 'Instagram (Direct)';

export interface IgEvent {
  igId: string; // conta profissional (entry.id)
  senderId: string;
  recipientId: string;
  mid: string;
  text: string;
  attachments: { type: string; url: string | null }[];
  timestamp: number;
  echo: boolean;
  deleted: boolean;
}

export interface ReplyAnalysis {
  message: string;
  classification: 'interessado' | 'reuniao' | 'duvida' | 'suporte' | 'nao_interessado' | 'opt_out' | 'outro';
  qualified: boolean;
  needsHuman: boolean;
  humanReason: string | null;
  summary: string;
  nextStep: string;
  contact: { name: string | null; company: string | null; phone: string | null; email: string | null; city: string | null; state: string | null; segment: string | null };
}

export interface Deps {
  fetchImpl?: Fetch;
  openToken: (sealed: string) => Promise<string>;
  runTask: (input: unknown) => Promise<{ output: ReplyAnalysis; usage: { input_tokens?: number; output_tokens?: number } }>;
  logRun: (ownerId: string, started: number, status: 'ok' | 'error', usage: { input_tokens?: number; output_tokens?: number }) => Promise<void>;
}

// ---------- webhook ----------

/** Confere o X-Hub-Signature-256 (HMAC-SHA256 do corpo com o App Secret). */
export async function verifyMetaSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  const sig = (header ?? '').replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/i.test(sig) || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  let d = 0;
  for (let i = 0; i < 64; i++) d |= hex.charCodeAt(i) ^ sig.toLowerCase().charCodeAt(i);
  return d === 0;
}

/** Mensagens do webhook (object "instagram"). Reações, "visto" e afins são ignorados. */
export function parseEvents(body: unknown): IgEvent[] {
  const b = body as Row;
  if (!b || b.object !== 'instagram' || !Array.isArray(b.entry)) return [];
  const out: IgEvent[] = [];
  for (const e of b.entry as Row[]) {
    for (const m of (Array.isArray(e.messaging) ? e.messaging : []) as Row[]) {
      const msg = m.message as Row | undefined;
      if (!msg?.mid || !m.sender?.id || !m.recipient?.id) continue;
      if (msg.is_unsupported) continue;
      const attachments = (Array.isArray(msg.attachments) ? msg.attachments : []).map((a: Row) => ({ type: String(a.type ?? 'arquivo'), url: typeof a.payload?.url === 'string' ? a.payload.url : null }));
      out.push({
        igId: String(e.id),
        senderId: String(m.sender.id),
        recipientId: String(m.recipient.id),
        mid: String(msg.mid),
        text: typeof msg.text === 'string' ? msg.text.slice(0, 4000) : '',
        attachments,
        timestamp: Number(m.timestamp) || Date.now(),
        echo: msg.is_echo === true,
        deleted: msg.is_deleted === true,
      });
    }
  }
  return out;
}

const ATT_LABEL: Record<string, string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', file: 'Arquivo', share: 'Post compartilhado', story_mention: 'Menção no story', ig_reel: 'Reel', reel: 'Reel' };

/** Texto da mensagem para a conversa (anexos viram marcação que a IA entende). */
export function messageText(ev: Pick<IgEvent, 'text' | 'attachments'>): string {
  const att = ev.attachments.map((a) => `[${ATT_LABEL[a.type] ?? 'Mídia'}]`).join(' ');
  return [ev.text.trim(), att].filter(Boolean).join(' ') || '[Mídia]';
}

export function windowOpen(lastInboundAt: string | null | undefined, now = new Date()): boolean {
  return !!lastInboundAt && now.getTime() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function settingsOf(db: Db, ownerId: string): Promise<Row | null> {
  const { data } = await db.from('instagram_settings').select('enabled, mode, auto_reply, persona_extra, handoff_rules, daily_ai_limit, account_id').eq('owner_id', ownerId).maybeSingle();
  return data ?? null;
}

export interface Ingested {
  ownerId: string;
  accountId: string;
  conversationId: string;
  inbound: boolean;
}

/**
 * Grava uma mensagem do webhook. Devolve null quando a conta não está conectada, o módulo está
 * desligado, a mensagem é repetida (a Meta reenvia) ou foi apagada.
 */
export async function ingest(db: Db, cfg: MetaConfig, ev: IgEvent, deps: Pick<Deps, 'fetchImpl' | 'openToken'>, now = new Date()): Promise<Ingested | null> {
  const { data: acc } = await db.from('instagram_accounts').select('id, owner_id, page_id, status').eq('ig_user_id', ev.igId).eq('status', 'conectado').maybeSingle();
  if (!acc) return null;
  const ownerId = acc.owner_id as string;
  const s = await settingsOf(db, ownerId);
  if (!s?.enabled) return null; // módulo desligado: não lê nem guarda nada
  if (ev.deleted) return null;

  const igsid = ev.echo ? ev.recipientId : ev.senderId;
  if (igsid === ev.igId) return null;
  let { data: conv } = await db.from('instagram_conversations').select('id, status, classification').eq('account_id', acc.id).eq('igsid', igsid).maybeSingle();
  if (!conv) {
    const prof = await profileOf(db, cfg, acc.id, igsid, deps).catch(() => null);
    const { data: created } = await db
      .from('instagram_conversations')
      .upsert({ owner_id: ownerId, account_id: acc.id, igsid, username: prof?.username ?? null, name: prof?.name ?? null }, { onConflict: 'account_id,igsid' })
      .select('id, status, classification')
      .single();
    conv = created;
  }
  if (!conv) return null;

  const at = new Date(ev.timestamp > 1e12 ? ev.timestamp : ev.timestamp * 1000 || now.getTime()).toISOString();
  // Eco do que o próprio OxyHub acabou de enviar (pode chegar antes de gravarmos o id da Meta).
  if (ev.echo) {
    const since = new Date(now.getTime() - 3 * 60_000).toISOString();
    const { data: mine } = await db.from('instagram_messages').select('id, external_id').eq('conversation_id', conv.id).eq('direction', 'saida').in('status', ['aprovada', 'enviada']).eq('body', messageText(ev)).gte('created_at', since).limit(1);
    if (mine?.length) return null;
  }
  const { error } = await db.from('instagram_messages').insert({
    owner_id: ownerId,
    conversation_id: conv.id,
    direction: ev.echo ? 'saida' : 'entrada',
    body: messageText(ev),
    attachments: ev.attachments.length ? ev.attachments : null,
    status: ev.echo ? 'enviada' : 'recebida',
    external_id: ev.mid,
    created_at: at,
  });
  if (error) return null; // repetida (mesmo mid) ou já gravada pelo envio do OxyHub

  const patch: Row = { last_message_at: at };
  if (!ev.echo) {
    patch.last_inbound_at = at;
    // Quem pediu para parar não é reaberto automaticamente.
    if (conv.status === 'encerrada' && conv.classification !== 'opt_out') patch.status = 'aberta';
  }
  await db.from('instagram_conversations').update(patch).eq('id', conv.id);
  return { ownerId, accountId: acc.id, conversationId: conv.id, inbound: !ev.echo };
}

async function pageAccess(db: Db, accountId: string, deps: Pick<Deps, 'openToken'>): Promise<{ pageId: string; token: string; igId: string } | null> {
  const [{ data: acc }, { data: tok }] = await Promise.all([
    db.from('instagram_accounts').select('page_id, ig_user_id').eq('id', accountId).maybeSingle(),
    db.from('instagram_tokens').select('token_enc').eq('account_id', accountId).maybeSingle(),
  ]);
  if (!acc?.page_id || !tok?.token_enc) return null;
  return { pageId: acc.page_id, igId: acc.ig_user_id, token: await deps.openToken(tok.token_enc) };
}

/** Nome e @ de quem escreveu (perfil do usuário do Instagram, pela API oficial). */
async function profileOf(db: Db, cfg: MetaConfig, accountId: string, igsid: string, deps: Pick<Deps, 'fetchImpl' | 'openToken'>) {
  const pa = await pageAccess(db, accountId, deps);
  if (!pa) return null;
  const p = await graph<{ name?: string; username?: string }>(cfg, igsid, { fields: 'name,username', access_token: pa.token }, { fetchImpl: deps.fetchImpl, timeoutMs: 6000 });
  return { name: p.name ?? null, username: p.username ?? null };
}

// ---------- IA ----------

function spDayStart(now: Date): string {
  const d = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const offset = now.getTime() - d.getTime();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + offset).toISOString();
}

export async function aiUsedToday(db: Db, ownerId: string, now = new Date()): Promise<number> {
  const { count } = await db.from('ai_runs').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).like('fn', 'instagram%').gte('created_at', spDayStart(now));
  return count ?? 0;
}

async function createTask(db: Db, ownerId: string, title: string, description: string, leadId: string | null) {
  await db.from('tasks').insert({ owner_id: ownerId, lead_id: leadId, title, description, source: 'resposta', action_url: '/instagram?aba=inbox' });
}

export type SuggestResult =
  | { status: 'sugerida' | 'enviada'; messageId: string; analysis: ReplyAnalysis }
  | { status: 'ignorada'; reason: string };

/** O BEELIE lê a conversa e escreve a próxima resposta (fica como sugestão até alguém aprovar). */
export async function suggest(db: Db, cfg: MetaConfig, ownerId: string, conversationId: string, deps: Deps, now = new Date(), opts: { force?: boolean } = {}): Promise<SuggestResult> {
  const s = await settingsOf(db, ownerId);
  if (!s?.enabled) return { status: 'ignorada', reason: 'Módulo desligado.' };
  if (s.mode === 'observador' && !opts.force) return { status: 'ignorada', reason: 'Modo Observador: sem sugestões automáticas.' };
  const { data: conv } = await db.from('instagram_conversations').select('id, account_id, status, classification, username, name, lead_id, last_inbound_at').eq('id', conversationId).eq('owner_id', ownerId).maybeSingle();
  if (!conv) return { status: 'ignorada', reason: 'Conversa não encontrada.' };
  if (conv.classification === 'opt_out') return { status: 'ignorada', reason: 'A pessoa pediu para não receber mensagens.' };
  if (conv.status !== 'aberta' && !opts.force) return { status: 'ignorada', reason: conv.status === 'humano' ? 'Conversa com atendimento humano.' : 'Conversa encerrada.' };
  if ((await aiUsedToday(db, ownerId, now)) >= (s.daily_ai_limit ?? 100)) {
    await logOp(db, ownerId, null, 'limite_ia', 'bloqueado', { conversa: conversationId });
    return { status: 'ignorada', reason: 'Limite diário de uso da IA do Instagram atingido.' };
  }
  const { data: msgs } = await db.from('instagram_messages').select('direction, body, status, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(200);
  const real = ((msgs ?? []) as Row[]).filter((m) => m.body && (m.direction === 'entrada' || m.status === 'enviada')).slice(-20);
  if (!real.length || real[real.length - 1].direction !== 'entrada') return { status: 'ignorada', reason: 'Não há mensagem nova da pessoa para responder.' };

  const [{ data: a }, { data: p }] = await Promise.all([
    db.from('assistant_settings').select('name, persona, knowledge, playbooks').eq('owner_id', ownerId).maybeSingle().then((r: Row) => r, () => ({ data: null })),
    db.from('profiles').select('company_name').eq('id', ownerId).maybeSingle(),
  ]);
  const day = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const started = Date.now();
  let run;
  try {
    run = await deps.runTask({
      assistant: withDefaults(a),
      company: p?.company_name ?? undefined,
      instagramExtra: s.persona_extra ?? undefined,
      handoffRules: s.handoff_rules ?? undefined,
      profile: { username: conv.username, name: conv.name },
      conversation: real.map((m) => ({ from: m.direction === 'entrada' ? 'pessoa' : 'empresa', date: day(m.created_at), text: m.body })),
    });
    await deps.logRun(ownerId, started, 'ok', run.usage);
  } catch (e) {
    await deps.logRun(ownerId, started, 'error', {});
    await logOp(db, ownerId, null, 'sugestao_falhou', 'erro', { conversa: conversationId, erro: String((e as Error).message ?? e).slice(0, 300) });
    return { status: 'ignorada', reason: 'A IA não respondeu agora. Tente "Gerar sugestão" de novo.' };
  }
  const r = run.output;
  // Uma sugestão por vez: a anterior (nunca enviada) é trocada pela nova.
  await db.from('instagram_messages').delete().eq('conversation_id', conversationId).eq('status', 'sugerida');

  const patch: Row = { classification: r.classification, summary: r.summary || null };
  if (r.classification === 'opt_out') patch.status = 'encerrada';
  else if (r.needsHuman) patch.status = 'humano';
  await db.from('instagram_conversations').update(patch).eq('id', conversationId);

  let leadId: string | null = conv.lead_id ?? null;
  if (r.qualified && !leadId) leadId = (await toLead(db, ownerId, conversationId, null, r)).leadId;
  if (r.needsHuman && r.classification !== 'opt_out') {
    const who = conv.name || (conv.username ? `@${conv.username}` : 'contato do Instagram');
    await createTask(db, ownerId, `Responder no Instagram: ${who}`, [r.humanReason, r.summary, r.nextStep && `Próximo passo: ${r.nextStep}`].filter(Boolean).join('\n'), leadId);
    await logOp(db, ownerId, null, 'passou_para_humano', 'ok', { conversa: conversationId, motivo: r.humanReason });
  }
  if (!r.message) return { status: 'ignorada', reason: 'O BEELIE não viu o que responder.' };

  const { data: row } = await db
    .from('instagram_messages')
    .insert({ owner_id: ownerId, conversation_id: conversationId, direction: 'saida', body: null, suggested: r.message, status: 'sugerida' })
    .select('id')
    .single();
  if (!row) return { status: 'ignorada', reason: 'Não foi possível guardar a sugestão.' };

  // Automático: só Direct (permitido pela API), dentro da janela e quando não precisa de humano.
  if (s.mode === 'automatico' && s.auto_reply && !r.needsHuman && r.classification !== 'opt_out' && windowOpen(conv.last_inbound_at, now)) {
    const sent = await sendText(db, cfg, ownerId, conversationId, r.message, null, { suggestionId: row.id, auto: true }, deps, now);
    if (sent.ok) return { status: 'enviada', messageId: row.id, analysis: r };
  }
  return { status: 'sugerida', messageId: row.id, analysis: r };
}

// ---------- envio ----------

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string; code: 'janela' | 'tamanho' | 'opt_out' | 'repetido' | 'conta' | 'meta' | 'vazio' };

/** Envia texto no Direct (aprovado por alguém da equipe ou pelo modo automático). */
export async function sendText(
  db: Db,
  cfg: MetaConfig,
  ownerId: string,
  conversationId: string,
  text: string,
  actorId: string | null,
  opts: { suggestionId?: string; auto?: boolean },
  deps: Pick<Deps, 'fetchImpl' | 'openToken'>,
  now = new Date(),
): Promise<SendResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'Escreva a mensagem.', code: 'vazio' };
  if (byteLength(body) > MAX_BYTES) return { ok: false, error: 'O Instagram aceita até 1000 caracteres (menos com acentos e emojis). Encurte a mensagem.', code: 'tamanho' };
  const { data: conv } = await db.from('instagram_conversations').select('id, account_id, igsid, classification, last_inbound_at, lead_id').eq('id', conversationId).eq('owner_id', ownerId).maybeSingle();
  if (!conv) return { ok: false, error: 'Conversa não encontrada.', code: 'conta' };
  if (conv.classification === 'opt_out') return { ok: false, error: 'A pessoa pediu para não receber mensagens.', code: 'opt_out' };
  if (!windowOpen(conv.last_inbound_at, now)) return { ok: false, error: 'Passaram mais de 24 h da última mensagem da pessoa. Pelas regras do Instagram, só dá para responder quando ela escrever de novo.', code: 'janela' };

  // Trava contra envio duplo: a sugestão só sai uma vez.
  let rowId = opts.suggestionId ?? null;
  if (rowId) {
    const { data: claimed } = await db.from('instagram_messages').update({ status: 'aprovada', body }).eq('id', rowId).eq('conversation_id', conversationId).eq('status', 'sugerida').select('id');
    if (!claimed?.length) return { ok: false, error: 'Esta sugestão já foi enviada ou trocada. Atualize a conversa.', code: 'repetido' };
  } else {
    const { data: row } = await db.from('instagram_messages').insert({ owner_id: ownerId, conversation_id: conversationId, direction: 'saida', body, status: 'aprovada', sent_by: actorId }).select('id').single();
    rowId = row?.id ?? null;
    if (!rowId) return { ok: false, error: 'Não foi possível registrar a mensagem.', code: 'conta' };
  }

  const fail = async (error: string, code: 'conta' | 'meta') => {
    await db.from('instagram_messages').update({ status: 'falhou', failure_reason: error.slice(0, 300) }).eq('id', rowId);
    await logOp(db, ownerId, actorId, 'envio_falhou', 'erro', { conversa: conversationId, erro: error.slice(0, 300) });
    return { ok: false as const, error, code };
  };

  let pa;
  try {
    pa = await pageAccess(db, conv.account_id, deps);
  } catch {
    pa = null;
  }
  if (!pa) return fail('A conta do Instagram não está conectada. Conecte de novo em Contas conectadas.', 'conta');
  try {
    const r = await graph<{ message_id?: string }>(cfg, `${pa.pageId}/messages`, { recipient: JSON.stringify({ id: conv.igsid }), message: JSON.stringify({ text: body }), access_token: pa.token }, { method: 'POST', fetchImpl: deps.fetchImpl });
    const at = now.toISOString();
    await db.from('instagram_messages').update({ status: 'enviada', body, sent_by: actorId, auto: !!opts.auto, external_id: r.message_id ?? null, created_at: at }).eq('id', rowId);
    await db.from('instagram_conversations').update({ last_message_at: at }).eq('id', conversationId);
    await logOp(db, ownerId, actorId, opts.auto ? 'resposta_automatica' : 'mensagem_enviada', 'ok', { conversa: conversationId });
    if (conv.lead_id) {
      await db.from('lead_activities').insert({ owner_id: ownerId, lead_id: conv.lead_id, type: 'message_sent', description: `Mensagem enviada no Direct do Instagram${opts.auto ? ' (BEELIE)' : ''}.`, payload: { channel: 'instagram', conversationId }, actor_id: actorId });
      await db.from('leads').update({ last_contact_at: at, last_activity_at: at }).eq('id', conv.lead_id);
    }
    return { ok: true, messageId: rowId! };
  } catch (e) {
    if (e instanceof MetaError && e.kind === 'token') {
      await db.from('instagram_accounts').update({ status: 'expirado', last_error: e.message }).eq('id', conv.account_id);
    }
    return fail(e instanceof Error ? e.message : String(e), 'meta');
  }
}

// ---------- humano e CRM ----------

export async function setHuman(db: Db, ownerId: string, conversationId: string, on: boolean, actorId: string | null) {
  const { data: conv } = await db.from('instagram_conversations').select('id, name, username, lead_id, summary, status').eq('id', conversationId).eq('owner_id', ownerId).maybeSingle();
  if (!conv) return false;
  await db.from('instagram_conversations').update({ status: on ? 'humano' : 'aberta' }).eq('id', conversationId);
  if (on && conv.status !== 'humano') {
    const who = conv.name || (conv.username ? `@${conv.username}` : 'contato do Instagram');
    await createTask(db, ownerId, `Responder no Instagram: ${who}`, conv.summary ?? 'Conversa passada para atendimento humano.', conv.lead_id);
  }
  await logOp(db, ownerId, actorId, on ? 'passou_para_humano' : 'voltou_para_beelie', 'ok', { conversa: conversationId });
  return true;
}

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
function ufFromDdd(digits: string): string | null {
  const d = Number(digits.slice(0, 2));
  if (d >= 11 && d <= 19) return 'SP';
  if (d >= 21 && d <= 24) return 'RJ';
  if (d >= 31 && d <= 38) return 'MG';
  if (d >= 41 && d <= 46) return 'PR';
  if (d >= 47 && d <= 49) return 'SC';
  if (d >= 51 && d <= 55) return 'RS';
  return null;
}

/**
 * Adaptador do Lead Hunter: cria (ou liga) a empresa e o lead desta conversa, sem duplicar
 * (procura pelo @ do Instagram e pelo telefone). Não coloca em campanha: quem escreveu é atendido no Direct.
 */
export async function toLead(db: Db, ownerId: string, conversationId: string, actorId: string | null, a?: Pick<ReplyAnalysis, 'contact' | 'summary'> | null): Promise<{ leadId: string | null; created: boolean }> {
  const { data: conv } = await db.from('instagram_conversations').select('id, username, name, lead_id, summary').eq('id', conversationId).eq('owner_id', ownerId).maybeSingle();
  if (!conv) return { leadId: null, created: false };
  if (conv.lead_id) return { leadId: conv.lead_id, created: false };
  const c = a?.contact ?? { name: null, company: null, phone: null, email: null, city: null, state: null, segment: null };
  const handle = conv.username ? `@${conv.username}` : null;
  const digits = (c.phone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const phone = digits.length === 10 || digits.length === 11 ? digits : null;

  let company: Row | null = null;
  if (handle) {
    const { data } = await db.from('companies').select('id').eq('owner_id', ownerId).ilike('instagram', `%${conv.username}%`).limit(1);
    company = data?.[0] ?? null;
  }
  if (!company && phone) {
    const { data } = await db.from('companies').select('id').eq('owner_id', ownerId).or(`whatsapp.ilike.%${phone.slice(-8)}%,phone.ilike.%${phone.slice(-8)}%`).limit(1);
    company = data?.[0] ?? null;
  }
  let leadId: string | null = null;
  if (company) {
    const { data: l } = await db.from('leads').select('id').eq('owner_id', ownerId).eq('company_id', company.id).maybeSingle();
    leadId = l?.id ?? null;
  }
  let created = false;
  const at = new Date().toISOString();
  if (!leadId) {
    const src = { provider: 'instagram_direct', fetchedAt: at };
    const city = c.city ?? 'A identificar';
    const state = (c.state && UFS.has(c.state) ? c.state : null) ?? (phone ? ufFromDdd(phone) : null) ?? 'SP';
    const fmt = phone ? (phone.length === 11 ? `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}` : `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`) : null;
    if (!company) {
      const { data: comp } = await db
        .from('companies')
        .insert({
          owner_id: ownerId,
          legal_name: c.company ?? c.name ?? conv.name ?? handle ?? 'Contato do Instagram',
          segment: c.segment ?? 'A identificar',
          city,
          state,
          instagram: handle,
          ...(fmt ? { phone: fmt, whatsapp: fmt } : {}),
          field_provenance: { instagram: src, ...(c.company ? { legalName: src } : {}), ...(c.city ? { city: src } : {}), ...(fmt ? { phone: src } : {}) },
          dedupe_key: handle ? `ig:${conv.username!.toLowerCase()}` : `igsid:${conversationId}`,
          created_by: actorId,
        })
        .select('id')
        .single();
      company = comp ?? null;
    }
    if (!company) return { leadId: null, created: false };
    const { data: lead } = await db
      .from('leads')
      .insert({ owner_id: ownerId, company_id: company.id, origin: IG_ORIGIN, stage: 'respondeu', created_by: actorId, ...(c.name ? { contact_name: c.name } : {}), ...(c.email ? { email: c.email } : {}) })
      .select('id')
      .single();
    if (!lead) return { leadId: null, created: false };
    leadId = lead.id as string;
    created = true;
  }
  await db.from('instagram_conversations').update({ lead_id: leadId }).eq('id', conversationId);
  await db.from('lead_activities').insert({
    owner_id: ownerId,
    lead_id: leadId,
    type: created ? 'discovered' : 'lead_updated',
    description: created ? `Chegou pelo Direct do Instagram${handle ? ` (${handle})` : ''}.` : `Conversa do Instagram ligada a este lead${handle ? ` (${handle})` : ''}.`,
    payload: { channel: 'instagram', conversationId },
    actor_id: actorId,
  });
  const summary = a?.summary || conv.summary;
  if (summary) await db.from('lead_notes').insert({ owner_id: ownerId, lead_id: leadId, body: `Instagram: ${summary}`, created_by: actorId });
  await logOp(db, ownerId, actorId, created ? 'lead_criado' : 'lead_ligado', 'ok', { conversa: conversationId, lead: leadId });
  return { leadId, created };
}

/** Inscreve a Página para a Meta mandar as mensagens do Instagram para o webhook. */
export async function subscribePage(cfg: MetaConfig, pageId: string, token: string, fetchImpl?: Fetch): Promise<string | null> {
  for (const fields of ['messages', 'feed']) {
    try {
      await graph(cfg, `${pageId}/subscribed_apps`, { subscribed_fields: fields, access_token: token }, { method: 'POST', fetchImpl });
      return fields;
    } catch {
      /* tenta a próxima */
    }
  }
  return null;
}
