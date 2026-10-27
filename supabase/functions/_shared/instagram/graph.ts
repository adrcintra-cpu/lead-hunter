// Instagram Agent — cliente da Graph API (Instagram API com login do Facebook).
// Só endpoints oficiais. Nada de scraping nem automação de navegador.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   META_APP_ID, META_APP_SECRET   app do Meta for Developers (login do Facebook para empresas)
//   META_GRAPH_VERSION             opcional, padrão v23.0
//   INSTAGRAM_SCOPES               opcional, para trocar a lista de permissões pedidas

export type Fetch = typeof fetch;

export const DEFAULT_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'business_management',
];

export interface MetaConfig {
  appId: string;
  appSecret: string;
  version: string;
  scopes: string[];
}

/** Configuração da Meta, ou null quando ainda não foi feita ("Aguardando configuração"). */
export function metaConfig(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): MetaConfig | null {
  const appId = env('META_APP_ID')?.trim();
  const appSecret = env('META_APP_SECRET')?.trim();
  if (!appId || !appSecret) return null;
  const version = /^v\d+\.\d+$/.test(env('META_GRAPH_VERSION') ?? '') ? env('META_GRAPH_VERSION')! : 'v23.0';
  const scopes = (env('INSTAGRAM_SCOPES') ?? '').split(/[\s,]+/).filter(Boolean);
  return { appId, appSecret, version, scopes: scopes.length ? scopes : DEFAULT_SCOPES };
}

export class MetaError extends Error {
  constructor(message: string, public code?: number, public subcode?: number, public kind: 'token' | 'permissao' | 'limite' | 'meta' | 'rede' = 'meta') {
    super(message);
  }
}

/** Erro da Meta em português claro (o que aconteceu e o que fazer). */
export function explainMeta(code?: number, subcode?: number, raw?: string): MetaError {
  if (code === 190 || code === 102) {
    const why = subcode === 460 ? 'a senha do Facebook foi trocada' : subcode === 463 ? 'a autorização venceu' : subcode === 458 ? 'o acesso ao app foi removido' : 'a autorização não vale mais';
    return new MetaError(`A conexão com o Instagram caiu: ${why}. Conecte a conta de novo.`, code, subcode, 'token');
  }
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300)) {
    return new MetaError('A Meta não liberou essa permissão para o app. Confira as permissões concedidas ou a revisão do app.', code, subcode, 'permissao');
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80002) {
    return new MetaError('Limite de uso da Meta atingido. O módulo tenta de novo mais tarde.', code, subcode, 'limite');
  }
  return new MetaError(`A Meta recusou o pedido${raw ? `: ${raw.slice(0, 200)}` : '.'}`, code, subcode, 'meta');
}

export async function graph<T = Record<string, unknown>>(
  cfg: MetaConfig,
  path: string,
  params: Record<string, string>,
  init: { method?: 'GET' | 'POST' | 'DELETE'; fetchImpl?: Fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${cfg.version}/${path.replace(/^\/+/, '')}`);
  const method = init.method ?? 'GET';
  const body = new URLSearchParams(params);
  if (method === 'GET' || method === 'DELETE') for (const [k, v] of body) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await (init.fetchImpl ?? fetch)(url.toString(), {
      method,
      ...(method === 'POST' ? { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    throw new MetaError('A Meta não respondeu. Tente de novo em instantes.', undefined, undefined, 'rede');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } } & T;
  if (!res.ok || data.error) throw explainMeta(data.error?.code, data.error?.error_subcode, data.error?.message);
  return data;
}

/** Endereço da tela de login do Facebook com as permissões do módulo. */
export function loginUrl(cfg: MetaConfig, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scopes.join(','));
  return u.toString();
}

export interface LinkedAccount {
  igUserId: string;
  username: string | null;
  pageId: string;
  pageName: string | null;
  pageToken: string;
}

export interface ConnectResult {
  accounts: LinkedAccount[];
  scopes: string[];
  declined: string[];
  expiresAt: string | null;
}

/**
 * Troca o código do login pelo acesso: token de usuário de longa duração → páginas com
 * Instagram profissional ligado (token de página, que não expira enquanto o acesso valer).
 */
export async function exchangeCode(cfg: MetaConfig, code: string, redirectUri: string, fetchImpl?: Fetch): Promise<ConnectResult> {
  const short = await graph<{ access_token: string }>(cfg, 'oauth/access_token', { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirectUri, code }, { fetchImpl });
  const long = await graph<{ access_token: string }>(cfg, 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.access_token }, { fetchImpl });
  const userToken = long.access_token;
  const [perms, pages, dbg] = await Promise.all([
    graph<{ data: { permission: string; status: string }[] }>(cfg, 'me/permissions', { access_token: userToken }, { fetchImpl }),
    graph<{ data: { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }[] }>(
      cfg,
      'me/accounts',
      { access_token: userToken, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' },
      { fetchImpl },
    ),
    graph<{ data: { expires_at?: number; data_access_expires_at?: number } }>(cfg, 'debug_token', { input_token: userToken, access_token: `${cfg.appId}|${cfg.appSecret}` }, { fetchImpl }).catch(() => ({ data: {} as { expires_at?: number; data_access_expires_at?: number } })),
  ]);
  const scopes = (perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  const declined = (perms.data ?? []).filter((p) => p.status !== 'granted').map((p) => p.permission);
  const accounts = (pages.data ?? [])
    .filter((p) => p.instagram_business_account?.id && p.access_token)
    .map((p) => ({ igUserId: p.instagram_business_account!.id, username: p.instagram_business_account!.username ?? null, pageId: p.id, pageName: p.name ?? null, pageToken: p.access_token! }));
  // Vale o que vencer primeiro: o token (0 = não expira) ou o acesso aos dados (90 dias).
  const ends = [dbg.data?.expires_at, dbg.data?.data_access_expires_at].filter((x): x is number => !!x && x > 0);
  const expiresAt = ends.length ? new Date(Math.min(...ends) * 1000).toISOString() : null;
  return { accounts, scopes, declined, expiresAt };
}
