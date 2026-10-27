// Instagram Agent — acesso do site. Leitura direta pelas tabelas (RLS da equipe);
// conectar/desconectar só pela função instagram-auth (tokens nunca chegam aqui).
import { supabase } from '@/lib/supabase';

export type IgMode = 'observador' | 'assistido' | 'automatico';

export interface IgAccount {
  id: string;
  igUserId: string;
  username: string | null;
  pageId: string | null;
  status: 'conectado' | 'expirado' | 'erro' | 'desconectado';
  scopes: string[];
  tokenExpiresAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

export interface IgSettings {
  enabled: boolean;
  accountId: string | null;
  mode: IgMode;
  personaExtra: string;
  dailyAiLimit: number;
  minScore: number;
  autoReply: boolean;
  handoffRules: string;
}

export type IgConvStatus = 'aberta' | 'humano' | 'encerrada';
export type IgClass = 'interessado' | 'reuniao' | 'duvida' | 'suporte' | 'nao_interessado' | 'opt_out' | 'outro';

export interface IgConversation {
  id: string;
  username: string | null;
  name: string | null;
  status: IgConvStatus;
  classification: IgClass | null;
  summary: string | null;
  leadId: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
}

export interface IgMessage {
  id: string;
  direction: 'entrada' | 'saida';
  body: string | null;
  suggested: string | null;
  status: 'recebida' | 'sugerida' | 'aprovada' | 'enviada' | 'falhou';
  auto: boolean;
  failureReason: string | null;
  createdAt: string;
}

export const IG_CLASS_LABEL: Record<IgClass, string> = {
  interessado: 'Interessado',
  reuniao: 'Quer conversar',
  duvida: 'Dúvida',
  suporte: 'Suporte',
  nao_interessado: 'Sem interesse',
  opt_out: 'Pediu para parar',
  outro: 'Outro',
};

/** A pessoa escreveu nas últimas 24 h? (regra do Instagram para responder) */
export function windowLeft(lastInboundAt: string | null, now = Date.now()): number {
  return lastInboundAt ? Math.max(0, new Date(lastInboundAt).getTime() + 24 * 3600_000 - now) : 0;
}

export const byteLength = (t: string) => new TextEncoder().encode(t).length;

export interface IgStatus {
  configured: boolean;
  tokenKey: boolean;
  redirectUri: string;
  scopes: string[];
}

export const IG_DEFAULTS: IgSettings = { enabled: false, accountId: null, mode: 'observador', personaExtra: '', dailyAiLimit: 100, minScore: 60, autoReply: false, handoffRules: '' };

/** Permissões que o módulo usa e o que cada uma libera (para a tela "permissões autorizadas"). */
export const IG_SCOPE_LABEL: Record<string, string> = {
  instagram_basic: 'Ver o perfil e as publicações da conta',
  instagram_manage_messages: 'Ler e responder o Direct',
  instagram_manage_comments: 'Ler e responder comentários nos seus posts',
  pages_show_list: 'Ver as Páginas do Facebook ligadas',
  pages_read_engagement: 'Ler dados da Página ligada',
  pages_manage_metadata: 'Receber avisos de mensagens novas (webhook)',
  business_management: 'Acessar Páginas do portfólio empresarial',
};

function need() {
  if (!supabase) throw new Error('Disponível só no modo real (Supabase).');
  return supabase;
}

const missingTable = (msg: string) => /instagram_|does not exist|schema cache/i.test(msg);

async function call<T>(body: Record<string, unknown>, fn = 'instagram-auth'): Promise<T> {
  const { data, error } = await need().functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || (/not found|404/i.test(error.message) ? `A função ${fn} ainda não foi publicada no Supabase.` : error.message));
  }
  return data as T;
}
const agent = <T>(body: Record<string, unknown>) => call<T>(body, 'instagram-agent');

/** Conta conectada com a situação real: vencida quando a autorização já expirou. */
export function effectiveStatus(a: IgAccount, now = Date.now()): IgAccount['status'] {
  if (a.status === 'conectado' && a.tokenExpiresAt && new Date(a.tokenExpiresAt).getTime() < now) return 'expirado';
  return a.status;
}

export function daysLeft(a: IgAccount, now = Date.now()): number | null {
  return a.tokenExpiresAt ? Math.floor((new Date(a.tokenExpiresAt).getTime() - now) / 86_400_000) : null;
}

