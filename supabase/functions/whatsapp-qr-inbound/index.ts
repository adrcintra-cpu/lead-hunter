// Edge Function `whatsapp-qr-inbound` — respostas recebidas no WhatsApp conectado por QR code.
// Chamada só pelo serviço de WhatsApp (Railway), com o header x-inbound-secret = WHATSAPP_INBOUND_SECRET.
// O serviço já filtrou: só chegam aqui mensagens de números que são leads do próprio usuário.
// Usa o mesmo processamento das outras respostas: grava, a IA classifica, a cadência para.
// Publicar sem verificação de JWT: supabase functions deploy whatsapp-qr-inbound --no-verify-jwt

import { adminClient, handleInbound } from '../_shared/automation/engine.ts';
import { timingSafeEqual } from '../_shared/channels/metaWhatsapp.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const secret = Deno.env.get('WHATSAPP_INBOUND_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-inbound-secret') ?? '', secret)) return new Response('Não autorizado', { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  const ownerId = String(b.ownerId ?? '');
  const leadId = String(b.leadId ?? '');
  const body = typeof b.body === 'string' ? b.body.slice(0, 4000) : '';
  const from = String(b.from ?? '').replace(/\D/g, '').slice(0, 20);
  if (!UUID.test(ownerId) || !UUID.test(leadId) || !body.trim() || !from) return new Response('Dados inválidos', { status: 400 });

  const db = adminClient();
  // O lead precisa ser do mesmo usuário da sessão de WhatsApp.
  const { data: lead } = await db.from('leads').select('id').eq('id', leadId).eq('owner_id', ownerId).maybeSingle();
  if (!lead) return new Response('Lead não encontrado', { status: 404 });

  try {
    await handleInbound(db, {
      ownerId,
      leadId,
      channel: 'whatsapp',
      from,
      body,
      externalId: typeof b.externalId === 'string' && b.externalId ? `qr:${b.externalId.slice(0, 100)}` : undefined,
      receivedAt: typeof b.receivedAt === 'string' ? b.receivedAt : undefined,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('inbound', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Falha ao registrar a resposta.' }, { status: 500 });
  }
});
