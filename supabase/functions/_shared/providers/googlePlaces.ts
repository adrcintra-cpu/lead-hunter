// Provider Google Places (API "Places (New)" — Text Search).
// Só dados públicos de estabelecimentos. Sem scraping de Google Maps.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

import type { RawCompany, SearchCriteria, WhatsappStatus } from './types.ts';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/** Campos pedidos. Telefone e site fazem a chamada cair no SKU mais caro; são o motivo da busca. */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.businessStatus',
  'nextPageToken',
].join(',');

/** Os termos do Google permitem guardar o place_id; o restante deve ser renovado. Usamos 30 dias. */
export const PLACES_CACHE_DAYS = 30;

const MAX_PAGES = 3; // 20 por página → até 60 empresas por busca
const MAX_BIAS_RADIUS_M = 50_000; // limite do locationBias da API

export interface PlacesApiPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  businessStatus?: string;
}

type Fetch = typeof fetch;

/**
 * Classifica o telefone para WhatsApp. O Google não informa WhatsApp:
 * um celular brasileiro (9 dígitos começando com 9) vira "provável"; fixo não é marcado.
 */
export function classifyPhone(phone?: string): { whatsapp?: string; status: WhatsappStatus } {
  if (!phone) return { status: 'desconhecido' };
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  const local = d.slice(2);
  if (d.length === 11 && local.startsWith('9')) return { whatsapp: phone, status: 'provavel' };
  return { status: 'desconhecido' };
}

function component(p: PlacesApiPlace, type: string, short = false): string | undefined {
  const c = p.addressComponents?.find((x) => x.types.includes(type));
  return c ? (short ? c.shortText : c.longText) : undefined;
}

export function normalizeWebsite(url?: string): string | undefined {
  if (!url) return undefined;
  const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  // Perfis em redes sociais não contam como site próprio.
  if (/(^|\.)(instagram|facebook|linktr|wa)\.(com|me|ee)$/.test(host)) return undefined;
  return host || undefined;
}

export function mapPlace(p: PlacesApiPlace, criteria: SearchCriteria, now = new Date()): RawCompany | null {
  const name = p.displayName?.text?.trim();
  if (!name) return null;
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return null;
  const city = component(p, 'administrative_area_level_2') ?? component(p, 'locality') ?? criteria.city ?? '';
  const state = component(p, 'administrative_area_level_1', true) ?? criteria.state ?? '';
  const wa = classifyPhone(p.nationalPhoneNumber);
  const site = p.websiteUri ?? '';
  const instagram = /instagram\.com\/([\w.]+)/i.exec(site)?.[1];
  const expires = new Date(now.getTime() + PLACES_CACHE_DAYS * 864e5).toISOString();
  return {
    provider: 'google_places',
    externalId: p.id,
    legalName: name,
    legalNameIsTradeName: true,
    tradeName: name,
    segment: criteria.segment,
    city,
    state,
    address: p.formattedAddress,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    website: normalizeWebsite(site),
    instagram: instagram ? `@${instagram}` : undefined,
    phone: p.nationalPhoneNumber,
    whatsapp: wa.whatsapp,
    whatsappStatus: wa.status,
    expiresAt: expires,
  };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Aplica os critérios que a API não filtra sozinha. */
export function applyCriteria(list: RawCompany[], criteria: SearchCriteria, center: { lat: number; lng: number } | null): RawCompany[] {
  return list.filter((c) => {
    if (center && criteria.radiusKm && c.lat != null && c.lng != null && distanceKm(center, { lat: c.lat, lng: c.lng }) > criteria.radiusKm) return false;
    if (!center && criteria.state && c.state && c.state !== criteria.state) return false;
    if (criteria.requireWebsite === 'sim' && !c.website) return false;
    if (criteria.requirePhone === 'sim' && !c.phone) return false;
    if (criteria.whatsapp === 'obrigatorio' && c.whatsappStatus === 'desconhecido') return false;
    return true;
  });
}

export function buildTextQuery(c: SearchCriteria): string {
  const where = c.city ? `${c.city}${c.state ? ` ${c.state}` : ''}` : c.regionLabel || (c.state ? `estado ${c.state}` : 'Brasil');
  return `${c.segment} em ${where}`;
}

async function call(apiKey: string, body: Record<string, unknown>, fieldMask: string, fetchImpl: Fetch) {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as { places?: PlacesApiPlace[]; nextPageToken?: string };
}

/** Centro da cidade (uma consulta barata, só com localização). */
export async function cityCenter(apiKey: string, city: string, state: string | null, fetchImpl: Fetch = fetch) {
  const data = await call(
    apiKey,
    { textQuery: `${city}${state ? `, ${state}` : ''}, Brasil`, includedType: 'locality', pageSize: 1, languageCode: 'pt-BR', regionCode: 'BR' },
    'places.location',
    fetchImpl,
  );
  const loc = data.places?.[0]?.location;
  return loc ? { lat: loc.latitude, lng: loc.longitude } : null;
}

export async function searchPlaces(apiKey: string, criteria: SearchCriteria, fetchImpl: Fetch = fetch) {
  const center = criteria.city ? await cityCenter(apiKey, criteria.city, criteria.state, fetchImpl) : null;
  const want = Math.max(1, Math.min(criteria.quantity, MAX_PAGES * 20));
  const body: Record<string, unknown> = { textQuery: buildTextQuery(criteria), languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 };
  if (center) {
    const radius = Math.min(MAX_BIAS_RADIUS_M, Math.max(1000, (criteria.radiusKm ?? 50) * 1000));
    body.locationBias = { circle: { center: { latitude: center.lat, longitude: center.lng }, radius } };
  }
  const found: RawCompany[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await call(apiKey, pageToken ? { ...body, pageToken } : body, FIELD_MASK, fetchImpl);
    for (const p of data.places ?? []) {
      const c = mapPlace(p, criteria);
      if (c) found.push(c);
    }
    pageToken = data.nextPageToken;
    if (!pageToken || applyCriteria(found, criteria, center).length >= want) break;
  }
  return { companies: applyCriteria(found, criteria, center), center };
}
