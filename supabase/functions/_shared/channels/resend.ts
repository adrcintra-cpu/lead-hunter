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
  /** Versão HTML (com a imagem da assinatura). O texto continua indo junto. */
  html?: string;
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
      ...(m.html ? { html: m.html } : {}),
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

export interface SignatureImage {
  imageUrl?: string | null;
  linkUrl?: string | null;
  width?: number | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Só endereços https (imagem) e http(s)/mailto (link); qualquer outra coisa é descartada. */
export function safeUrl(u: string | null | undefined, kind: 'image' | 'link'): string | null {
  const v = (u ?? '').trim();
  if (!v || v.length > 1000) return null;
  try {
    const url = new URL(v);
    if (kind === 'image' && url.protocol !== 'https:') return null;
    if (kind === 'link' && !['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Corpo do e-mail em HTML simples: o mesmo texto (com quebras de linha) e, logo depois da assinatura,
 * a imagem da assinatura (com link, se houver). Sem imagem válida, devolve null (vai só o texto).
 */
export function emailHtml(text: string, signature: string | null | undefined, img: SignatureImage): string | null {
  const src = safeUrl(img.imageUrl, 'image');
  if (!src) return null;
  const href = safeUrl(img.linkUrl, 'link');
  const width = Math.min(600, Math.max(60, Math.round(Number(img.width) || 200)));
  const pic = `<img src="${esc(src)}" alt="" width="${width}" style="display:block;max-width:100%;height:auto;border:0;margin:12px 0 4px">`;
  const block = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${pic}</a>` : pic;
  const toHtml = (s: string) => esc(s).replace(/\r?\n/g, '<br>\n');
  const sig = (signature ?? '').trim();
  let body: string;
  const at = sig ? text.lastIndexOf(sig) : -1;
  if (at >= 0) {
    body = toHtml(text.slice(0, at + sig.length)) + block + toHtml(text.slice(at + sig.length));
  } else {
    // Sem assinatura em texto: a imagem entra antes do rodapé de descadastro (último parágrafo).
    const cut = text.lastIndexOf('\n\n');
    body = cut > 0 ? toHtml(text.slice(0, cut)) + block + toHtml(text.slice(cut)) : toHtml(text) + block;
  }
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">${body}</body></html>`;
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
