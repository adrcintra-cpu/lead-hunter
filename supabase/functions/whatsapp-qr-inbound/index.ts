// Edge Function `whatsapp-qr-inbound` — respostas recebidas no WhatsApp conectado por QR code.
// Chamada só pelo serviço de WhatsApp (Railway), com o header x-inbound-secret = WHATSAPP_INBOUND_SECRET.
// O serviço já filtrou: só chegam aqui mensagens de números que são leads do próprio usuário.
//
// Ações:
//   (padrão)     resposta do lead → grava, IA classifica, cadência para, IA escreve a próxima mensagem.
//                Se a resposta automática estiver ligada, devolve `auto` para o serviço enviar.
//   sent         o serviço enviou a resposta automática → marca como enviada.
//   auto_failed  o envio automático falhou → registra; a mensagem fica para você enviar.
//   unknown      número que não é lead escreveu: com a opção ligada e mensagem comercial, vira lead e segue como resposta.
// Publicar sem verificação de JWT: supabase functions deploy whatsapp-qr-inbound --no-verify-jwt

import { adminClient, handleInbound, log, qrCampaignFallback, qrCampaignSent } from '../_shared/automation/engine.ts';
import { inWindow } from '../_shared/automation/planner.ts';
import { DEFAULT_SEND_WINDOW, type SendWindow } from '../_shared/automation/types.ts';
import { timingSafeEqual } from '../_shared/channels/metaWhatsapp.ts';
import { handleUnknown } from '../_shared/automation/unknownInbound.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Máximo de respostas automáticas por lead em 24 h (evita conversa sem fim, inclusive com robôs). */
const MAX_AUTO_PER_DAY = 15;
/** Intenções em que você precisa entrar: o BEELIE responde, e a tarefa continua aberta para você. */
const NEEDS_HUMAN = new Set(['confirmar_conversa', 'passar_para_vendedor']);
/** Lead pediu para falar por áudio (ex.: "manda um áudio", "prefiro áudio", "fala por áudio"). */
// Limites de palavra que entendem acentos (o \\b do JavaScript não reconhece "á").
const W = (re: string) => new RegExp(re.replace(/\\b/g, '(?<![\\p{L}\\p{N}])').replace(/\\e/g, '(?![\\p{L}\\p{N}])'), 'iu');
const AUDIO_WORD = '(?:[aá]udios?|voz)';
const ASKS_AUDIO = W(
  `\\b(?:me )?(?:mand|envi|grav|fal|explic|respond|cont)\\p{L}*\\e[^.?!]{0,30}\\b${AUDIO_WORD}\\e|\\bprefiro (?:um )?${AUDIO_WORD}\\e|\\b(?:por|em|via|num|no) ${AUDIO_WORD}\\e`,
);
/** Lead pediu texto (ex.: "não consigo ouvir", "manda por escrito", "prefiro texto"). */
const ASKS_TEXT = W(
  `\\bn[aã]o (?:consigo|posso|d[aá] pra) (?:ouvir|escutar)\\e|\\bpor escrito\\e|\\bescrev\\p{L}*\\e|\\bprefiro (?:texto|mensagem|escrito)\\e|\\b(?:mand|envi|respond)\\p{L}* (?:em|por) (?:texto|mensagem|escrito)\\e|\\bsem [aá]udio\\e`,
);

/**
 * Formato da resposta desta conversa: o pedido mais recente do lead vale (áudio ou texto);
 * sem pedido, se o lead mandou áudio, o BEELIE responde em áudio; senão, vale a configuração.
 */
export function chooseFormat(recent: string[], configured: 'texto' | 'audio'): 'texto' | 'audio' {
  for (const body of recent) {
    const t = body.replace(/^\[Áudio transcrito\]\s*/i, '');
    if (ASKS_TEXT.test(t)) return 'texto';
    if (ASKS_AUDIO.test(t)) return 'audio';
  }
  if (recent[0]?.startsWith('[Áudio transcrito]')) return 'audio';
  return configured;
}

