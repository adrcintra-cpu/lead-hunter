import pino from 'pino';

/**
 * Logs técnicos em JSON. Nunca registra o texto das mensagens nem chaves da sessão;
 * telefones aparecem mascarados.
 */
export const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'whatsapp' } });

/** Silencioso para a biblioteca do WhatsApp (ela loga muito em nível debug). */
export const libLogger = pino({ level: 'silent' });

export function maskPhone(digits: string | undefined | null): string {
  if (!digits) return '';
  return digits.length <= 4 ? '****' : `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

export function maskUser(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}
