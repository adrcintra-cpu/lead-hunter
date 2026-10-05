/**
 * Telefone no padrão internacional do WhatsApp, só dígitos (ex.: 5519999999999).
 * Mesma regra do Lead Hunter: números brasileiros com DDD (10 ou 11 dígitos) ganham o 55.
 */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12 && d.length <= 15) return d;
  return null;
}

export function toJid(digits: string): string {
  return `${digits}@s.whatsapp.net`;
}

/** "5519999991234:12@s.whatsapp.net" → "+55 19 99999-1234" */
export function formatPhone(jidOrDigits: string | undefined): string | null {
  if (!jidOrDigits) return null;
  const d = jidOrDigits.split(/[:@]/)[0].replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    return `+55 ${ddd} ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  return `+${d}`;
}
