import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawCompany } from '../../types';
import type { CompanyDataProvider, CompanySearchProvider } from '../types';

/** Lê a mensagem de erro que a Edge Function devolveu no corpo da resposta. */
async function invoke<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('providers', { body });
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx ? await ctx.json() : null;
      if (payload?.error) detail = payload.error;
    } catch {
      /* mantém a mensagem genérica */
    }
    throw new Error(detail);
  }
  return data as T;
}

/** Google Places via Edge Function `providers` (a chave fica no servidor). */
export function createGooglePlacesProvider(client: SupabaseClient): CompanySearchProvider {
  return {
    id: 'google_places',
    label: 'Google Places',
    // O Google não informa porte nem confirma WhatsApp: celular vira "provável".
    capabilities: ['segment', 'city', 'geo_radius', 'state', 'website', 'phone', 'whatsapp'],
    async search(criteria) {
      const r = await invoke<{ companies: RawCompany[] }>(client, { action: 'search', criteria });
      return r.companies ?? [];
    },
  };
}

/** BrasilAPI (dados públicos da Receita) via Edge Function `providers`. */
export function createBrasilApiProvider(client: SupabaseClient): CompanyDataProvider {
  return {
    id: 'brasilapi',
    label: 'BrasilAPI (Receita Federal)',
    // Informa o porte da Receita (ME/EPP/Demais), não o número de funcionários.
    capabilities: [],
    async enrichByCnpj(cnpj) {
      const r = await invoke<{ company: Partial<RawCompany> | null }>(client, { action: 'cnpj', cnpj });
      return r.company;
    },
  };
}
