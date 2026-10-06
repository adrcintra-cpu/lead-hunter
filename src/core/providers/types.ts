import type { ConversationSignals } from '../../../supabase/functions/_shared/automation/beelie.ts';
import type {
  AnalysisSections,
  Channel,
  Company,
  ParsedCriteria,
  RawCompany,
  SearchCriteria,
  CriteriaField,
  ReplyAnalysis,
  ReplyClass,
} from '../types';

/** O que um provider de busca consegue filtrar de verdade. */
export type Capability = 'segment' | 'city' | 'geo_radius' | 'state' | 'website' | 'phone' | 'whatsapp' | 'employees';

export interface CompanySearchProvider {
  id: string;
  label: string;
  capabilities: Capability[];
  search(criteria: SearchCriteria): Promise<RawCompany[]>;
}

/** Fase 2: Google Places. Busca por nome/região e devolve dados públicos de estabelecimento. */
export interface PlacesProvider {
  id: string;
  label: string;
  lookup(query: { name: string; city: string; state: string }): Promise<RawCompany | null>;
}

/** Fase 2: dados de CNPJ por provedor autorizado. */
export interface CompanyDataProvider {
  id: string;
  label: string;
  capabilities: Capability[];
  /** Devolve null quando o CNPJ não existe; lança erro quando é inválido ou a fonte falha. */
  enrichByCnpj(cnpj: string): Promise<Partial<RawCompany> | null>;
}

export interface ApproachOptions {
  variant: number;
  senderName: string;
  senderCompany: string;
  offer: string;
  /** Pessoa de contato, quando cadastrada. */
  contactName?: string;
  contactRole?: string;
  /** Posição na cadência: primeira mensagem, acompanhamento ou último contato. */
  stage?: 'primeira' | 'acompanhamento' | 'ultimo';
  /** Instruções extras do usuário para esta etapa. */
  instructions?: string;
  /** Mensagens já enviadas a este lead, da mais antiga para a mais recente (follow-up sem repetir). */
  history?: { channel: string; date: string; text: string }[];
  daysSinceLastContact?: number;
  /** Observações (notas) do usuário sobre o lead. */
  notes?: string[];
  campaignName?: string;
  /** Memória do Beelie sobre o lead (estágio, o que já se sabe). */
  brief?: string;
}

/** Números consolidados para a "leitura inteligente" do dashboard. */
export interface ResultsSnapshot {
  leads: number;
  inCadence: number;
  sent: number;
  delivered: number;
  read: number;
  replies: number;
  interested: number;
  meetings: number;
  optOuts: number;
  failed: number;
  openTasks: number;
  bySegment: { segment: string; sent: number; replies: number }[];
  byChannel: { channel: string; sent: number; replies: number }[];
  campaigns: { name: string; status: string; sent: number; replies: number }[];
}

export interface ScoreAdjustment {
  adjustment: number;
  reason: string;
}

/**
 * Provider de IA. Nunca é chamado direto pelos componentes:
 * sempre passa por core/ai/aiService.ts, que valida e audita.
 */
export interface AIProvider {
  id: string;
  model: string;
  promptVersion: string;
  parseSearchQuery(text: string): Promise<ParsedCriteria>;
  analyzeCompany(company: Company, icp: string): Promise<AnalysisSections>;
  summarizeCompany(company: Company): Promise<string>;
  adjustScore(company: Company, ruleScore: number, icp: string): Promise<ScoreAdjustment>;
  generateApproach(company: Company, channel: Channel, options: ApproachOptions): Promise<string>;
  /** Devolve a análise da resposta. Saídas antigas (só `classification`) são normalizadas pelo AIService. */
  classifyReply(
    text: string,
    context?: string,
    extra?: { conversation?: { from: 'lead' | 'beelie'; text: string }[]; brief?: string },
  ): Promise<Partial<ReplyAnalysis> & { classification?: ReplyClass } & Partial<ConversationSignals>>;
  summarizeResults(snapshot: ResultsSnapshot): Promise<string[]>;
  /** Próxima resposta da conversa, para o vendedor revisar (nunca enviada sozinha). */
  suggestReply(input: ReplySuggestionInput): Promise<ReplySuggestion>;
}

export interface ReplySuggestionInput {
  channel: string;
  category?: string;
  sender: { name?: string; company?: string; offer?: string };
  contact?: { name?: string; role?: string };
  company: Company;
  /** Conversa em ordem cronológica; a última mensagem é do lead. */
  conversation: { from: 'vendedor' | 'lead'; date: string; text: string }[];
  /** Memória do Beelie (estágio, o que já se sabe). */
  brief?: string;
  /** Persona, base de conhecimento e playbooks do atendimento. */
  assistant?: { name: string; persona: string; knowledge: string; playbooks: string };
}

export type ReplyIntent = 'continuar' | 'propor_conversa' | 'confirmar_conversa' | 'encerrar' | 'passar_para_vendedor';

export interface ReplySuggestion {
  message: string;
  intent: ReplyIntent | string;
  note: string;
}

export interface WhatsappProvider {
  id: string;
  label: string;
  /** Link wa.me para envio manual (sempre disponível). */
  buildLink(phone: string, text: string): string | null;
}

/** Resultado de um envio feito por um provedor de canal. */
export interface SendResult {
  externalId: string;
  provider: string;
}

/**
 * Envio automático de WhatsApp. Real: WhatsApp Business Platform (API oficial da Meta),
 * executado no servidor. Só é chamado para leads com opt-in registrado.
 */
export interface WhatsappSender {
  id: string;
  label: string;
  send(input: { to: string; text: string; templateName?: string; templateParams?: string[] }): Promise<SendResult>;
}

/** Envio de e-mail. Real: Resend, executado no servidor. */
export interface EmailSender {
  id: string;
  label: string;
  send(input: { from: string; fromName: string; to: string; subject: string; text: string; replyTo?: string }): Promise<SendResult>;
}

export interface ProviderSet {
  companySearch: CompanySearchProvider[];
  places: PlacesProvider | null;
  companyData: CompanyDataProvider | null;
  ai: AIProvider;
  whatsapp: WhatsappProvider;
  /** Envio automático. No modo supabase o envio acontece no servidor e estes ficam nulos. */
  whatsappSender: WhatsappSender | null;
  emailSender: EmailSender | null;
}

const criteriaCapability: Partial<Record<CriteriaField, Capability>> = {
  segment: 'segment',
  city: 'city',
  radiusKm: 'geo_radius',
  requireWebsite: 'website',
  requirePhone: 'phone',
  whatsapp: 'whatsapp',
  minEmployees: 'employees',
};

/** Critérios preenchidos que nenhum provider ativo consegue aplicar. */
export function unsupportedCriteria(criteria: SearchCriteria, providers: ProviderSet): CriteriaField[] {
  const caps = new Set<Capability>([
    ...providers.companySearch.flatMap((p) => p.capabilities),
    ...(providers.companyData?.capabilities ?? []),
  ]);
  const active: CriteriaField[] = [];
  if (criteria.minEmployees) active.push('minEmployees');
  if (criteria.radiusKm) active.push('radiusKm');
  if (criteria.requireWebsite === 'sim') active.push('requireWebsite');
  if (criteria.whatsapp !== 'indiferente') active.push('whatsapp');
  return active.filter((f) => {
    const cap = criteriaCapability[f];
    return cap ? !caps.has(cap) : false;
  });
}
