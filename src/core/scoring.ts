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

/** Faixas de temperatura. 80–100 quente, 50–79 morno, 0–49 frio. */
export const TIER_THRESHOLDS = { hot: 80, warm: 50 };

export const tierOf = (score: number): ScoreTier => (score >= TIER_THRESHOLDS.hot ? 'alta' : score >= TIER_THRESHOLDS.warm ? 'media' : 'baixa');

export const TIER_LABEL: Record<ScoreTier, string> = {
  alta: 'Lead quente',
  media: 'Lead morno',
  baixa: 'Lead frio',
};

/**
 * Peso máximo de cada critério (soma 100). Ficam num lugar só para que,
 * no futuro, o usuário possa configurar os critérios sem mexer na lógica.
 */
export const SCORE_WEIGHTS = {
  icp_segment: 20,
  icp_region: 15,
  size: 10,
  contact: 10,
  channels: 15,
  digital: 10,
  engagement: 20,
};

export type Engagement = 'nenhum' | 'respondeu' | 'interessado' | 'reuniao' | 'nao_interessado';

export interface ScoreExtras {
  contactName?: string;
  contactRole?: string;
  email?: string;
  engagement?: Engagement;
}

const DECISION_ROLES = /(dono|socio|proprietari|diretor|ceo|gerente|gestor|coordenador|comprador|compras|head)/;

/**
 * Base determinística do score (0–100). Usa SOMENTE dados encontrados e o engajamento real.
 * A IA só pode ajustar ±15 pontos sobre esta base (ver aiService).
 */
export function ruleScore(c: Company, profile: Pick<Profile, 'icpSegments' | 'icpRegions'>, extras: ScoreExtras = {}): { total: number; rules: ScoreRule[] } {
  const W = SCORE_WEIGHTS;
  const segOk = profile.icpSegments.some((s) => normalize(s) === normalize(c.segment));
  const regionOk = profile.icpRegions.some((r) => normalize(r) === normalize(c.city));
  const waPts = c.whatsappStatus === 'confirmado' ? 6 : c.whatsappStatus === 'provavel' ? 3 : 0;
  const social = (c.instagram ? 1 : 0) + (c.linkedin ? 1 : 0);
  const inactive = !!c.registrationStatus && c.registrationStatus.toUpperCase() !== 'ATIVA';
  const sizeKnown = c.employeesRange || c.companySize;
  const bigger = (c.employeesMin ?? 0) >= 50 || /demais|pequeno porte/i.test(c.companySize ?? '');
  const decisionRole = extras.contactRole && DECISION_ROLES.test(normalize(extras.contactRole));
  const eng = extras.engagement ?? 'nenhum';
  const engPts = { nenhum: 6, respondeu: 13, interessado: 18, reuniao: 20, nao_interessado: 0 }[eng];
  const engText = { nenhum: 'ainda sem interação', respondeu: 'respondeu às mensagens', interessado: 'demonstrou interesse', reuniao: 'pediu reunião', nao_interessado: 'disse que não tem interesse' }[eng];
  const rules: ScoreRule[] = [
    {
      key: 'icp_segment',
      label: 'Segmento no ICP',
      max: W.icp_segment,
      points: profile.icpSegments.length === 0 ? 12 : segOk ? W.icp_segment : 6,
      evidence: profile.icpSegments.length === 0 ? 'ICP sem segmentos definidos' : segOk ? `${c.segment} está no ICP` : `${c.segment} fora do ICP`,
    },
    {
      key: 'icp_region',
      label: 'Localização',
      max: W.icp_region,
      points: profile.icpRegions.length === 0 ? 9 : regionOk ? W.icp_region : 4,
      evidence: profile.icpRegions.length === 0 ? 'ICP sem regiões definidas' : regionOk ? `${c.city} está no ICP` : `${c.city} fora do ICP`,
    },
    {
      key: 'size',
      label: 'Porte',
      max: W.size,
      points: inactive ? 0 : !sizeKnown ? 3 : bigger ? W.size : 6,
      evidence: inactive ? `CNPJ com situação ${c.registrationStatus}` : sizeKnown ? `${c.employeesRange ? `${c.employeesRange} funcionários` : c.companySize}` : 'porte não informado',
    },
    {
      key: 'contact',
      label: 'Contato e cargo',
      max: W.contact,
      points: Math.min(W.contact, (extras.contactName ? 3 : 0) + (extras.email ? 3 : 0) + (decisionRole ? 4 : extras.contactRole ? 2 : 0)),
      evidence: [extras.contactName && `contato ${extras.contactName}`, extras.contactRole && `cargo ${extras.contactRole}`, extras.email && 'e-mail'].filter(Boolean).join(', ') || 'sem contato direto',
    },
    {
      key: 'channels',
      label: 'Canais de contato',
      max: W.channels,
      points: Math.min(W.channels, (c.phone ? 5 : 0) + waPts + social * 2),
      evidence: [c.phone && 'telefone', waPts && `WhatsApp ${c.whatsappStatus === 'confirmado' ? 'confirmado' : 'provável'}`, social && 'rede social']
        .filter(Boolean)
        .join(', ') || 'nenhum canal encontrado',
    },
    {
      key: 'digital',
      label: 'Site e informações',
      max: W.digital,
      points: Math.min(W.digital, (c.website ? 5 : 0) + (c.cnpj ? 3 : 0) + (c.address ? 2 : 0)),
      evidence: [c.website && `site ${c.website}`, c.cnpj && 'CNPJ', c.address && 'endereço'].filter(Boolean).join(', ') || 'poucas informações encontradas',
    },
    { key: 'engagement', label: 'Engajamento', max: W.engagement, points: engPts, evidence: engText },
  ];
  return { total: rules.reduce((s, r) => s + r.points, 0), rules };
}
