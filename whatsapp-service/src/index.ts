import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { log } from './log.js';
import { SessionManager } from './sessionManager.js';
import { ttsAvailable } from './tts.js';

/**
 * Serviço de WhatsApp do Lead Hunter (conexão por QR code).
 *
 *   Site (Vercel) → este serviço (rotas autenticadas) → SessionManager → Baileys → WhatsApp Web
 *
 * Toda rota /whatsapp/* exige o token de login do Supabase do próprio usuário.
 * O usuário é identificado pelo token, nunca por um parâmetro: ninguém acessa a sessão de outro.
 */

const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const manager = new SessionManager(db);

// ---------- utilidades HTTP ----------

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new HttpError(413, 'Requisição grande demais.');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

/** Valida o token do Supabase e devolve o id do usuário. Cache curto para não consultar a cada polling. */
const tokenCache = new Map<string, { userId: string; until: number }>();
async function authenticate(req: IncomingMessage): Promise<string> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 4096) throw new HttpError(401, 'Faça login para usar o WhatsApp.');
  const cached = tokenCache.get(token);
  if (cached && cached.until > Date.now()) return cached.userId;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    // Motivo técnico no log (sem o token), para diferenciar login expirado de configuração errada.
    const status = (error as { status?: number } | null)?.status;
    log.warn({ status, err: error?.message ?? 'sem usuário' }, 'token recusado');
    if (status === undefined || status >= 500 || /fetch|network|ENOTFOUND|Invalid API key|apikey/i.test(error?.message ?? '')) {
      throw new HttpError(503, 'O serviço de WhatsApp não conseguiu validar seu login. Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Railway.');
    }
    throw new HttpError(401, 'Sessão expirada. Entre de novo no Lead Hunter.');
  }
  tokenCache.set(token, { userId: data.user.id, until: Date.now() + 60_000 });
  if (tokenCache.size > 2000) {
    for (const [k, v] of tokenCache) if (v.until < Date.now()) tokenCache.delete(k);
  }
  return data.user.id;
}

/** Limite simples por usuário e por tipo de rota (janela de 1 minuto). */
const LIMITS: Record<string, number> = { status: 60, connect: 6, test: 10, disconnect: 6, send: 10 };
const hits = new Map<string, { count: number; reset: number }>();
function rateLimit(userId: string, kind: string) {
  const key = `${userId}:${kind}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { count: 1, reset: now + 60_000 });
    return;
  }
  h.count += 1;
  if (h.count > (LIMITS[kind] ?? 30)) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 5 * 60_000).unref();

// ---------- rotas ----------

type Handler = (userId: string, body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, { method: 'GET' | 'POST'; kind: string; handler: Handler }> = {
  '/whatsapp/status': { method: 'GET', kind: 'status', handler: async (u) => ({ ...(await manager.status(u)), audio: ttsAvailable() }) },
  '/whatsapp/connect': { method: 'POST', kind: 'connect', handler: (u) => manager.connect(u) },
  '/whatsapp/test': { method: 'POST', kind: 'test', handler: (u) => manager.test(u) },
  '/whatsapp/disconnect': {
    method: 'POST',
    kind: 'disconnect',
    handler: async (u) => {
      await manager.disconnect(u);
      return manager.view(u);
    },
  },
  '/whatsapp/send': {
    method: 'POST',
    kind: 'send',
    handler: async (u, body) => {
      const phone = typeof body.phone === 'string' ? body.phone.slice(0, 40) : '';
      const message = typeof body.message === 'string' ? body.message : '';
      if (!phone || !message) throw new HttpError(400, 'Informe telefone e mensagem.');
      const audio = body.audio === true;
      const voice = typeof body.voice === 'string' ? body.voice.slice(0, 20) : undefined;
      if (audio && message.length > 1500) throw new HttpError(400, 'Texto longo demais para áudio (máx. 1.500 caracteres).');
      return manager.sendMessage(u, phone, message, { audio, voice });
    },
  },
};

const server = createServer(async (req, res) => {
  cors(req, res);
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === '/health') return send(res, 200, { ok: true });
    const route = routes[path];
    if (!route) throw new HttpError(404, 'Rota não encontrada.');
    if (req.method !== route.method) throw new HttpError(405, 'Método não permitido.');
    const userId = await authenticate(req);
    rateLimit(userId, route.kind);
    const body = route.method === 'POST' ? await readJson(req) : {};
    const result = await route.handler(userId, body);
    send(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    log.error({ path, err: err instanceof Error ? err.message : String(err) }, 'erro interno');
    send(res, 500, { error: 'Erro interno no serviço de WhatsApp.' });
  }
});

server.listen(config.port, () => {
  log.info({ port: config.port, origins: config.allowedOrigins.length }, 'serviço de WhatsApp no ar');
  void manager.restoreAll();
});

async function stop(signal: string) {
  log.info({ signal }, 'desligando');
  server.close();
  await manager.shutdown();
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
process.on('unhandledRejection', (err) => log.error({ err: String(err) }, 'promessa rejeitada sem tratamento'));

