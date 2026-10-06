import type { RawCompany } from './types';
import { digits, normalize, normalizeDomain } from './utils';

/**
 * Chaves de identidade de uma empresa, usadas para não criar o mesmo lead duas vezes.
 * Duas fichas são a mesma empresa quando têm qualquer chave em comum:
 * - CNPJ;
 * - domínio do site (redes sociais, encurtadores e páginas genéricas não contam: muitas empresas dividem o mesmo domínio);
 * - telefone ou WhatsApp, padronizados (com ou sem 55, com ou sem 0, com ou sem máscara);
 * - nome + cidade, só quando a ficha não tem nenhum dos dados acima.
 */
export type IdentitySource = Pick<RawCompany, 'cnpj' | 'website' | 'phone' | 'city' | 'legalName'> & {
  tradeName?: string;
  whatsapp?: string;
};

/** Domínios compartilhados por várias empresas: não identificam ninguém. */
const SHARED_HOSTS =
  /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|wa\.me|whatsapp\.com|api\.whatsapp\.com|linktr\.ee|linkr\.bio|bio\.link|beacons\.ai|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|google\.com|goo\.gl|g\.page|maps\.app\.goo\.gl|sites\.google\.com|business\.site|wixsite\.com|blogspot\.com|wordpress\.com|ifood\.com\.br|mercadolivre\.com\.br|olx\.com\.br|bit\.ly|negocio\.site)$/;

/**
 * Telefone brasileiro em forma única: DDD + número, sem 55, sem 0 e sem máscara.
 * Sem DDD (8 ou 9 dígitos), o número só vale junto da cidade.
 */
export function canonicalPhone(raw: string | undefined, city?: string): string | null {
  let d = digits(raw ?? '');
  if (!d) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + fixo
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + celular
  if (d.length === 10 || d.length === 11) {
    // Celular: 9 + 8 dígitos. Sem o 9 (formato antigo), acrescenta para bater com o atual.
    const ddd = d.slice(0, 2);
    const num = d.slice(2);
    if (num.length === 8 && /^[6-9]/.test(num)) return `${ddd}9${num}`;
    return `${ddd}${num}`;
  }
  if ((d.length === 8 || d.length === 9) && city) return `${normalize(city)}:${d}`;
  return null;
}

function domainKey(url: string | undefined): string | null {
  if (!url) return null;
  const host = normalizeDomain(url).replace(/:\d+$/, '');
  if (!host || !host.includes('.') || SHARED_HOSTS.test(host)) return null;
  return host;
}

const nameKey = (name: string | undefined, city: string | undefined) => {
  const n = normalize(name ?? '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ltda|me|epp|eireli|s ?a|cia)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const c = normalize(city ?? '');
  return n && c ? `nome:${n}:${c}` : null;
};

/** Chaves fortes: CNPJ, domínio próprio, telefone/WhatsApp. */
export function strongKeys(c: IdentitySource): string[] {
  const keys = new Set<string>();
  const cnpj = digits(c.cnpj ?? '');
  if (cnpj.length === 14) keys.add(`cnpj:${cnpj}`);
  const web = domainKey(c.website);
  if (web) keys.add(`web:${web}`);
  for (const p of [c.phone, c.whatsapp]) {
    const tel = canonicalPhone(p, c.city);
    if (tel) keys.add(`tel:${tel}`);
  }
  return [...keys];
}

export function nameKeys(c: IdentitySource): string[] {
  return [...new Set([c.legalName, c.tradeName].map((n) => nameKey(n, c.city)).filter((k): k is string => !!k))];
}

/**
 * Mesma empresa? Qualquer chave forte em comum; ou mesmo nome + cidade quando um dos lados
 * não tem nenhuma chave forte (filiais de uma rede, com telefones diferentes, continuam separadas).
 */
export function sameCompany(a: IdentitySource, b: IdentitySource): boolean {
  const sa = strongKeys(a);
  const sb = strongKeys(b);
  if (sa.some((k) => sb.includes(k))) return true;
  if (sa.length && sb.length) return false;
  const nb = nameKeys(b);
  return nameKeys(a).some((k) => nb.includes(k));
}

/** Índice das empresas existentes para achar duplicadas sem comparar uma a uma. */
export class IdentityIndex<T extends IdentitySource> {
  private strong = new Map<string, T>();
  private names = new Map<string, T>();
  private weakNames = new Map<string, T>();

  constructor(items: Iterable<T> = []) {
    for (const it of items) this.add(it);
  }

  add(it: T) {
    const strong = strongKeys(it);
    for (const k of strong) if (!this.strong.has(k)) this.strong.set(k, it);
    for (const k of nameKeys(it)) {
      if (!this.names.has(k)) this.names.set(k, it);
      if (!strong.length && !this.weakNames.has(k)) this.weakNames.set(k, it);
    }
  }

  find(c: IdentitySource): T | undefined {
    const strong = strongKeys(c);
    for (const k of strong) {
      const hit = this.strong.get(k);
      if (hit) return hit;
    }
    // Com dados fortes, o nome só casa com quem não tem nenhum; sem dados fortes, casa com qualquer um.
    const pool = strong.length ? this.weakNames : this.names;
    for (const k of nameKeys(c)) {
      const hit = pool.get(k);
      if (hit) return hit;
    }
    return undefined;
  }
}
