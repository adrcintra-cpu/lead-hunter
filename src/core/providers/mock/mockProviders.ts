import type { RawCompany, SearchCriteria } from '../../types';
import { distanceKm, normalize, sleep, toWhatsappNumber } from '../../utils';
import type { CompanyDataProvider, CompanySearchProvider, EmailSender, PlacesProvider, WhatsappProvider, WhatsappSender } from '../types';
import { CITY_COORDS, MOCK_COMPANIES } from './mockCompanies';

/** Sinônimos de segmento → segmentos do catálogo. */
const SEGMENT_GROUPS: { match: string; segments: string[] }[] = [
  { match: 'maquinas agricolas', segments: ['Máquinas agrícolas', 'Máquinas'] },
  { match: 'agro', segments: ['Agronegócio', 'Máquinas agrícolas'] },
  { match: 'industr', segments: ['Indústria'] },
  { match: 'odonto', segments: ['Clínicas'] },
  { match: 'clinica', segments: ['Clínicas'] },
  { match: 'logist', segments: ['Logística'] },
  { match: 'transport', segments: ['Logística'] },
  { match: 'tecnolog', segments: ['Tecnologia'] },
  { match: 'software', segments: ['Tecnologia'] },
  { match: 'maquina', segments: ['Máquinas', 'Máquinas agrícolas'] },
  { match: 'servic', segments: ['Serviços B2B'] },
  { match: 'consult', segments: ['Serviços B2B'] },
];

export function segmentMatches(companySegment: string, wanted: string): boolean {
  const w = normalize(wanted);
  if (!w || w === 'qualquer' || w === 'todos') return true;
  const group = SEGMENT_GROUPS.find((g) => w.includes(g.match));
  if (group) return group.segments.includes(companySegment);
  return normalize(companySegment).includes(w) || w.includes(normalize(companySegment));
}

function inRegion(c: RawCompany, criteria: SearchCriteria): boolean {
  if (criteria.city) {
    const center = CITY_COORDS[criteria.city];
    if (center && criteria.radiusKm && c.lat != null && c.lng != null) {
      return distanceKm(center, { lat: c.lat, lng: c.lng }) <= criteria.radiusKm;
    }
    return normalize(c.city) === normalize(criteria.city);
  }
  if (criteria.state) return c.state === criteria.state;
  return true;
}

export const mockCompanySearchProvider: CompanySearchProvider = {
  id: 'mock_search',
  label: 'Mock Busca',
  capabilities: ['segment', 'city', 'geo_radius', 'state', 'website', 'phone', 'whatsapp'],
  async search(criteria) {
    await sleep(350);
    return MOCK_COMPANIES.filter((c) => {
      if (!segmentMatches(c.segment, criteria.segment)) return false;
      if (!inRegion(c, criteria)) return false;
      if (criteria.requireWebsite === 'sim' && !c.website) return false;
      if (criteria.requirePhone === 'sim' && !c.phone) return false;
      if (criteria.whatsapp === 'obrigatorio' && (!c.whatsapp || c.whatsappStatus === 'desconhecido')) return false;
      return true;
    }).map((c) => {
      // Porte não vem da busca: quem informa é o companyDataProvider.
      const copy: RawCompany = { ...c };
      delete copy.employeesRange;
      delete copy.employeesMin;
      return copy;
    });
  },
};

/** Fase 2: Google Places. No mock não devolve nada além do que a busca já trouxe. */
export const mockPlacesProvider: PlacesProvider = {
  id: 'mock_places',
  label: 'Mock Places (Fase 2)',
  async lookup() {
    return null;
  },
};

/** Fase 2: provedor de CNPJ. No mock, devolve porte para CNPJs fictícios conhecidos. */
export const mockCompanyDataProvider: CompanyDataProvider = {
  id: 'mock_company_data',
  label: 'Mock Dados Empresariais',
  capabilities: ['employees'],
  async enrichByCnpj(cnpj) {
    await sleep(120);
    const d = cnpj.replace(/\D/g, '');
    const hit = MOCK_COMPANIES.find((c) => c.cnpj && c.cnpj.replace(/\D/g, '') === d);
    if (!hit) return null;
    return {
      provider: 'mock_company_data',
      cnpj: hit.cnpj,
      legalName: hit.legalName,
      employeesRange: hit.employeesRange,
      employeesMin: hit.employeesMin,
      registrationStatus: 'ATIVA',
    };
  },
};

export const waLinkProvider: WhatsappProvider = {
  id: 'wa_link',
  label: 'Link wa.me',
  buildLink(phone, text) {
    const d = toWhatsappNumber(phone);
    return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
  },
};

let mockSeq = 0;
const mockId = (p: string) => `${p}_${Date.now().toString(36)}_${(mockSeq++).toString(36)}`;

/** Simula a API oficial do WhatsApp: aceita o envio e devolve um id. Nada sai do navegador. */
export const mockWhatsappSender: WhatsappSender = {
  id: 'mock_whatsapp',
  label: 'WhatsApp simulado',
  async send({ to }) {
    await sleep(80);
    if (to.replace(/\D/g, '').length < 10) throw new Error('Número inválido para WhatsApp.');
    return { externalId: mockId('wamid'), provider: 'mock_whatsapp' };
  },
};

/** Simula o Resend. Nada é enviado de verdade. */
export const mockEmailSender: EmailSender = {
  id: 'mock_email',
  label: 'E-mail simulado',
  async send({ to }) {
    await sleep(80);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Endereço de e-mail inválido.');
    return { externalId: mockId('email'), provider: 'mock_email' };
  },
};
