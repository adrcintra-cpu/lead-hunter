// Tipos de domínio do Lead Hunter. Espelham as tabelas em supabase/migrations.

export type WhatsappStatus = 'confirmado' | 'provavel' | 'desconhecido';
export type ScoreTier = 'alta' | 'media' | 'baixa';
export type Channel = 'whatsapp' | 'email' | 'linkedin';

export type LeadStage =
  | 'novo'
  | 'qualificado'
  | 'contato_preparado'
  | 'contatado'
  | 'respondeu'
  | 'reuniao'
  | 'proposta'
  | 'cliente'
  | 'descartado';

export const STAGES: { id: LeadStage; label: string }[] = [
  { id: 'novo', label: 'Novo' },
  { id: 'qualificado', label: 'Qualificado' },
  { id: 'contato_preparado', label: 'Contato preparado' },
  { id: 'contatado', label: 'Contatado' },
  { id: 'respondeu', label: 'Respondeu' },
  { id: 'reuniao', label: 'Reunião' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'descartado', label: 'Descartado' },
];

export const stageLabel = (s: LeadStage) => STAGES.find((x) => x.id === s)?.label ?? s;

/** Campos de empresa que carregam proveniência. */
export type CompanyField =
  | 'legalName'
  | 'tradeName'
  | 'cnpj'
  | 'segment'
  | 'city'
  | 'state'
  | 'address'
  | 'website'
  | 'phone'
  | 'whatsapp'
  | 'instagram'
  | 'linkedin'
  | 'employeesRange'
  | 'companySize'
  | 'cnae'
  | 'registrationStatus'
  | 'openedAt';

export interface FieldSource {
  provider: string;
  fetchedAt: string;
}

/** Dado bruto devolvido por um provider, antes de normalizar. */
export interface RawCompany {
  provider: string;
  externalId: string;
  legalName: string;
  /** true quando legalName é só o nome comercial (ex.: Google Places), não a razão social. */
  legalNameIsTradeName?: boolean;
  tradeName?: string;
  cnpj?: string;
  segment: string;
  city: string;
  state: string;
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  phone?: string;
  whatsapp?: string;
  whatsappStatus?: WhatsappStatus;
  instagram?: string;
  linkedin?: string;
  employeesRange?: string;
  employeesMin?: number;
  /** Porte segundo a Receita (ME, EPP, Demais) — não é número de funcionários. */
  companySize?: string;
  cnae?: string;
  registrationStatus?: string;
  openedAt?: string;
  /** Até quando o dado pode ser guardado sem nova consulta (termos do provider). */
  expiresAt?: string;
}

export interface Company {
  id: string;
  legalName: string;
  tradeName?: string;
  cnpj?: string;
  segment: string;
  city: string;
  state: string;
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  phone?: string;
  whatsapp?: string;
  whatsappStatus: WhatsappStatus;
  instagram?: string;
  linkedin?: string;
  employeesRange?: string;
  employeesMin?: number;
  companySize?: string;
  cnae?: string;
  registrationStatus?: string;
  openedAt?: string;
  fieldProvenance: Partial<Record<CompanyField, FieldSource>>;
  dedupeKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Registro de cada vez que uma fonte trouxe a empresa (tabela lead_sources). */
export interface LeadSource {
  id: string;
  companyId: string;
  searchId?: string;
  provider: string;
  externalId?: string;
  fetchedAt: string;
  expiresAt?: string;
}

export interface Lead {
  id: string;
  companyId: string;
  stage: LeadStage;
  currentScore: number;
  scoreTier: ScoreTier;
  firstSearchId?: string;
  origin: string;
  discoveredAt: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreRule {
  key: string;
  label: string;
  points: number;
  max: number;
  evidence: string;
}

export interface LeadScore {
  id: string;
  leadId: string;
  score: number;
  tier: ScoreTier;
  ruleScore: number;
  aiAdjustment: number;
  breakdown: ScoreRule[];
  justification: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export type AnalysisKind = 'fact' | 'inference' | 'unavailable';

export interface AnalysisItem {
  text: string;
  kind: AnalysisKind;
  /** Obrigatório quando kind = 'fact'. */
  evidenceField?: CompanyField;
}

export type AnalysisSectionKey = 'summary' | 'profile' | 'digitalPresence' | 'opportunities' | 'needs' | 'arguments';

export const ANALYSIS_SECTIONS: { key: AnalysisSectionKey; label: string }[] = [
  { key: 'summary', label: 'Resumo da empresa' },
  { key: 'profile', label: 'Possível perfil' },
  { key: 'digitalPresence', label: 'Presença digital' },
  { key: 'opportunities', label: 'Oportunidades identificadas' },
  { key: 'needs', label: 'Possíveis necessidades' },
  { key: 'arguments', label: 'Argumentos comerciais' },
];

export type AnalysisSections = Record<AnalysisSectionKey, AnalysisItem[]>;

export interface CompanyAnalysis {
  id: string;
  leadId: string;
  sections: AnalysisSections;
  model: string;
  promptVersion: string;
  createdAt: string;
}

export interface LeadNote {
  id: string;
  leadId: string;
  body: string;
  createdAt: string;
}

export type ActivityType =
  | 'discovered'
  | 'scored'
  | 'enriched'
  | 'analyzed'
  | 'stage_changed'
  | 'message_generated'
  | 'message_copied'
  | 'whatsapp_opened'
  | 'note_added'
  | 'list_added'
  | 'list_removed';

export interface LeadActivity {
  id: string;
  leadId: string;
  type: ActivityType;
  description: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface LeadList {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListMember {
  id: string; // `${listId}:${leadId}`
  listId: string;
  leadId: string;
  addedAt: string;
}

export type YesOrAny = 'sim' | 'indiferente';
export type WhatsappRequirement = 'obrigatorio' | 'preferencial' | 'indiferente';

export interface SearchCriteria {
  segment: string;
  city: string | null;
  state: string | null;
  regionLabel: string;
  radiusKm: number | null;
  requireWebsite: YesOrAny;
  requirePhone: YesOrAny;
  whatsapp: WhatsappRequirement;
  quantity: number;
  minEmployees: number | null;
}

export type CriteriaField = keyof SearchCriteria;

export interface ParsedCriteria {
  criteria: SearchCriteria;
  /** 0–1 por campo; abaixo de 0.5 a interface pede confirmação. */
  confidence: Partial<Record<CriteriaField, number>>;
}

export type SearchStatus = 'draft' | 'running' | 'done' | 'error';

export interface Search {
  id: string;
  rawQuery: string;
  parsedCriteria: SearchCriteria;
  confirmedCriteria?: SearchCriteria;
  status: SearchStatus;
  providersUsed: string[];
  ignoredCriteria: CriteriaField[];
  resultCount: number;
  newCount: number;
  duplicatesRemoved: number;
  savedSearchId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  rawQuery: string;
  criteria: SearchCriteria;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  searchId: string;
  companyId: string;
  leadId: string;
  rank: number;
  provider: string;
  wasDuplicate: boolean;
}

export type MessageStatus = 'draft' | 'copied' | 'opened_whatsapp';

export interface Message {
  id: string;
  leadId: string;
  channel: Channel;
  generatedContent: string;
  finalContent: string;
  status: MessageStatus;
  model: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuppressionEntry {
  id: string;
  kind: 'phone' | 'email' | 'cnpj';
  value: string;
  reason: string;
  createdAt: string;
}

export interface AIRun {
  id: string;
  fn: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  status: 'ok' | 'error';
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  companyName: string;
  offer: string;
  icpSegments: string[];
  icpRegions: string[];
  createdAt: string;
  updatedAt: string;
}
