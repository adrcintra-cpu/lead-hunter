import type { Company, CompanyField, FieldSource, Profile, RawCompany, ScoreRule, ScoreTier } from './types';
import { digits, normalize, normalizeDomain, nowIso, uid } from './utils';

/** Chave de deduplicação em cascata: CNPJ → domínio → telefone + cidade. */
export function dedupeKey(c: Pick<RawCompany, 'cnpj' | 'website' | 'phone' | 'city' | 'legalName'>): string {
  if (c.cnpj) return `cnpj:${digits(c.cnpj)}`;
  if (c.website) return `web:${normalizeDomain(c.website)}`;
  if (c.phone) return `tel:${digits(c.phone)}:${normalize(c.city)}`;
  return `nome:${normalize(c.legalName)}:${normalize(c.city)}`;
}

const FIELDS: CompanyField[] = [
  'legalName', 'tradeName', 'cnpj', 'segment', 'city', 'state', 'address',
  'website', 'phone', 'whatsapp', 'instagram', 'linkedin', 'employeesRange',
  'companySize', 'cnae', 'registrationStatus', 'openedAt',
];

/** Normaliza um RawCompany em Company, registrando a origem de cada campo. */
export function toCompany(raw: RawCompany): Company {
  const at = nowIso();
  const src: FieldSource = { provider: raw.provider, fetchedAt: at };
  const provenance: Company['fieldProvenance'] = {};
  for (const f of FIELDS) if (raw[f]) provenance[f] = src;
  // Nome comercial (ex.: Google Places) não é razão social: sem proveniência até o CNPJ confirmar.
  if (raw.legalNameIsTradeName) delete provenance.legalName;
  return {
    id: uid('co'),
    legalName: raw.legalName,
    tradeName: raw.tradeName,
    cnpj: raw.cnpj,
    segment: raw.segment,
    city: raw.city,
    state: raw.state,
    address: raw.address,
    lat: raw.lat,
    lng: raw.lng,
    website: raw.website ? normalizeDomain(raw.website) : undefined,
    phone: raw.phone,
    whatsapp: raw.whatsapp,
    whatsappStatus: raw.whatsapp ? (raw.whatsappStatus ?? 'desconhecido') : 'desconhecido',
    instagram: raw.instagram,
    linkedin: raw.linkedin,
    employeesRange: raw.employeesRange,
    employeesMin: raw.employeesMin,
    companySize: raw.companySize,
    cnae: raw.cnae,
    registrationStatus: raw.registrationStatus,
    openedAt: raw.openedAt,
    fieldProvenance: provenance,
    dedupeKey: dedupeKey(raw),
    createdAt: at,
    updatedAt: at,
  };
}

/** Funde dois registros da mesma empresa: mantém o que já existe, completa lacunas. */
export function mergeInto(base: Company, extra: RawCompany): Company {
  const merged: Company = { ...base, fieldProvenance: { ...base.fieldProvenance } };
  const src: FieldSource = { provider: extra.provider, fetchedAt: nowIso() };
  for (const f of FIELDS) {
    const current = merged[f as keyof Company];
    const incoming = extra[f as keyof RawCompany];
    if (!current && incoming) {
      (merged as unknown as Record<string, unknown>)[f] = incoming;
      merged.fieldProvenance[f] = src;
    }
  }
  if (merged.whatsappStatus === 'desconhecido' && extra.whatsapp && extra.whatsappStatus && extra.whatsappStatus !== 'desconhecido') {
    merged.whatsappStatus = extra.whatsappStatus;
  }
  if (!merged.employeesMin && extra.employeesMin) merged.employeesMin = extra.employeesMin;
  merged.updatedAt = nowIso();
  return merged;
}

/** Campos que a Receita define com autoridade: substituem o que veio de outras fontes. */
const AUTHORITATIVE: CompanyField[] = ['legalName', 'cnpj', 'companySize', 'cnae', 'registrationStatus', 'openedAt'];

