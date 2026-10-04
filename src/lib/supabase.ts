import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type DataMode = 'mock' | 'supabase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const requested = (import.meta.env.VITE_DATA_MODE as string | undefined) ?? 'mock';

/** Só entra em modo supabase se as duas variáveis públicas existirem. */
export const dataMode: DataMode = requested === 'supabase' && url && anonKey ? 'supabase' : 'mock';

/** No modo supabase, a busca pode continuar fictícia enquanto não há chave do Google. */
export const searchProviderMode: 'google_places' | 'mock' =
  (import.meta.env.VITE_SEARCH_PROVIDER as string | undefined) === 'mock' ? 'mock' : 'google_places';

/** Cliente com a anon key (pública). Nenhuma chave secreta existe no frontend. */
export const supabase: SupabaseClient | null = dataMode === 'supabase' ? createClient(url!, anonKey!) : null;
