import pino from 'pino';

/**
 * Logs técnicos em JSON. Nunca registra o texto das mensagens nem chaves da sessão;
 * telefones aparecem mascarados.
 */
export const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'whatsapp' } });

/**
 * A biblioteca de criptografia do WhatsApp (libsignal) imprime sessões inteiras, com chaves privadas,
 * direto no console ("Closing session: SessionEntry {...}"). Isso não pode ir para os logs.
 */
const SIGNAL_NOISE = /^(Closing session|Closing open session|Closing stale open session|Removing old closed session|Session already closed|Session already open|Decrypted message with closed session|Failed to decrypt message with any known session|Migrating session)/;
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && SIGNAL_NOISE.test(args[0])) return;
    original(...args);
  };
}

/** Silencioso para a biblioteca do WhatsApp (ela loga muito em nível debug). */
export const libLogger = pino({ level: 'silent' });

export function maskPhone(digits: string | undefined | null): string {
  if (!digits) return '';
  return digits.length <= 4 ? '****' : `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

export function maskUser(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}
