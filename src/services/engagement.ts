// Engajamento social assistido: leitura direta (RLS da equipe); montar a fila e marcar como feito
// passam pela função `engagement`. Comentários e convites a pessoa envia; curtir pode ser automático.
import { supabase } from '@/lib/supabase';

export type EngChannel = 'instagram' | 'linkedin';
export type EngKind = 'comentario' | 'convite' | 'mensagem' | 'resposta';

export interface EngItem {
  id: string;
  channel: EngChannel;
  kind: EngKind;
  leadId: string | null;
  title: string;
  profileUrl: string | null;
  targetUrl: string | null;
  context: string | null;
  suggestion: string;
  finalText: string | null;
  status: 'sugerida' | 'feita' | 'descartada';
  forDate: string;
  doneAt: string | null;
  mediaId: string | null;
  externalId: string | null;
  likedAt: string | null;
  likeError: string | null;
}

export interface EngTheme {
  name: string;
  hashtags: string[];
  enabled: boolean;
}

export interface EngSettings {
  hashtags: string[];
  themes: EngTheme[];
  /** % das vagas diárias do Instagram para os temas (o resto vai para os leads). */
  themeShare: number;
  dailyInstagram: number;
  dailyLinkedin: number;
  linkedinRoles: string;
  /** Curtida automática (API oficial da Meta). */
  autoLike: boolean;
  dailyLikes: number;
}

const FOLLOW_MARK = '\n\nMensagem para depois que aceitar o convite:\n';
/** Contexto sem a mensagem seguinte guardada para depois do convite. */
export const contextOf = (i: EngItem) => (i.context ?? '').split(FOLLOW_MARK)[0];
export const followUpOf = (i: EngItem) => (i.context ?? '').split(FOLLOW_MARK)[1] ?? '';

function need() {
  if (!supabase) throw new Error('Disponível só no modo real (Supabase).');
  return supabase;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await need().functions.invoke('engagement', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || (/not found|404/i.test(error.message) ? 'A função engagement ainda não foi publicada no Supabase.' : error.message));
  }
  return data as T;
}

const map = (r: Record<string, unknown>): EngItem => ({
  id: String(r.id),
  channel: r.channel as EngChannel,
  kind: r.kind as EngKind,
  leadId: (r.lead_id as string) ?? null,
  title: String(r.title ?? ''),
  profileUrl: (r.profile_url as string) ?? null,
  targetUrl: (r.target_url as string) ?? null,
  context: (r.context as string) ?? null,
  suggestion: String(r.suggestion ?? ''),
  finalText: (r.final_text as string) ?? null,
  status: r.status as EngItem['status'],
  forDate: String(r.for_date),
  doneAt: (r.done_at as string) ?? null,
  mediaId: (r.media_id as string) ?? null,
  externalId: (r.external_id as string) ?? null,
  likedAt: (r.liked_at as string) ?? null,
  likeError: (r.like_error as string) ?? null,
});

export async function loadQueue(today: string): Promise<{ pending: EngItem[]; done: EngItem[] }> {
  const db = need();
  const [p, d] = await Promise.all([
    db.from('engagement_queue').select('*').eq('status', 'sugerida').lte('for_date', today).order('channel').order('created_at'),
    db.from('engagement_queue').select('*').eq('status', 'feita').gte('done_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('done_at', { ascending: false }).limit(50),
  ]);
  if (p.error) throw new Error(p.error.message);
  if (d.error) throw new Error(d.error.message);
  return { pending: (p.data ?? []).map(map), done: (d.data ?? []).map(map) };
}

export async function loadSettings(): Promise<EngSettings> {
  const { data, error } = await need().from('engagement_settings').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return {
    hashtags: (data?.hashtags as string[]) ?? [],
    themes: Array.isArray(data?.themes) ? (data!.themes as EngTheme[]).map((t) => ({ name: String(t.name ?? ''), hashtags: Array.isArray(t.hashtags) ? t.hashtags.map(String) : [], enabled: t.enabled !== false })) : [],
    themeShare: typeof data?.theme_share === 'number' ? (data.theme_share as number) : 50,
    dailyInstagram: (data?.daily_instagram as number) ?? 10,
    dailyLinkedin: (data?.daily_linkedin as number) ?? 10,
    linkedinRoles: (data?.linkedin_roles as string) ?? 'sócio, diretor, gerente comercial, gerente de marketing',
    autoLike: data?.auto_like === true,
    dailyLikes: typeof data?.daily_likes === 'number' ? (data.daily_likes as number) : 20,
  };
}

export async function saveSettings(ownerId: string, s: EngSettings) {
  const { error } = await need()
    .from('engagement_settings')
    .upsert({ owner_id: ownerId, hashtags: s.hashtags, themes: s.themes, theme_share: s.themeShare, daily_instagram: s.dailyInstagram, daily_linkedin: s.dailyLinkedin, linkedin_roles: s.linkedinRoles, auto_like: s.autoLike, daily_likes: s.dailyLikes, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const buildQueue = () => call<{ created: number; notes: string[] }>({ action: 'build' });
export const markDone = (id: string, finalText: string, profileUrl?: string) => call<{ ok: true }>({ action: 'done', id, finalText, profileUrl });
export const discard = (id: string) => call<{ ok: true }>({ action: 'discard', id });
export const replyComment = (id: string, finalText: string) => call<{ ok: true }>({ action: 'reply', id, finalText });
export const likeNow = (id: string) => call<{ ok: true; already?: boolean }>({ action: 'like', id });
/** Curtidas automáticas de hoje (a partir da meia-noite de São Paulo). */
export async function likesToday(today: string): Promise<number> {
  const { count } = await need().from('engagement_queue').select('id', { count: 'exact', head: true }).gte('liked_at', `${today}T03:00:00Z`);
  return count ?? 0;
}
export const leadFromComment = (id: string) => call<{ ok: true; leadId: string; created: boolean }>({ action: 'lead', id });

/** Nome curto para busca: tira o descritivo do Google ("Fulana - Advogada especialista em …"). */
export function shortName(name: string): string {
  const base = name.split(/\s+[-–—|:•·]\s+|\s*[|:•]\s*|\(/)[0].replace(/["“”]/g, '').trim();
  return base.split(/\s+/).slice(0, 5).join(' ');
}
/** Links de busca do LinkedIn (dentro do LinkedIn) e do Google (perfis públicos do LinkedIn). */
export function linkedinLinks(i: EngItem) {
  const name = shortName(i.title);
  const city = (contextOf(i).match(/—[^,]*,\s*([^.]+)\./)?.[1] ?? '').trim();
  return {
    isSearch: !!i.profileUrl?.includes('/search/'),
    linkedin: i.profileUrl?.includes('/search/') ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}` : i.profileUrl,
    google: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${name}"${city ? ` ${city}` : ''}`)}`,
  };
}