/** Aplica dados oficiais do CNPJ. Campos oficiais sobrescrevem; o resto só completa lacunas. */
export function applyCompanyData(base: Company, data: Partial<RawCompany>, provider: string): Company {
  const out: Company = { ...base, fieldProvenance: { ...base.fieldProvenance } };
  const src: FieldSource = { provider, fetchedAt: nowIso() };
  const rec = out as unknown as Record<string, unknown>;
  for (const f of FIELDS) {
    const incoming = (data as Record<string, unknown>)[f];
    if (!incoming) continue;
    if (AUTHORITATIVE.includes(f) || !rec[f]) {
      rec[f] = incoming;
      out.fieldProvenance[f] = src;
    }
  }
  if (data.employeesMin != null) out.employeesMin = data.employeesMin;
  out.updatedAt = nowIso();
  return out;
}

export const tierOf = (score: number): ScoreTier => (score >= 75 ? 'alta' : score >= 50 ? 'media' : 'baixa');

export const TIER_LABEL: Record<ScoreTier, string> = {
  alta: 'Alta oportunidade',
  media: 'Média oportunidade',
  baixa: 'Baixa oportunidade',
};

/**
 * Base determinística do score (0–100). Usa SOMENTE dados encontrados.
 * A IA só pode ajustar ±15 pontos sobre esta base (ver aiService).
 */
export function ruleScore(c: Company, profile: Pick<Profile, 'icpSegments' | 'icpRegions'>): { total: number; rules: ScoreRule[] } {
  const segOk = profile.icpSegments.some((s) => normalize(s) === normalize(c.segment));
  const regionOk = profile.icpRegions.some((r) => normalize(r) === normalize(c.city));
  const waPts = c.whatsappStatus === 'confirmado' ? 10 : c.whatsappStatus === 'provavel' ? 5 : 0;
  const social = (c.instagram ? 1 : 0) + (c.linkedin ? 1 : 0);
  const inactive = !!c.registrationStatus && c.registrationStatus.toUpperCase() !== 'ATIVA';
  const rules: ScoreRule[] = [
    {
      key: 'icp_segment',
      label: 'Segmento no ICP',
      max: 25,
      points: profile.icpSegments.length === 0 ? 15 : segOk ? 25 : 8,
      evidence: profile.icpSegments.length === 0 ? 'ICP sem segmentos definidos' : segOk ? `${c.segment} está no ICP` : `${c.segment} fora do ICP`,
    },
    {
      key: 'icp_region',
      label: 'Região no ICP',
      max: 20,
      points: profile.icpRegions.length === 0 ? 12 : regionOk ? 20 : 6,
      evidence: profile.icpRegions.length === 0 ? 'ICP sem regiões definidas' : regionOk ? `${c.city} está no ICP` : `${c.city} fora do ICP`,
    },
    {
      key: 'channels',
      label: 'Canais de contato',
      max: 20,
      points: Math.min(20, (c.phone ? 6 : 0) + waPts + social * 2),
      evidence: [c.phone && 'telefone', waPts && `WhatsApp ${c.whatsappStatus === 'confirmado' ? 'confirmado' : 'provável'}`, social && 'rede social']
        .filter(Boolean)
        .join(', ') || 'nenhum canal encontrado',
    },
    {
      key: 'digital',
      label: 'Presença digital',
      max: 15,
      points: Math.min(15, (c.website ? 9 : 0) + social * 3),
      evidence: c.website ? `site ${c.website}${social ? ' e redes' : ''}` : social ? 'só redes sociais' : 'sem site ou redes',
    },
    {
      key: 'company_data',
      label: 'Dados empresariais',
      max: 20,
      points: inactive ? 0 : (c.cnpj ? 8 : 0) + (c.employeesRange || c.companySize ? 7 : 0) + (c.address ? 5 : 0),
      evidence: inactive
        ? `CNPJ com situação ${c.registrationStatus}`
        : [c.cnpj && 'CNPJ', (c.employeesRange || c.companySize) && 'porte', c.address && 'endereço'].filter(Boolean).join(', ') || 'sem CNPJ, porte ou endereço',
    },
  ];
  return { total: rules.reduce((s, r) => s + r.points, 0), rules };
}
