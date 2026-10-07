/** DDD → UF (para cadastro mínimo quando a planilha não traz o estado). */
const DDD_UF: Record<string, string> = {};
const add = (uf: string, ddds: number[]) => ddds.forEach((d) => (DDD_UF[String(d)] = uf));
add('SP', [11, 12, 13, 14, 15, 16, 17, 18, 19]);
add('RJ', [21, 22, 24]);
add('ES', [27, 28]);
add('MG', [31, 32, 33, 34, 35, 37, 38]);
add('PR', [41, 42, 43, 44, 45, 46]);
add('SC', [47, 48, 49]);
add('RS', [51, 53, 54, 55]);
add('DF', [61]);
add('GO', [62, 64]);
add('TO', [63]);
add('MT', [65, 66]);
add('MS', [67]);
add('AC', [68]);
add('RO', [69]);
add('BA', [71, 73, 74, 75, 77]);
add('SE', [79]);
add('PE', [81, 87]);
add('AL', [82]);
add('PB', [83]);
add('RN', [84]);
add('CE', [85, 88]);
add('PI', [86, 89]);
add('PA', [91, 93, 94]);
add('AM', [92, 97]);
add('RR', [95]);
add('AP', [96]);
add('MA', [98, 99]);

/** UF a partir de um telefone brasileiro (com ou sem 55/0/máscara). */
export function ufFromPhone(raw?: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? DDD_UF[d.slice(0, 2)] ?? null : null;
}

/** Celular brasileiro (DDD + 9 + 8 dígitos): provável WhatsApp. */
export function isMobile(raw?: string): boolean {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 11 && d[2] === '9';
}

/**
 * Junta o DDD de uma coluna separada ao número quando ele veio sem DDD (8 ou 9 dígitos).
 * Número que já tem DDD (ou 55) fica como está.
 */
export function withDdd(num?: string, ddd?: string): string | undefined {
  const n = (num ?? '').trim();
  if (!n) return undefined;
  const d = (ddd ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(-2);
  const digits = n.replace(/\D/g, '');
  if (d.length === 2 && (digits.length === 8 || digits.length === 9)) return `(${d}) ${digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : `${digits.slice(0, 4)}-${digits.slice(4)}`}`;
  return n;
}
