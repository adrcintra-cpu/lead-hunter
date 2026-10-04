// WhatsApp Business Platform (Cloud API oficial da Meta). Sem automação de WhatsApp Web.
// Secrets: WHATSAPP_TOKEN (token de sistema), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_LANG (padrão pt_BR).
//
// Regras da Meta que o código respeita:
// - Mensagem iniciada pela empresa só com template aprovado. O texto personalizado vai no
//   parâmetro {{1}} do corpo do template (sem quebras de linha, limite de tamanho).
// - Texto livre só dentro da janela de 24 h após a última mensagem do contato.

const GRAPH = 'https://graph.facebook.com/v21.0';

export function hasWhatsapp(): boolean {
  return !!(Deno.env.get('WHATSAPP_TOKEN') && Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'));
}

/** Número no formato internacional só com dígitos (55 + DDD + número). */
export function toE164Digits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** Parâmetros de template não aceitam quebra de linha, tabulação nem 4+ espaços seguidos. */
export function templateParam(text: string, max = 1000): string {
  const one = text.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export interface WaSend {
  to: string;
  text: string;
  /** Nome do template aprovado na Meta. Sem ele, só funciona dentro da janela de 24 h. */
  templateName?: string;
}

export async function sendWhatsapp(m: WaSend): Promise<{ externalId: string; provider: 'meta_whatsapp' }> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) throw new Error('WhatsApp oficial não configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).');
  const to = toE164Digits(m.to);
  const payload = m.templateName
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: m.templateName,
          language: { code: Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam(m.text) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: m.text, preview_url: false } };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error;
    throw new Error(e ? `Meta ${e.code ?? res.status}: ${e.error_data?.details ?? e.message}` : `Meta HTTP ${res.status}`);
  }
  const id = data?.messages?.[0]?.id;
  if (!id) throw new Error('Meta não devolveu o ID da mensagem.');
  return { externalId: id, provider: 'meta_whatsapp' };
}

/** Confere a assinatura X-Hub-Signature-256 do webhook (HMAC-SHA256 com o App Secret). */
export async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!secret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, header.slice(7));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Link wa.me para envio manual (lead sem opt-in). */
export function waMeLink(phone: string, text: string): string {
  return `https://wa.me/${toE164Digits(phone)}?text=${encodeURIComponent(text)}`;
}
