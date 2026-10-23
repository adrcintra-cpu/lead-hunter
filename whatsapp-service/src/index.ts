import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { log } from './log.js';
import { MAIN_SLOT, SessionManager, SLOT_RE } from './sessionManager.js';
import { CampaignQueue } from './campaignQueue.js';
import { timingSafeEqual } from 'node:crypto';
import { ttsAvailable, voicePreview } from './tts.js';

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
const campaigns = new CampaignQueue(
  (u, slot, phone, text) => manager.sendMessage(u, slot, phone, text, { typing: true, own: true }),
  (u, slot) => manager.isConnected(u, slot),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function secretOk(req: IncomingMessage) {
  const got = Buffer.from(String(req.headers['x-inbound-secret'] ?? ''));
  const want = Buffer.from(config.inboundSecret);
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

/** Rota interna: o agendador de campanhas (Supabase) entrega uma mensagem para a fila. Autenticada pelo segredo compartilhado. */
async function campaignSend(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!secretOk(req)) throw new HttpError(401, 'Não autorizado.');
  const b = await readJson(req);
  const ownerId = String(b.ownerId ?? '');
  // Número escolhido pelo agendador (o do lead). Sem número (versão antiga das funções): o principal ou outro conectado.
  const wanted = typeof b.slot === 'string' && SLOT_RE.test(b.slot) ? b.slot : null;
  const slot = wanted ?? (UUID.test(ownerId) ? manager.pickSlot(ownerId) : null) ?? MAIN_SLOT;
  const job = {
    ownerId,
    slot,
    leadId: String(b.leadId ?? ''),
    messageId: String(b.messageId ?? ''),
    phone: typeof b.phone === 'string' ? b.phone.slice(0, 40) : '',
    text: typeof b.text === 'string' ? b.text.slice(0, 4000) : '',
  };
  if (!UUID.test(job.ownerId) || !UUID.test(job.leadId) || !UUID.test(job.messageId) || !job.phone || !job.text.trim()) throw new HttpError(400, 'Dados inválidos.');
  if (!campaigns.enqueue(job)) throw new HttpError(409, 'WhatsApp não conectado.');
  send(res, 202, { queued: true, slot, pending: campaigns.pending(job.ownerId, slot) });
}

/** Rota interna: aviso ou relatório para o WhatsApp pessoal do dono (o número vem das configurações dele, não do pedido). */
async function ownerNotify(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!secretOk(req)) throw new HttpError(401, 'Não autorizado.');
  const b = await readJson(req);
  const ownerId = String(b.ownerId ?? '');
  const text = typeof b.text === 'string' ? b.text.slice(0, 3500) : '';
  if (!UUID.test(ownerId) || !text.trim()) throw new HttpError(400, 'Dados inválidos.');
  const ok = await manager.notifyOwner(ownerId, text);
  send(res, ok ? 200 : 409, { sent: ok });
}

/** Quais destes telefones têm WhatsApp (consulta pelo WhatsApp conectado do usuário, sem mandar mensagem). */
async function waCheck(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!secretOk(req)) throw new HttpError(401, 'Não autorizado.');
  const b = await readJson(req);
  const ownerId = String(b.ownerId ?? '');
  const phones = Array.isArray(b.phones) ? b.phones.filter((x): x is string => typeof x === 'string').slice(0, 60) : [];
  if (!UUID.test(ownerId)) throw new HttpError(400, 'Dados inválidos.');
  const r = await manager.checkWhatsapp(ownerId, phones);
  send(res, r.ok ? 200 : 409, r);
}

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
const LIMITS: Record<string, number> = { status: 60, connect: 6, test: 10, disconnect: 6, send: 10, preview: 12 };
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

/** Número em que o lead já conversa (última mensagem enviada ou recebida com número). */
async function leadSlot(userId: string, leadId: string): Promise<string | null> {
  const [out, inb] = await Promise.all([
    db.from('messages').select('wa_slot, created_at').eq('owner_id', userId).eq('lead_id', leadId).eq('channel', 'whatsapp').not('wa_slot', 'is', null).order('created_at', { ascending: false }).limit(1),
    db.from('inbound_messages').select('wa_slot, received_at').eq('owner_id', userId).eq('lead_id', leadId).not('wa_slot', 'is', null).order('received_at', { ascending: false }).limit(1),
  ]);
  const o = (out.data ?? [])[0] as { wa_slot: string; created_at: string } | undefined;
  const i = (inb.data ?? [])[0] as { wa_slot: string; received_at: string } | undefined;
  const last = !o ? i?.wa_slot : !i ? o.wa_slot : i.received_at > o.created_at ? i.wa_slot : o.wa_slot;
  return last && SLOT_RE.test(last) ? last : null;
}

// ---------- rotas ----------

type Handler = (userId: string, body: Record<string, unknown>, query: URLSearchParams) => Promise<unknown>;

