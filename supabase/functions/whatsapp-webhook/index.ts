// Edge Function `whatsapp-webhook` — webhook da WhatsApp Cloud API (Meta).
// GET: verificação (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
// POST: status (enviada/entregue/lida/falhou) e mensagens recebidas, com assinatura X-Hub-Signature-256.
// Publicar sem verificação de JWT: supabase functions deploy whatsapp-webhook --no-verify-jwt

import { adminClient, findLeadByRecipient, handleInbound, updateDelivery } from '../_shared/automation/engine.ts';
import { verifyMetaSignature } from '../_shared/channels/metaWhatsapp.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const iso = (ts?: string) => (ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString());

function textOf(m: Any): string {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type ?? 'mensagem'} recebida — abra o WhatsApp para ver]`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('Token inválido', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get('X-Hub-Signature-256')))) return new Response('Assinatura inválida', { status: 401 });

  const db = adminClient();
  let body: Any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }

  // A Meta reenvia se não receber 200: erros por item são registrados e não derrubam o lote.
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const s of v.statuses ?? []) {
        try {
          if (['sent', 'delivered', 'read', 'failed'].includes(s.status)) {
            const reason = s.errors?.[0] ? `${s.errors[0].code ?? ''} ${s.errors[0].title ?? ''} ${s.errors[0].error_data?.details ?? ''}`.trim() : undefined;
            await updateDelivery(db, 'meta_whatsapp', s.id, s.status, iso(s.timestamp), reason);
          }
        } catch (e) {
          console.error('status', s.id, e);
        }
      }
      for (const m of v.messages ?? []) {
        try {
          const match = await findLeadByRecipient(db, 'whatsapp', m.from);
          if (!match) {
            console.warn('mensagem de número sem lead correspondente');
            continue;
          }
          await handleInbound(db, { ...match, channel: 'whatsapp', from: m.from, body: textOf(m), externalId: m.id, receivedAt: iso(m.timestamp) });
        } catch (e) {
          console.error('mensagem', m.id, e);
        }
      }
    }
  }
  return new Response('ok');
});
