import { dataMode, searchProviderMode, supabase } from '@/lib/supabase';
import type { ProviderSet } from './types';
import { mockAIProvider } from './mock/mockAIProvider';
import { mockCompanyDataProvider, mockCompanySearchProvider, mockPlacesProvider, waLinkProvider } from './mock/mockProviders';
import { createRemoteAIProvider } from './remote/remoteAIProvider';
import { createBrasilApiProvider, createGooglePlacesProvider } from './remote/remoteProviders';

/**
 * Ponto único de escolha dos providers. Trocar um mock por uma API real
 * é mudar este arquivo (ou as variáveis de ambiente), nada mais.
 *
 * - mock:      tudo fictício, no navegador.
 * - supabase:  Google Places + BrasilAPI + Claude, todos via Edge Functions.
 *              Com VITE_SEARCH_PROVIDER=mock, a busca continua fictícia (útil sem chave do Google).
 */
export function createProviders(): ProviderSet {
  if (dataMode === 'supabase' && supabase) {
    const realSearch = searchProviderMode === 'google_places';
    return {
      companySearch: [realSearch ? createGooglePlacesProvider(supabase) : mockCompanySearchProvider],
      places: null, // o Google Places já é o provider de busca
      companyData: realSearch ? createBrasilApiProvider(supabase) : mockCompanyDataProvider,
      ai: createRemoteAIProvider(supabase),
      whatsapp: waLinkProvider,
    };
  }
  return {
    companySearch: [mockCompanySearchProvider],
    places: mockPlacesProvider,
    companyData: mockCompanyDataProvider,
    ai: mockAIProvider,
    whatsapp: waLinkProvider,
  };
}

export const providers = createProviders();
