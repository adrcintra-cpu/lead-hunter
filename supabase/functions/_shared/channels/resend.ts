// E-mail via Resend (https://resend.com). O domínio do remetente precisa estar verificado lá.
// Secrets: RESEND_API_KEY, RESEND_WEBHOOK_SECRET (assinatura svix), EMAIL_FROM_FALLBACK (opcional).

import { timingSafeEqual } from './metaWhatsapp.ts';

export function hasResend(): boolean {
  return !!Deno.env.get('RESEND_API_KEY');
}

export interface EmailSend {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(m: EmailSend): Promise<{ externalId: string; provider: 'resend' }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('E-mail não configurado (RESEND_API_KEY).');
  const from = m.fromName ? `${m.fromName.replace(/[<>"]/g, '')} <${m.from}>` : m.from;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      reply_to: m.replyTo ?? m.from,
      // Descadastro em um clique nos clientes de e-mail (Gmail/Outlook mostram "Cancelar inscrição").
      headers: { 'List-Unsubscribe': `<mailto:${m.from}?subject=PARAR>` },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message ?? 'erro'}`);
  if (!data?.id) throw new Error('Resend não devolveu o ID do e-mail.');
  return { externalId: data.id, provider: 'resend' };
}

/** Confere a assinatura svix dos webhooks do Resend. */
export async function verifySvix(rawBody: string, headers: Headers): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigs = headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(' ').some((s) => timingSafeEqual(s.split(',')[1] ?? '', expected));
}

/** Tira o histórico citado ("Em ... escreveu:", linhas com ">") da resposta. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    if (/^(Em|On) .+(escreveu|wrote):\s*$/i.test(l.trim())) break;
    if (/^-{2,}\s*(Mensagem original|Original Message)/i.test(l.trim())) break;
    out.push(l);
  }
  return out.join('\n').trim() || text.trim();
}
