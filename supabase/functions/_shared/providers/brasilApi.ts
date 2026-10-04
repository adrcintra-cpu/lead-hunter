// Provider de CNPJ via BrasilAPI (dados públicos da Receita Federal).
// Docs: https://brasilapi.com.br/docs#tag/CNPJ
// Não guardamos o quadro de sócios (QSA): são dados de pessoas físicas e o MVP não precisa deles.

import type { RawCompany } from './types.ts';

export interface BrasilApiCnpj {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  porte?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
}

/** Valida os dígitos verificadores do CNPJ. */
export function isValidCnpj(input: string): boolean {
  const d = input.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function formatCnpj(input: string): string {
  const d = input.replace(/\D/g, '');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

const PORTE: Record<string, string> = {
  'MICRO EMPRESA': 'Microempresa (ME)',
  'EMPRESA DE PEQUENO PORTE': 'Empresa de pequeno porte (EPP)',
  DEMAIS: 'Demais (médio ou grande porte)',
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|\/|-)(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
}

function formatPhone(ddd?: string): string | undefined {
  const d = ddd?.replace(/\D/g, '');
  if (!d || d.length < 10) return undefined;
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export function mapCnpj(r: BrasilApiCnpj): Partial<RawCompany> {
  const street = [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' ');
  const address = street
    ? `${titleCase(street)}${r.numero ? `, ${r.numero}` : ''}${r.bairro ? ` — ${titleCase(r.bairro)}` : ''}, ${r.municipio ? titleCase(r.municipio) : ''}/${r.uf ?? ''}`
    : undefined;
  return {
    provider: 'brasilapi',
    cnpj: formatCnpj(r.cnpj),
    legalName: r.razao_social?.trim() || undefined,
    tradeName: r.nome_fantasia?.trim() || undefined,
    city: r.municipio ? titleCase(r.municipio) : undefined,
    state: r.uf || undefined,
    address,
    phone: formatPhone(r.ddd_telefone_1),
    cnae: r.cnae_fiscal_descricao ? `${r.cnae_fiscal ?? ''} ${r.cnae_fiscal_descricao}`.trim() : undefined,
    companySize: r.porte ? (PORTE[r.porte] ?? titleCase(r.porte)) : undefined,
    registrationStatus: r.descricao_situacao_cadastral || undefined,
    openedAt: r.data_inicio_atividade || undefined,
  };
}

export async function lookupCnpj(cnpj: string, fetchImpl: typeof fetch = fetch): Promise<Partial<RawCompany> | null> {
  const d = cnpj.replace(/\D/g, '');
  if (!isValidCnpj(d)) throw new Error('CNPJ inválido.');
  const res = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
  return mapCnpj((await res.json()) as BrasilApiCnpj);
}
