import { dataMode, supabase } from '@/lib/supabase';
import { DEFAULT_ASSISTANT, withDefaults, type AssistantSettings } from '../../../supabase/functions/_shared/ai/assistantDefaults.ts';

export type { AssistantSettings };
export { DEFAULT_ASSISTANT };

const LOCAL_KEY = 'lh-assistant';

/** Conversa automática e áudio. */
export interface AssistantPrefs {
  autoReply: boolean;
  replyFormat: 'texto' | 'audio';
  voice: string;
}

export const DEFAULT_PREFS: AssistantPrefs = { autoReply: true, replyFormat: 'texto', voice: 'cedar' };

export const VOICES: { id: string; label: string }[] = [
  { id: 'cedar', label: 'Cedar (masculina, jovem e natural) — recomendada' },
  { id: 'verse', label: 'Verse (masculina, expressiva)' },
  { id: 'ash', label: 'Ash (masculina)' },
  { id: 'onyx', label: 'Onyx (masculina, grave)' },
  { id: 'echo', label: 'Echo (masculina, leve)' },
  { id: 'sage', label: 'Sage (neutra, calma)' },
  { id: 'alloy', label: 'Alloy (neutra)' },
  { id: 'marin', label: 'Marin (feminina, jovem e natural)' },
  { id: 'nova', label: 'Nova (feminina, clara)' },
  { id: 'shimmer', label: 'Shimmer (feminina, suave)' },
  { id: 'coral', label: 'Coral (feminina, calorosa)' },
];

export interface AssistantState {
  settings: AssistantSettings;
  prefs: AssistantPrefs;
  /** As colunas de conversa automática existem (migration aplicada). */
  prefsAvailable: boolean;
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
      const saved = raw ? JSON.parse(raw) : null;
      return { settings: withDefaults(saved), prefs: { ...DEFAULT_PREFS, ...(saved?.prefs ?? {}) }, prefsAvailable: true, custom: !!saved?.persona, available: true };
    } catch {
      return { settings: DEFAULT_ASSISTANT, prefs: DEFAULT_PREFS, prefsAvailable: true, custom: false, available: true };
    }
  }
  const { data, error } = await supabase.from('assistant_settings').select('name, persona, knowledge, playbooks').maybeSingle();
  if (error) return { settings: DEFAULT_ASSISTANT, prefs: DEFAULT_PREFS, prefsAvailable: false, custom: false, available: !missingTable(error.message) };
  const pr = await supabase.from('assistant_settings').select('auto_reply, reply_format, voice').maybeSingle();
  const prefs: AssistantPrefs = pr.data
    ? { autoReply: pr.data.auto_reply !== false, replyFormat: pr.data.reply_format === 'audio' ? 'audio' : 'texto', voice: pr.data.voice || 'cedar' }
    : DEFAULT_PREFS;
  return { settings: withDefaults(data), prefs, prefsAvailable: !pr.error, custom: !!data?.persona, available: true };
}

let sdrCache: { name: string; at: number } | null = null;
/** Nome do SDR que conversa com os leads ("Beelie"), com só a inicial maiúscula. Cache de 5 min. */
export async function sdrName(): Promise<string> {
  if (sdrCache && Date.now() - sdrCache.at < 300_000) return sdrCache.name;
  const raw = await loadAssistant()
    .then((r) => r.settings.name)
    .catch(() => DEFAULT_ASSISTANT.name);
  const v = (raw || 'Beelie').trim();
  const name = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  sdrCache = { name, at: Date.now() };
  return name;
}

export async function saveAssistant(s: AssistantSettings, prefs?: AssistantPrefs): Promise<void> {
  sdrCache = null;
  const clean = { name: s.name.trim(), persona: s.persona.trim(), knowledge: s.knowledge.trim(), playbooks: s.playbooks.trim() };
  if (dataMode !== 'supabase' || !supabase) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...clean, prefs }));
    } catch {
      throw new Error('Não foi possível salvar neste navegador.');
    }
    return;
  }
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Faça login de novo.');
  const row: Record<string, unknown> = { owner_id: u.user.id, ...clean, updated_at: new Date().toISOString() };
  if (prefs) Object.assign(row, { auto_reply: prefs.autoReply, reply_format: prefs.replyFormat, voice: prefs.voice });
  const { error } = await supabase.from('assistant_settings').upsert(row);
  if (error) throw new Error(missingTable(error.message) ? 'Falta aplicar a migration do assistente (npx supabase db push).' : error.message);
}

/** Volta ao texto padrão da OXYCOM (apaga o texto próprio). */
export async function resetAssistant(): Promise<void> {
  if (dataMode !== 'supabase' || !supabase) {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const prefs = raw ? JSON.parse(raw).prefs : undefined;
      if (prefs) localStorage.setItem(LOCAL_KEY, JSON.stringify({ prefs }));
      else localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await saveAssistant({ name: '', persona: '', knowledge: '', playbooks: '' });
}

/** Só a conversa automática e o áudio (sem mexer no texto). */
export async function savePrefs(s: AssistantSettings, prefs: AssistantPrefs, custom: boolean): Promise<void> {
  await saveAssistant(custom ? s : { name: s.name === DEFAULT_ASSISTANT.name ? '' : s.name, persona: '', knowledge: '', playbooks: '' }, prefs);
}
