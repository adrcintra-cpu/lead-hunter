// Edge Function `whatsapp-qr-inbound` — respostas recebidas no WhatsApp conectado por QR code.
// Chamada só pelo serviço de WhatsApp (Railway), com o header x-inbound-secret = WHATSAPP_INBOUND_SECRET.
// O serviço já filtrou: só chegam aqui mensagens de números que são leads do próprio usuário.
//
// Ações:
//   (padrão)     resposta do lead → grava, IA classifica, cadência para, IA escreve a próxima mensagem.
//                Se a resposta automática estiver ligada, devolve `auto` para o serviço enviar.
//   sent         o serviço enviou a resposta automática → marca como enviada.
//   auto_failed  o envio automático falhou → registra; a mensagem fica para você enviar.
// Publicar sem verificação de JWT: supabase functions deploy whatsapp-qr-inbound --no-verify-jwt

import { adminClient, handleInbound, log } from '../_shared/automation/engine.ts';
import { inWindow } from '../_shared/automation/planner.ts';
import { DEFAULT_SEND_WINDOW, type SendWindow } from '../_shared/automation/types.ts';
import { timingSafeEqual } from '../_shared/channels/metaWhatsapp.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Máximo de respostas automáticas por lead em 24 h (evita conversa sem fim, inclusive com robôs). */
const MAX_AUTO_PER_DAY = 6;
/** Intenções em que você precisa entrar: a BEELIE responde, e a tarefa continua aberta para você. */
const NEEDS_HUMAN = new Set(['confirmar_conversa', 'passar_para_vendedor']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const secret = Deno.env.get('WHATSAPP_INBOUND_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-inbound-secret') ?? '', secret)) return new Response('Não autorizado', { status: 401 });

  let b: Row;
  try {
    b = await req.json();
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  const ownerId = String(b.ownerId ?? '');
  const leadId = String(b.leadId ?? '');
  if (!UUID.test(ownerId) || !UUID.test(leadId)) return new Response('Dados inválidos', { status: 400 });

  const db = adminClient();
  // O lead precisa ser do mesmo usuário da sessão de WhatsApp.
  const { data: lead } = await db.from('leads').select('id').eq('id', leadId).eq('owner_id', ownerId).maybeSingle();
  if (!lead) return new Response('Lead não encontrado', { status: 404 });

  try {
    if (b.action === 'sent') return Response.json(await markAutoSent(db, ownerId, leadId, b));
    if (b.action === 'auto_failed') {
      await log(db, ownerId, leadId, 'message_failed', `Resposta automática não enviada: ${String(b.error ?? 'erro').slice(0, 200)}. A mensagem ficou pronta para você enviar.`, { messageId: b.messageId });
      return Response.json({ ok: true });
    }

    const body = typeof b.body === 'string' ? b.body.slice(0, 4000) : '';
    const from = String(b.from ?? '').replace(/\D/g, '').slice(0, 20);
    if (!body.trim() || !from) return new Response('Dados inválidos', { status: 400 });
    const result: Row | null = await handleInbound(db, {
      ownerId,
      leadId,
      channel: 'whatsapp',
      from,
      body,
      externalId: typeof b.externalId === 'string' && b.externalId ? `qr:${b.externalId.slice(0, 100)}` : undefined,
      receivedAt: typeof b.receivedAt === 'string' ? b.receivedAt : undefined,
    });
    const auto = result?.suggestion ? await autoDecision(db, ownerId, leadId, result.suggestion) : null;
    return Response.json({ ok: true, auto });
  } catch (err) {
    console.error('inbound', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Falha ao registrar a resposta.' }, { status: 500 });
  }
});

/** Decide se a BEELIE responde sozinha: ligado nas configurações, dentro do horário e do limite diário. */
async function autoDecision(db: Row, ownerId: string, leadId: string, s: { id: string; body: string; intent: string }) {
  const { data: cfg } = await db.from('assistant_settings').select('auto_reply, reply_format, voice').eq('owner_id', ownerId).maybeSingle().then(
    (r: { data: Row | null }) => r,
    () => ({ data: null }),
  );
  if (cfg && cfg.auto_reply === false) return null;

  const { data: p } = await db.from('profiles').select('send_window').eq('id', ownerId).maybeSingle();
  const window: SendWindow = (p?.send_window as SendWindow) ?? DEFAULT_SEND_WINDOW;
  if (!inWindow(new Date(), window)) {
    await log(db, ownerId, leadId, 'lead_updated', 'Fora do horário de envio: a BEELIE não respondeu sozinha. A resposta ficou pronta para você revisar e enviar.', { kind: 'auto_reply_skipped', reason: 'fora_do_horario' });
    return null;
  }
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('provider', 'whatsapp_qr')
    .like('template', 'IA — resposta sugerida%')
    .gte('sent_at', since);
  if ((count ?? 0) >= MAX_AUTO_PER_DAY) {
    await log(db, ownerId, leadId, 'lead_updated', `Limite de ${MAX_AUTO_PER_DAY} respostas automáticas em 24 h atingido: assuma a conversa.`, { kind: 'auto_reply_skipped', reason: 'limite' });
    return null;
  }
  return {
    messageId: s.id,
    body: s.body,
    intent: s.intent,
    format: cfg?.reply_format === 'audio' ? 'audio' : 'texto',
    voice: typeof cfg?.voice === 'string' ? cfg.voice : 'nova',
    // Atraso natural, como alguém que leu e respondeu.
    delaySec: 45 + Math.floor(Math.random() * 75),
  };
}

async function markAutoSent(db: Row, ownerId: string, leadId: string, b: Row) {
  const messageId = String(b.messageId ?? '');
  if (!UUID.test(messageId)) return { ok: false };
  const at = new Date().toISOString();
  const { data: msg } = await db
    .from('messages')
    .update({ status: 'sent', provider: 'whatsapp_qr', external_id: typeof b.externalId === 'string' ? b.externalId.slice(0, 100) : null, recipient: String(b.to ?? '').replace(/\D/g, '') || null, sent_at: at })
    .eq('id', messageId)
    .eq('owner_id', ownerId)
    .eq('status', 'draft')
    .select('id, template')
    .maybeSingle();
  if (!msg) return { ok: false };
  await db.from('leads').update({ last_contact_at: at }).eq('id', leadId);
  const audio = b.format === 'audio';
  await log(db, ownerId, leadId, 'message_sent', `BEELIE respondeu automaticamente${audio ? ' (áudio)' : ''}`, { messageId, channel: 'whatsapp', status: 'Enviado pela BEELIE', provider: 'whatsapp_qr' });
  // Conversa seguindo: a tarefa "Responder" é concluída, exceto quando você precisa entrar (reunião aceita ou pedido para o vendedor).
  const intent = String(b.intent ?? /\(([^)]+)\)/.exec(String(msg.template ?? ''))?.[1] ?? '');
  if (!NEEDS_HUMAN.has(intent)) {
    await db.from('tasks').update({ status: 'concluida', done_at: at }).eq('lead_id', leadId).eq('owner_id', ownerId).eq('source', 'resposta').eq('status', 'aberta');
  }
  return { ok: true };
}