/** Número pedido pela tela (corpo ou ?slot=). Sem número: o principal. */
function slotOf(body: Record<string, unknown>, query?: URLSearchParams): string {
  const raw = typeof body.slot === 'string' ? body.slot : query?.get('slot') ?? '';
  if (!raw) return MAIN_SLOT;
  if (!SLOT_RE.test(raw)) throw new HttpError(400, 'Número inválido.');
  return raw;
}
function optionalSlot(body: Record<string, unknown>, query?: URLSearchParams): string | undefined {
  const has = typeof body.slot === 'string' || !!query?.get('slot');
  return has ? slotOf(body, query) : undefined;
}

const routes: Record<string, { method: 'GET' | 'POST'; kind: string; handler: Handler }> = {
  '/whatsapp/status': { method: 'GET', kind: 'status', handler: async (u, _b, q) => ({ ...(await manager.status(u, optionalSlot({}, q))), audio: ttsAvailable() }) },
  '/whatsapp/connect': { method: 'POST', kind: 'connect', handler: (u, b) => manager.connect(u, slotOf(b)) },
  '/whatsapp/test': { method: 'POST', kind: 'test', handler: (u, b) => manager.test(u, slotOf(b)) },
  '/whatsapp/disconnect': {
    method: 'POST',
    kind: 'disconnect',
    handler: async (u, b) => {
      const slot = slotOf(b);
      await manager.disconnect(u, slot);
      return manager.view(u, slot);
    },
  },
  // Vários números: lista, novo número (já com QR), nome/limite/ligado e remover.
  '/whatsapp/numbers': { method: 'GET', kind: 'status', handler: async (u) => ({ numbers: await manager.list(u) }) },
  '/whatsapp/numbers/add': {
    method: 'POST',
    kind: 'connect',
    handler: async (u, b) => {
      try {
        return await manager.add(u, typeof b.label === 'string' ? b.label : null);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
    },
  },
  '/whatsapp/numbers/update': {
    method: 'POST',
    kind: 'connect',
    handler: async (u, b) => {
      const slot = slotOf(b);
      await manager.update(u, slot, {
        label: b.label === undefined ? undefined : typeof b.label === 'string' ? b.label : null,
        dailyLimit: b.dailyLimit === undefined ? undefined : Number(b.dailyLimit),
        active: b.active === undefined ? undefined : b.active === true,
      });
      return { numbers: await manager.list(u) };
    },
  },
  '/whatsapp/numbers/remove': {
    method: 'POST',
    kind: 'disconnect',
    handler: async (u, b) => {
      try {
        await manager.remove(u, slotOf(b));
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return { numbers: await manager.list(u) };
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
      // Envio pela tela: o número indicado; senão o número em que o lead já conversa; senão o principal / outro conectado.
      const leadId = typeof body.leadId === 'string' && UUID.test(body.leadId) ? body.leadId : null;
      const messageId = typeof body.messageId === 'string' && UUID.test(body.messageId) ? body.messageId : null;
      const sticky = leadId ? await leadSlot(u, leadId) : null;
      const slot = optionalSlot(body) ?? (sticky && manager.isConnected(u, sticky) ? sticky : null) ?? manager.pickSlot(u) ?? MAIN_SLOT;
      const r = await manager.sendMessage(u, slot, phone, message, { audio, voice });
      if (r.ok && messageId) await db.from('messages').update({ wa_slot: slot }).eq('id', messageId).eq('owner_id', u).then(() => undefined, () => undefined);
      return r;
    },
  },
};

const server = createServer(async (req, res) => {
  cors(req, res);
  const [path, qs] = (req.url ?? '/').split('?');
  const query = new URLSearchParams(qs ?? '');
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === '/health') return send(res, 200, { ok: true });
    if (path === '/internal/campaign-send') return await campaignSend(req, res);
    if (path === '/internal/notify') return await ownerNotify(req, res);
    if (path === '/internal/wa-check') return await waCheck(req, res);
    if (path === '/whatsapp/voice-preview') {
      // Amostra da voz da IA (MP3), para ouvir antes de escolher. Exige login, como as outras rotas.
      if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
      const userId = await authenticate(req);
      rateLimit(userId, 'preview');
      if (!ttsAvailable()) throw new HttpError(409, 'Voz da IA não configurada: adicione OPENAI_API_KEY no Railway.');
      const b = await readJson(req);
      const audio = await voicePreview(typeof b.voice === 'string' ? b.voice.slice(0, 20) : '', typeof b.name === 'string' ? b.name : '');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.end(audio);
      return;
    }
    const route = routes[path];
    if (!route) throw new HttpError(404, 'Rota não encontrada.');
    if (req.method !== route.method) throw new HttpError(405, 'Método não permitido.');
    const userId = await authenticate(req);
    rateLimit(userId, route.kind);
    const body = route.method === 'POST' ? await readJson(req) : {};
    const result = await route.handler(userId, body, query);
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

