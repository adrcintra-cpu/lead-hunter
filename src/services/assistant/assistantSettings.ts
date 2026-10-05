import { dataMode, supabase } from '@/lib/supabase';
import { DEFAULT_ASSISTANT, withDefaults, type AssistantSettings } from '../../../supabase/functions/_shared/ai/assistantDefaults.ts';

export type { AssistantSettings };
export { DEFAULT_ASSISTANT };

const LOCAL_KEY = 'lh-assistant';

export interface AssistantState {
  settings: AssistantSettings;
  /** O usuário já salvou um texto próprio (senão é o padrão da OXYCOM). */
  custom: boolean;
  /** A tabela existe no banco (migration aplicada). No modo de teste é sempre true. */
  available: boolean;
}

const missingTable = (msg?: string) => !!msg && /assistant_settings|does not exist|schema cache|42P01/i.test(msg);

/** Persona, base de conhecimento e playbooks do assistente. Sem nada salvo, devolve o padrão. */
export async function loadAssistant(): Promise<AssistantState> {
  if (dataMode !== 'supabase' || !supabase) {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return { settings: withDefaults(raw ? JSON.parse(raw) : null), custom: !!raw, available: true };
    } catch {
      return { settings: DEFAULT_ASSISTANT, custom: false, available: true };
    }
  }
  const { data, error } = await supabase.from('assistant_settings').select('name, persona, knowledge, playbooks').maybeSingle();
  if (error) return { settings: DEFAULT_ASSISTANT, custom: false, available: !missingTable(error.message) };
  return { settings: withDefaults(data), custom: !!data, available: true };
}

export async function saveAssistant(s: AssistantSettings): Promise<void> {
  const clean = { name: s.name.trim(), persona: s.persona.trim(), knowledge: s.knowledge.trim(), playbooks: s.playbooks.trim() };
  if (dataMode !== 'supabase' || !supabase) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(clean));
    } catch {
      throw new Error('Não foi possível salvar neste navegador.');
    }
    return;
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Faça login de novo.');
  const { error } = await supabase.from('assistant_settings').upsert({ owner_id: u.user.id, ...clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(missingTable(error.message) ? 'Falta aplicar a migration do assistente (npx supabase db push).' : error.message);
}

/** Volta ao texto padrão da OXYCOM (apaga o texto próprio). */
export async function resetAssistant(): Promise<void> {
  if (dataMode !== 'supabase' || !supabase) {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await saveAssistant({ name: '', persona: '', knowledge: '', playbooks: '' });
}
