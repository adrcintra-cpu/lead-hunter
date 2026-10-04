// Edge Function `email-webhook` — eventos do Resend (assinados com svix).
// - email.delivered / email.bounced / email.complained: status do envio
//   (reclamação de spam vira opt-out do endereço).
// - email.received (Resend Inbound): resposta do lead → classificação e ações.
// Publicar sem verificação de JWT: supabase functions deploy email-webhook --no-verify-jwt

import { adminClient, findLeadByRecipient, handleInbound, log, updateDelivery } from '../_shared/automation/engine.ts';
import { stripQuoted, verifySvix } from '../_shared/channels/resend.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const addressOf = (v: unknown): string => {
  const s = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
};

/** O evento de recebimento pode vir sem o corpo; nesse caso buscamos pela API. */
async function inboundText(d: Any): Promise<string> {
  if (d.text) return String(d.text);
  const key = Deno.env.get('RESEND_API_KEY');
  const id = d.email_id ?? d.id;
  if (key && id) {
    const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) {
      const full = await r.json();
      if (full.text) return String(full.text);
      if (full.html) return String(full.html).replace(/<[^>]+>/g, ' ');
    }
  }
  return d.subject ? `[Resposta sem texto] ${d.subject}` : '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const raw = await req.text();
  if (!(await verifySvix(raw, req.headers))) return new Response('Assinatura inválida', { status: 401 });

  let ev: Any;
  try {
    ev = JSON.parse(raw);
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  const db = adminClient();
  const d = ev.data ?? {};
  const at = ev.created_at ?? new Date().toISOString();

  try {
    switch (ev.type) {
      case 'email.sent':
        await updateDelivery(db, 'resend', d.email_id, 'sent', at);
        break;
      case 'email.delivered':
        await updateDelivery(db, 'resend', d.email_id, 'delivered', at);
        break;
      case 'email.opened':
        // Abertura por pixel é imprecisa (pré-carregamento de imagens); registramos como "lida" sem tirar conclusões.
        await updateDelivery(db, 'resend', d.email_id, 'read', at);
        break;
      case 'email.bounced':
        await updateDelivery(db, 'resend', d.email_id, 'failed', at, `Devolvido: ${d.bounce?.message ?? d.bounce?.type ?? 'endereço inválido'}`);
        break;
      case 'email.complained': {
        await updateDelivery(db, 'resend', d.email_id, 'failed', at, 'Marcado como spam pelo destinatário');
        const to = addressOf(d.to);
        const match = to && (await findLeadByRecipient(db, 'email', to));
        if (match) {
          await db.from('suppression_list').upsert({ owner_id: match.ownerId, kind: 'email', value: to, reason: 'Marcou o e-mail como spam' }, { onConflict: 'owner_id,kind,value', ignoreDuplicates: true });
          await db.from('enrollments').update({ status: 'interrompida', stop_reason: 'marcou o e-mail como spam', next_run_at: null }).eq('lead_id', match.leadId).in('status', ['ativa', 'pausada']);
          await log(db, match.ownerId, match.leadId, 'cadence_stopped', 'Cadência encerrada: o destinatário marcou o e-mail como spam');
        }
        break;
      }
      case 'email.received': {
        const from = addressOf(d.from);
        const match = from && (await findLeadByRecipient(db, 'email', from));
        if (!match) break;
        const text = stripQuoted(await inboundText(d));
        await handleInbound(db, { ...match, channel: 'email', from, body: text, externalId: d.email_id ?? d.id, receivedAt: at });
        break;
      }
    }
  } catch (e) {
    console.error(ev.type, e);
    return new Response('erro', { status: 500 }); // o Resend tenta de novo
  }
  return new Response('ok');
});