export const instagramApi = {
  status: () => call<IgStatus>({ action: 'status' }),
  startConnect: () => call<{ url: string }>({ action: 'start' }),
  finishConnect: (code: string, state: string) => call<{ ok: true; accounts: { id: string; username: string | null }[]; declined: string[] }>({ action: 'callback', code, state }),
  disconnect: (accountId: string) => call<{ ok: true }>({ action: 'disconnect', accountId }),

  async accounts(): Promise<IgAccount[]> {
    const { data, error } = await need()
      .from('instagram_accounts')
      .select('id, ig_user_id, username, page_id, status, scopes, token_expires_at, last_error, connected_at')
      .order('connected_at', { ascending: false });
    if (error) throw new Error(missingTable(error.message) ? 'Falta aplicar a migration do Instagram Agent (npx supabase db push).' : error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      igUserId: r.ig_user_id,
      username: r.username,
      pageId: r.page_id,
      status: r.status,
      scopes: r.scopes ?? [],
      tokenExpiresAt: r.token_expires_at,
      lastError: r.last_error,
      connectedAt: r.connected_at,
    }));
  },

  async settings(): Promise<IgSettings> {
    const { data, error } = await need().from('instagram_settings').select('enabled, account_id, mode, persona_extra, daily_ai_limit, min_score, auto_reply, handoff_rules').maybeSingle();
    if (error) throw new Error(missingTable(error.message) ? 'Falta aplicar a migration do Instagram Agent (npx supabase db push).' : error.message);
    if (!data) return { ...IG_DEFAULTS };
    return {
      enabled: data.enabled,
      accountId: data.account_id,
      mode: data.mode,
      personaExtra: data.persona_extra ?? '',
      dailyAiLimit: data.daily_ai_limit,
      minScore: data.min_score,
      autoReply: !!data.auto_reply,
      handoffRules: data.handoff_rules ?? '',
    };
  },

  async saveSettings(s: IgSettings, ownerId: string): Promise<void> {
    const { error } = await need()
      .from('instagram_settings')
      .upsert(
        {
          owner_id: ownerId,
          enabled: s.enabled,
          account_id: s.accountId,
          mode: s.mode,
          persona_extra: s.personaExtra.trim() || null,
          daily_ai_limit: Math.max(0, Math.min(2000, Math.round(s.dailyAiLimit))),
          min_score: Math.max(0, Math.min(100, Math.round(s.minScore))),
          auto_reply: s.autoReply,
          handoff_rules: s.handoffRules.trim() || null,
        },
        { onConflict: 'owner_id' },
      );
    if (error) throw new Error(/row-level security/i.test(error.message) ? 'Só o administrador pode alterar as configurações do Instagram Agent.' : error.message);
  },

  // ---------- Inbox ----------
  async conversations(): Promise<IgConversation[]> {
    const { data, error } = await need()
      .from('instagram_conversations')
      .select('id, username, name, status, classification, summary, lead_id, last_inbound_at, last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(80);
    if (error) throw new Error(missingTable(error.message) ? 'Falta aplicar a migration do Instagram Agent (npx supabase db push).' : error.message);
    return (data ?? []).map((r) => ({ id: r.id, username: r.username, name: r.name, status: r.status, classification: r.classification, summary: r.summary, leadId: r.lead_id, lastInboundAt: r.last_inbound_at, lastMessageAt: r.last_message_at }));
  },

  async messages(conversationId: string): Promise<IgMessage[]> {
    const { data, error } = await need()
      .from('instagram_messages')
      .select('id, direction, body, suggested, status, auto, failure_reason, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, direction: r.direction, body: r.body, suggested: r.suggested, status: r.status, auto: !!r.auto, failureReason: r.failure_reason, createdAt: r.created_at }));
  },

  send: (conversationId: string, text: string, suggestionId?: string) => agent<{ ok: true }>({ action: 'send', conversationId, text, suggestionId }),
  suggest: (conversationId: string) => agent<{ status: string }>({ action: 'suggest', conversationId }),
  human: (conversationId: string, on: boolean) => agent<{ ok: true }>({ action: 'human', conversationId, on }),
  toLead: (conversationId: string) => agent<{ leadId: string; created: boolean }>({ action: 'lead', conversationId }),
  subscribe: () => agent<{ ok: boolean; accounts: { username: string | null; ok: boolean }[] }>({ action: 'subscribe' }),

  /** Indicadores reais (contagens nas tabelas do módulo). Sem integração, ficam em zero. */
  async metrics(minScore: number) {
    const db = need();
    const count = async (table: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let q = db.from(table).select('id', { count: 'exact', head: true });
      if (f) q = f(q);
      const { count: n, error } = await q;
      return error ? 0 : (n ?? 0);
    };
    const [perfis, oportunidades, sugeridos, aprovados, recebidas, atendimentos, qualificados, reunioes] = await Promise.all([
      count('instagram_opportunities', (q) => q.not('analyzed_at', 'is', null)),
      count('instagram_opportunities', (q) => q.gte('score', minScore)),
      count('instagram_interactions'),
      count('instagram_interactions', (q) => q.in('status', ['aprovada', 'executada', 'confirmada'])),
      count('instagram_messages', (q) => q.eq('direction', 'entrada')),
      count('instagram_conversations'),
      count('instagram_conversations', (q) => q.in('classification', ['interessado', 'reuniao'])),
      count('instagram_conversations', (q) => q.eq('classification', 'reuniao')),
    ]);
    return { perfis, oportunidades, sugeridos, aprovados, recebidas, atendimentos, qualificados, reunioes };
  },
};
