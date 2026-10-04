// Tipos compartilhados entre as Edge Functions e o frontend.
// Espelham RawCompany e SearchCriteria de src/core/types.ts.

export type WhatsappStatus = 'confirmado' | 'provavel' | 'desconhecido';

export interface SearchCriteria {
  segment: string;
  city: string | null;
  state: string | null;
  regionLabel: string;
  radiusKm: number | null;
  requireWebsite: 'sim' | 'indiferente';
  requirePhone: 'sim' | 'indiferente';
  whatsapp: 'obrigatorio' | 'preferencial' | 'indiferente';
  quantity: number;
  minEmployees: number | null;
}

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
  companySize?: string;
  cnae?: string;
  registrationStatus?: string;
  openedAt?: string;
  /** Até quando o dado pode ser guardado sem nova consulta (termos do provider). */
  expiresAt?: string;
}