/** Horário em que o BEELIE responde quem escreveu (hora de Brasília), todos os dias. */
const REPLY_WINDOW = { startHour: 8, endHour: 21 };

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
  if (!UUID.test(ownerId)) return new Response('Dados inválidos', { status: 400 });
  const db = adminClient();

  if (b.action === 'unknown') {
    const body = typeof b.body === 'string' ? b.body.slice(0, 4000) : '';
    const from = String(b.from ?? '').replace(/\D/g, '').slice(0, 20);
    if (!body.trim() || !from) return new Response('Dados inválidos', { status: 400 });
    try {
      const r = await handleUnknown(db, ownerId, from, body, typeof b.name === 'string' ? b.name : undefined);
      // Não comercial: nada é gravado (a mensagem pessoal não fica no sistema).
      if (!r.leadId) return Response.json({ ok: true, leadId: null });
      const result: Row | null = await handleInbound(db, {
        ownerId,
        leadId: r.leadId,
        channel: 'whatsapp',
        from,
        body,
        externalId: typeof b.externalId === 'string' && b.externalId ? `qr:${b.externalId.slice(0, 100)}` : undefined,
        receivedAt: typeof b.receivedAt === 'string' ? b.receivedAt : undefined,
      });
      const auto = result?.suggestion ? await autoDecision(db, ownerId, r.leadId, result.suggestion) : null;
      return Response.json({ ok: true, leadId: r.leadId, created: r.created, auto });
    } catch (err) {
      console.error('unknown', err instanceof Error ? err.message : String(err));
      return Response.json({ error: 'Falha ao registrar o contato.' }, { status: 500 });
    }
  }

  const leadId = String(b.leadId ?? '');
  if (!UUID.test(leadId)) return new Response('Dados inválidos', { status: 400 });
  // O lead precisa ser do mesmo usuário da sessão de WhatsApp.
  const { data: lead } = await db.from('leads').select('id').eq('id', leadId).eq('owner_id', ownerId).maybeSingle();
  if (!lead) return new Response('Lead não encontrado', { status: 404 });

  try {
    if (b.action === 'sent') return Response.json(await markAutoSent(db, ownerId, leadId, b));
    if (b.action === 'campaign_sent' || b.action === 'campaign_failed') {
      const messageId = String(b.messageId ?? '');
      if (!UUID.test(messageId)) return new Response('Dados inválidos', { status: 400 });
      const ok =
        b.action === 'campaign_sent'
          ? await qrCampaignSent(db, ownerId, messageId, typeof b.externalId === 'string' ? b.externalId.slice(0, 100) : null, String(b.to ?? '').replace(/\D/g, '') || null)
          : await qrCampaignFallback(db, ownerId, messageId, String(b.error ?? 'erro no envio'));
      return Response.json({ ok });
    }
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

/** Decide se o BEELIE responde sozinho: ligado nas configurações, dentro do horário e do limite diário. */
async function autoDecision(db: Row, ownerId: string, leadId: string, s: { id: string; body: string; intent: string }) {
  const { data: cfg } = await db.from('assistant_settings').select('auto_reply, reply_format, voice').eq('owner_id', ownerId).maybeSingle().then(
    (r: { data: Row | null }) => r,
    () => ({ data: null }),
  );
  if (cfg && cfg.auto_reply === false) return null;

  // Quem puxou a conversa foi o lead: a janela de resposta é mais ampla que a das campanhas
  // (começa mais cedo e vai até 21h, todos os dias), mas nunca de madrugada.
  const { data: p } = await db.from('profiles').select('send_window').eq('id', ownerId).maybeSingle();
  const campaign: SendWindow = (p?.send_window as SendWindow) ?? DEFAULT_SEND_WINDOW;
  const window: SendWindow = { startHour: Math.min(campaign.startHour, REPLY_WINDOW.startHour), endHour: Math.max(campaign.endHour, REPLY_WINDOW.endHour), weekdaysOnly: false };
  if (!inWindow(new Date(), window)) {
    await log(db, ownerId, leadId, 'lead_updated', `Fora do horário de resposta (${window.startHour}h às ${window.endHour}h): o BEELIE não respondeu sozinho. A resposta ficou pronta para você revisar e enviar.`, { kind: 'auto_reply_skipped', reason: 'fora_do_horario' });
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
  // Últimas mensagens do lead (mais recente primeiro): pedidos de áudio/texto valem para a conversa.
  const { data: recent } = await db
    .from('inbound_messages')
    .select('body')
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(6);
  const format = chooseFormat(((recent ?? []) as Row[]).map((r) => String(r.body ?? '')), cfg?.reply_format === 'audio' ? 'audio' : 'texto');
  return {
    messageId: s.id,
    body: s.body,
    intent: s.intent,
    format,
    voice: typeof cfg?.voice === 'string' ? cfg.voice : 'cedar',
    // Atraso natural, como alguém que leu e respondeu.
    delaySec: 10 + Math.floor(Math.random() * 16),
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
  await log(db, ownerId, leadId, 'message_sent', `O BEELIE respondeu automaticamente${audio ? ' (áudio)' : ''}`, { messageId, channel: 'whatsapp', status: 'Enviado pelo BEELIE', provider: 'whatsapp_qr' });
  // Conversa seguindo: a tarefa "Responder" é concluída, exceto quando você precisa entrar (reunião aceita ou pedido para o vendedor).
  const intent = String(b.intent ?? /\(([^)]+)\)/.exec(String(msg.template ?? ''))?.[1] ?? '');
  if (!NEEDS_HUMAN.has(intent)) {
    // Tarefas de "responder" são concluídas; agendar reunião e falar com quem foi indicado continuam com você.
    await db
      .from('tasks')
      .update({ status: 'concluida', done_at: at })
      .eq('lead_id', leadId)
      .eq('owner_id', ownerId)
      .eq('source', 'resposta')
      .eq('status', 'aberta')
      .not('title', 'ilike', 'Agendar reunião%')
      .not('title', 'ilike', 'Falar com%');
  }
  return { ok: true };
}
