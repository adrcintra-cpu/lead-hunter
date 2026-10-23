import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, generateMessageIDV2, type WASocket, type proto } from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { clearAuthState, MAIN_SLOT, useDatabaseAuthState } from './authState.js';

export { MAIN_SLOT };
/** Identificador de número aceito nas rotas (o principal ou um gerado pelo serviço). */
export const SLOT_RE = /^[a-z0-9_-]{1,24}$/;
import { InboundRelay, phoneKey } from './inbound.js';
import { MAX_TRANSCRIBE_SECONDS, textToSpeech, transcribe, ttsAvailable } from './tts.js';
import { describeImageAny, MAX_IMAGE_BYTES } from './vision.js';
import { config } from './config.js';
import { libLogger, log, maskPhone, maskUser } from './log.js';
import { formatPhone, normalizePhone, toJid } from './phone.js';

export type ConnectionStatus = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'reconectando' | 'erro';

export interface StatusView {
  /** Qual número (o "principal" é o primeiro, que já existia). */
  slot: string;
  status: ConnectionStatus;
  /** QR em imagem (data URL), só enquanto aguarda a leitura. */
  qr: string | null;
  phone: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  error: string | null;
}

/** Um número na lista do usuário (Configurações → WhatsApp). */
export interface NumberView extends StatusView {
  label: string | null;
  dailyLimit: number;
  active: boolean;
  sentToday: number;
}

interface Session {
  userId: string;
  slot: string;
  sock: WASocket | null;
  status: ConnectionStatus;
  qr: string | null;
  phone: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  error: string | null;
  retries: number;
  /** Desconexão pedida pelo usuário: não reconectar. */
  closing: boolean;
  /** Saiu de cena porque outra instância abriu a sessão (deploy sobreposto): pode retomar depois. */
  yielded: boolean;
  /** Retomadas seguidas após "sessão assumida" (evita duas instâncias brigando sem fim). */
  takeovers: number;
  openedAt: number;
  flush: (() => Promise<void>) | null;
  /** Controle de ritmo do envio individual. */
  lastSendAt: number;
  sentDay: string;
  sentToday: number;
  /**
   * Últimas mensagens enviadas (id → conteúdo). Quando o celular do contato não consegue
   * descriptografar ("Aguardando mensagem"), ele pede a mensagem de novo e a biblioteca
   * reenvia a partir daqui. Sem isso, a mensagem fica presa para sempre.
   */
  sent: Map<string, proto.IMessage>;
  /**
   * Números que já são contatos seus (salvos na agenda do WhatsApp ou com conversa anterior).
   * Só a chave do número fica em memória, nunca nome ou conteúdo. Usado para que "atender quem
   * chama sem ser lead" não responda família, amigos e fornecedores.
   */
  known: Set<string>;
}

/** Quantas mensagens enviadas guardar por sessão para reenvio. */
const SENT_KEEP = 500;

function remember(s: Session, id: string | null | undefined, message: proto.IMessage | null | undefined) {
  if (!id || !message) return;
  s.sent.delete(id);
  s.sent.set(id, message);
  if (s.sent.size > SENT_KEEP) s.sent.delete(s.sent.keys().next().value as string);
}

const MAX_RETRIES = 6;
/** Espera antes de retomar uma sessão assumida por outra instância (padrão: 1 min, 2 min, 5 min). */
const TAKEOVER_WAITS = [1, 2, 5].map((x) => x * config.takeoverWaitSeconds * 1000);

/**
 * Uma sessão de WhatsApp por usuário, isolada. Toda a lógica da biblioteca fica aqui:
 * o resto do serviço só chama estes métodos.
 */
const skey = (userId: string, slot: string) => (slot === MAIN_SLOT ? userId : `${userId}#${slot}`);

export class SessionManager {
  /** Uma sessão por número: chave = usuário (principal) ou usuário#número. */
  private sessions = new Map<string, Session>();
  /** O processo está sendo desligado (SIGTERM do deploy): não retoma sessões. */
  private stopping = false;

  private inbound: InboundRelay;

  constructor(private db: SupabaseClient) {
    this.inbound = new InboundRelay(
      db,
      (userId, slot, phone, text, o) => this.sendMessage(userId, slot, phone, text, { ...o, typing: true, own: true }),
      (userId, slot, raw) => this.transcribeIncoming(userId, slot, raw),
      // Contato seu em qualquer um dos seus números.
      (userId, phone) => this.sessionsOf(userId).some((x) => x.known.has(phoneKey(phone))),
    );
  }

  private sessionsOf(userId: string): Session[] {
    return [...this.sessions.values()].filter((x) => x.userId === userId);
  }

  private find(userId: string, slot: string): Session | undefined {
    return this.sessions.get(skey(userId, slot));
  }

  private get(userId: string, slot: string): Session {
    let s = this.sessions.get(skey(userId, slot));
    if (!s) {
      s = {
        userId,
        slot,
        sock: null,
        status: 'desconectado',
        qr: null,
        phone: null,
        connectedAt: null,
        lastSeenAt: null,
        error: null,
        retries: 0,
        closing: false,
        yielded: false,
        takeovers: 0,
        openedAt: 0,
        flush: null,
        lastSendAt: 0,
        sentDay: '',
        sentToday: 0,
        sent: new Map(),
        known: new Set(),
      };
      this.sessions.set(skey(userId, slot), s);
    }
    return s;
  }

  view(userId: string, slot: string = MAIN_SLOT): StatusView {
    const s = this.find(userId, slot);
    if (!s) return { slot, status: 'desconectado', qr: null, phone: null, connectedAt: null, lastSeenAt: null, error: null };
    return { slot, status: s.status, qr: s.status === 'aguardando_qr' ? s.qr : null, phone: s.phone, connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, error: s.error };
  }

  /**
   * Status de um número. Sem número indicado: o principal, ou o primeiro conectado se o principal
   * não estiver (as telas que só querem saber "dá para enviar pelo WhatsApp?").
   */
  async status(userId: string, slot?: string): Promise<StatusView> {
    if (!slot) {
      const live = this.sessionsOf(userId).filter((x) => x.sock && x.status === 'conectado');
      const main = live.find((x) => x.slot === MAIN_SLOT) ?? live[0];
      if (main) return this.view(userId, main.slot);
      slot = MAIN_SLOT;
    }
    if (this.find(userId, slot)) return this.view(userId, slot);
    const { data } = await this.db.from('whatsapp_connections').select('*').eq('user_id', userId).eq('slot', slot).maybeSingle();
    if (!data) return this.view(userId, slot);
    return {
      slot,
      status: data.status === 'conectado' ? 'reconectando' : 'desconectado',
      qr: null,
      phone: data.phone_number,
      connectedAt: data.connected_at,
      lastSeenAt: data.last_seen_at,
      error: null,
    };
  }

  private async persist(s: Session) {
    const { error } = await this.db.from('whatsapp_connections').upsert(
      {
        user_id: s.userId,
        slot: s.slot,
        phone_number: s.phone,
        status: s.status,
        last_error: s.error,
        connected_at: s.connectedAt,
        last_seen_at: s.lastSeenAt,
      },
      { onConflict: 'user_id,slot' },
    );
    if (error) log.error({ user: maskUser(s.userId), err: error.message }, 'falha ao salvar o status da conexão');
  }

  private set(s: Session, patch: Partial<Session>) {
    Object.assign(s, patch);
    void this.persist(s);
  }

  /** Inicia (ou retoma) a sessão. Sem sessão salva, gera QR code. */
  async connect(userId: string, slot: string = MAIN_SLOT, opts: { restoring?: boolean } = {}): Promise<StatusView> {
    const s = this.get(userId, slot);
    if (s.sock && (s.status === 'conectado' || s.status === 'aguardando_qr' || s.status === 'conectando')) return this.view(userId, slot);
    s.closing = false;
    s.yielded = false;
    this.set(s, { status: opts.restoring ? 'reconectando' : 'conectando', error: null, qr: null });

    try {
      const auth = await useDatabaseAuthState(this.db, userId, slot);
      s.flush = auth.flushNow;
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as unknown as [number, number, number] }));
      const sock = makeWASocket({
        auth: auth.state,
        version,
        logger: libLogger,
        printQRInTerminal: false,
        browser: Browsers.macOS('Lead Hunter'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // Reenvio quando o contato pede a mensagem de novo (falha de descriptografia do lado dele).
        getMessage: async (key) => {
          const m = key.id ? s.sent.get(key.id) : undefined;
          if (key.id) log.info({ user: maskUser(userId), found: !!m }, 'contato pediu reenvio de mensagem');
          return m;
        },
      });
      s.sock = sock;
      log.info({ user: maskUser(userId), restoring: !!opts.restoring }, 'sessão iniciada');

      sock.ev.on('creds.update', auth.saveCreds);

      // Contatos salvos e conversas que já existiam: guardados só como chave do número (ver `known`).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const learn = (c: any, saved: boolean) => {
        if (!c || (saved && !c.name)) return;
        for (const jid of [c.phoneNumber, c.id]) {
          if (typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')) {
            const d = jid.split(/[:@]/)[0].replace(/\D/g, '');
            if (d) s.known.add(phoneKey(d));
          }
        }
        if (s.known.size > 20000) s.known.delete(s.known.values().next().value as string);
      };
      sock.ev.on('contacts.upsert', (list) => list.forEach((c) => learn(c, true)));
      sock.ev.on('contacts.update', (list) => list.forEach((c) => learn(c, true)));
      sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
        (contacts ?? []).forEach((c) => learn(c, true));
        // Conversa que já existia antes de conectar: não é um contato novo.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chats ?? []).forEach((c: any) => learn({ id: c.id, phoneNumber: c.pnJid ?? c.phoneNumber }, false));
      });

      // Respostas recebidas: só as de leads seguem (ver inbound.ts). 'notify' = mensagem nova, não histórico.
      // Conta comercial / privacidade nova: o WhatsApp manda o remetente como LID (@lid) e às vezes sem o número junto.
      // Sem o número a mensagem não chega no lead: busca o número no mapeamento LID → telefone que a sessão guarda.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withPhone = async (m: any) => {
        const k = m?.key;
        const jid: string = k?.remoteJid ?? '';
        if (!jid.endsWith('@lid') || k.senderPn || k.remoteJidAlt) return m;
        try {
          const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
          if (pn) k.remoteJidAlt = pn;
          else log.warn({ user: maskUser(userId) }, 'número do remetente (LID) não encontrado');
        } catch (err) {
          log.warn({ user: maskUser(userId), err: err instanceof Error ? err.message : String(err) }, 'falha ao buscar o número do remetente (LID)');
        }
        return m;
      };
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (s.sock !== sock) return;
        for (const raw of messages) void withPhone(raw).then((m) => {
          if (s.sock !== sock) return;
          // Você escreveu no celular para esse contato: a resposta automática pendente é cancelada.
          if (m.key?.fromMe) {
            remember(s, m.key.id, m.message);
            // Você escreveu para esse número (não foi o Beelie): é um contato seu.
            if (!this.inbound.isOwn(m.key.id ?? '')) learn({ id: m.key.remoteJid, phoneNumber: m.key.remoteJidAlt }, false);
            this.inbound.cancelFor(userId, m);
          }
          else {
            // Diagnóstico sem conteúdo nem número: tipo do evento e do remetente.
            const jid: string = m.key?.remoteJid ?? '';
            const kind = jid.endsWith('@g.us') ? 'grupo' : jid.endsWith('@lid') ? 'lid' : jid.endsWith('@s.whatsapp.net') ? 'telefone' : 'outro';
            if (kind !== 'grupo' && kind !== 'outro') log.info({ user: maskUser(userId), type, kind, alt: !!(m.key?.remoteJidAlt || m.key?.senderPn) }, 'mensagem recebida');
            if (type === 'notify') void this.inbound.handle(userId, m, slot);
          }
        });
      });

      sock.ev.on('connection.update', async (u) => {
        if (s.sock !== sock) return; // evento de um socket antigo
        if (u.qr) {
          s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
          if (s.status !== 'aguardando_qr') log.info({ user: maskUser(userId) }, 'QR gerado');
          this.set(s, { status: 'aguardando_qr', error: null });
        }
        if (u.connection === 'connecting' && s.status !== 'aguardando_qr') {
          this.set(s, { status: s.retries > 0 ? 'reconectando' : 'conectando' });
        }
        if (u.connection === 'open') {
          const now = new Date().toISOString();
          const phone = formatPhone(sock.user?.id);
          s.openedAt = Date.now();
          this.set(s, { status: 'conectado', qr: null, phone, connectedAt: s.connectedAt && opts.restoring ? s.connectedAt : now, lastSeenAt: now, error: null, retries: 0 });
          log.info({ user: maskUser(userId), phone: maskPhone(phone?.replace(/\D/g, '')), restoring: !!opts.restoring }, opts.restoring ? 'sessão restaurada' : 'sessão conectada');
        }
        if (u.connection === 'close') {
          const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          s.sock = null;
          if (s.closing) return;
          if (code === DisconnectReason.loggedOut) {
            // Desconectado pelo celular (Aparelhos conectados → sair): sessão inválida.
            log.warn({ user: maskUser(userId) }, 'sessão desconectada pelo celular');
            await clearAuthState(this.db, userId, slot).catch(() => undefined);
            this.set(s, { status: 'desconectado', qr: null, phone: null, error: 'O WhatsApp foi desconectado pelo celular. Conecte de novo.' });
            return;
          }
          if (code === DisconnectReason.connectionReplaced) {
            // Outra instância do serviço abriu a mesma sessão (deploy sobreposto). Esta sai de cena
            // sem reconectar e sem gravar status: duas instâncias brigando corrompem as chaves de
            // criptografia e o celular do contato passa a mostrar "Aguardando mensagem".
            log.warn({ user: maskUser(userId) }, 'sessão assumida por outra instância do serviço: esta para');
            s.closing = true;
            s.yielded = true;
            await s.flush?.().catch(() => undefined);
            // Num deploy, a instância antiga é desligada logo depois. Se a que saiu de cena foi a nova,
            // ninguém ficaria com a sessão: espera a antiga sair e retoma (no máximo 3 vezes seguidas).
            if (this.stopping) return;
            if (Date.now() - s.openedAt > 10 * 60_000) s.takeovers = 0;
            s.takeovers += 1;
            if (s.takeovers > TAKEOVER_WAITS.length) {
              log.error({ user: maskUser(userId) }, 'sessão disputada por outra instância: confira se há dois serviços de WhatsApp rodando com o mesmo banco');
              return;
            }
            const wait = TAKEOVER_WAITS[s.takeovers - 1];
            log.warn({ user: maskUser(userId), inSec: wait / 1000, attempt: s.takeovers }, 'vai retomar a sessão se a outra instância sair');
            setTimeout(() => {
              if (this.stopping || !s.yielded || s.sock) return;
              log.info({ user: maskUser(userId) }, 'retomando a sessão');
              void this.connect(userId, slot, { restoring: true });
            }, wait);
            return;
          }
          if (code === DisconnectReason.restartRequired) {
            // Normal logo após a leitura do QR: a biblioteca pede para abrir um socket novo.
            this.set(s, { status: 'conectando', qr: null });
            setTimeout(() => void this.connect(userId, slot, { restoring: opts.restoring }), 500);
            return;
          }
          if (s.status === 'aguardando_qr' && code === DisconnectReason.timedOut) {
            // QR expirou várias vezes sem leitura: para de gerar até o usuário pedir de novo.
            this.set(s, { status: 'desconectado', qr: null, error: 'O QR code expirou. Clique em Conectar WhatsApp para gerar outro.' });
            return;
          }
          if (s.retries >= MAX_RETRIES) {
            log.error({ user: maskUser(userId), code }, 'reconexão falhou');
            this.set(s, { status: 'erro', qr: null, error: `Não foi possível reconectar (código ${code ?? 'desconhecido'}). Tente conectar de novo.` });
            return;
          }
          s.retries += 1;
          const wait = Math.min(30_000, 1500 * 2 ** (s.retries - 1));
          log.warn({ user: maskUser(userId), code, retry: s.retries, waitMs: wait }, 'reconexão');
          this.set(s, { status: 'reconectando' });
          setTimeout(() => void this.connect(userId, slot, { restoring: true }), wait);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ user: maskUser(userId), err: msg }, 'erro de autenticação');
      this.set(s, { status: 'erro', error: msg });
    }
    return this.view(userId, slot);
  }

  /** O número está conectado e pronto para enviar. Sem número: algum dos números do usuário. */
  isConnected(userId: string, slot?: string) {
    if (!slot) return this.sessionsOf(userId).some((x) => !!x.sock && x.status === 'conectado');
    const s = this.find(userId, slot);
    return !!s?.sock && s.status === 'conectado';
  }

  /** Número para envios sem número definido (avisos ao dono, consultas): o principal, se conectado; senão outro conectado. */
  pickSlot(userId: string): string | null {
    const live = this.sessionsOf(userId).filter((x) => !!x.sock && x.status === 'conectado');
    return (live.find((x) => x.slot === MAIN_SLOT) ?? live[0])?.slot ?? null;
  }

  /** Verifica se a sessão está de fato ativa (consulta o próprio número no WhatsApp). */
  async test(userId: string, slot: string = MAIN_SLOT): Promise<{ ok: boolean; message: string }> {
    const s = this.find(userId, slot);
    if (!s?.sock || s.status !== 'conectado') return { ok: false, message: 'WhatsApp não conectado.' };
    try {
      const me = s.sock.user?.id?.split(/[:@]/)[0];
      if (!me) throw new Error('sessão sem número');
      await s.sock.onWhatsApp(me);
      this.set(s, { lastSeenAt: new Date().toISOString() });
      return { ok: true, message: 'WhatsApp conectado e pronto para envio.' };
    } catch (err) {
      return { ok: false, message: `A sessão não respondeu: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Encerra a sessão no WhatsApp, apaga a autenticação salva e libera um novo QR. */
  async disconnect(userId: string, slot: string = MAIN_SLOT) {
    const s = this.get(userId, slot);
    s.closing = true;
    s.yielded = false;
    try {
      await s.sock?.logout();
    } catch {
      /* já estava fechada */
    }
    try {
      s.sock?.end(undefined);
    } catch {
      /* ignore */
    }
    s.sock = null;
    await clearAuthState(this.db, userId, slot);
    this.set(s, { status: 'desconectado', qr: null, phone: null, connectedAt: null, error: null, retries: 0 });
    log.info({ user: maskUser(userId), slot }, 'sessão desconectada pelo usuário');
  }

  /** Lista dos números do usuário (banco + estado ao vivo). O principal aparece mesmo sem registro. */
  async list(userId: string): Promise<NumberView[]> {
    const { data, error } = await this.db.from('whatsapp_connections').select('*').eq('user_id', userId).order('created_at');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.some((r) => (r.slot ?? MAIN_SLOT) === MAIN_SLOT)) rows.unshift({ slot: MAIN_SLOT, daily_limit: 20, active: true });
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const out: NumberView[] = [];
    for (const r of rows) {
      const slot = String(r.slot ?? MAIN_SLOT);
      const live = this.find(userId, slot);
      const base = await this.status(userId, slot);
      out.push({
        ...base,
        phone: base.phone ?? (r.phone_number as string | null) ?? null,
        label: (r.label as string | null) ?? null,
        dailyLimit: Number(r.daily_limit ?? 20),
        active: r.active !== false,
        sentToday: live && live.sentDay === today ? live.sentToday : 0,
      });
    }
    return out;
  }

  /** Novo número: cria o registro e já gera o QR para ler no celular. */
  async add(userId: string, label: string | null): Promise<StatusView> {
    const { data } = await this.db.from('whatsapp_connections').select('slot').eq('user_id', userId);
    if ((data ?? []).length >= 10) throw new Error('Limite de 10 números por conta.');
    const slot = `n${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await this.db.from('whatsapp_connections').insert({ user_id: userId, slot, label: label?.slice(0, 40) || null, status: 'desconectado' });
    if (error) throw new Error(error.message);
    log.info({ user: maskUser(userId), slot }, 'número novo');
    return this.connect(userId, slot);
  }

  /** Nome, limite diário e ligado/desligado de um número. */
  async update(userId: string, slot: string, patch: { label?: string | null; dailyLimit?: number; active?: boolean }) {
    const row: Record<string, unknown> = {};
    if (patch.label !== undefined) row.label = patch.label ? String(patch.label).slice(0, 40) : null;
    if (patch.dailyLimit !== undefined) row.daily_limit = Math.max(1, Math.min(200, Math.round(Number(patch.dailyLimit) || 20)));
    if (patch.active !== undefined) row.active = !!patch.active;
    if (!Object.keys(row).length) return;
    // O principal pode ainda não ter registro (nunca conectou): cria.
    const { error } = await this.db.from('whatsapp_connections').upsert({ user_id: userId, slot, ...row }, { onConflict: 'user_id,slot' });
    if (error) throw new Error(error.message);
  }

  /** Remove um número extra: desconecta, apaga a sessão e o registro. O principal não pode ser removido. */
  async remove(userId: string, slot: string) {
    if (slot === MAIN_SLOT) throw new Error('O número principal não pode ser removido (só desconectado).');
    await this.disconnect(userId, slot);
    this.sessions.delete(skey(userId, slot));
    const { error } = await this.db.from('whatsapp_connections').delete().eq('user_id', userId).eq('slot', slot);
    if (error) throw new Error(error.message);
  }

  /**
   * Envio individual. Valida e normaliza o telefone, confere a conexão e se o número tem WhatsApp,
   * respeita o intervalo mínimo e o limite diário, e devolve o id da mensagem.
   * Não há envio em massa: cada chamada envia uma mensagem.
   */
  async sendMessage(
    userId: string,
    slot: string,
    rawPhone: string,
    message: string,
    opts: { audio?: boolean; voice?: string; typing?: boolean; /** Enviada pelo BEELIE (resposta automática ou campanha): o eco não cancela a resposta automática. */ own?: boolean } = {},
  ): Promise<{ ok: true; id: string; to: string } | { ok: false; error: string }> {
    const s = this.find(userId, slot);
    if (!s?.sock || s.status !== 'conectado') return { ok: false, error: 'WhatsApp não conectado. Conecte em Configurações → WhatsApp.' };
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return { ok: false, error: 'A mensagem está vazia.' };
    if (text.length > 4000) return { ok: false, error: 'Mensagem longa demais (máx. 4.000 caracteres).' };
    const phone = normalizePhone(rawPhone);
    if (!phone) return { ok: false, error: 'Telefone inválido.' };

    // Dia de Brasília (o limite diário vira à meia-noite daqui, não às 21h).
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    if (s.sentDay !== today) {
      s.sentDay = today;
      s.sentToday = 0;
    }
    if (s.sentToday >= config.sendDailyLimit) return { ok: false, error: `Limite de ${config.sendDailyLimit} envios por dia atingido.` };
    const waitMs = s.lastSendAt + config.sendMinIntervalSeconds * 1000 - Date.now();
    if (waitMs > 0) return { ok: false, error: `Aguarde ${Math.ceil(waitMs / 1000)} s antes do próximo envio.` };

    try {
      const found = await s.sock.onWhatsApp(phone);
      const check = found?.[0];
      if (!check?.exists) return { ok: false, error: 'Este número não tem WhatsApp.' };
      const jid = check.jid ?? toJid(phone);
      // Áudio: gerado antes de "digitar/gravar" (espera natural) e antes de marcar o envio,
      // para que, se a voz falhar, a mesma resposta possa sair em texto na hora.
      const audio = opts.audio ? await textToSpeech(text, opts.voice) : null;
      s.lastSendAt = Date.now();
      if (opts.typing) {
        await s.sock.sendPresenceUpdate(audio ? 'recording' : 'composing', jid).catch(() => undefined);
        await new Promise((r) => setTimeout(r, Math.min(5000, 1000 + text.length * 25)));
        await s.sock.sendPresenceUpdate('paused', jid).catch(() => undefined);
      }
      // O id é gerado antes do envio: o eco da própria mensagem chega antes de sendMessage terminar.
      const messageId = opts.own ? generateMessageIDV2(s.sock.user?.id) : undefined;
      if (messageId) this.inbound.markOwn(messageId);
      const sent = audio
        ? await s.sock.sendMessage(jid, { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { messageId })
        : await s.sock.sendMessage(jid, { text }, { messageId });
      remember(s, sent?.key?.id, sent?.message);
      s.sentToday += 1;
      this.set(s, { lastSeenAt: new Date().toISOString() });
      log.info({ user: maskUser(userId), slot, to: maskPhone(phone), today: s.sentToday, audio: !!audio }, 'mensagem enviada');
      return { ok: true, id: sent?.key?.id ?? '', to: phone };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ user: maskUser(userId), to: maskPhone(phone), err: msg }, 'erro de envio');
      return { ok: false, error: `Falha no envio: ${msg}` };
    }
  }

  /** Baixa o áudio recebido pela sessão do usuário e transcreve. Só é chamado para mensagens de leads e as suas (dono). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async transcribeIncoming(userId: string, slot: string, raw: any): Promise<string | null> {
    const s = this.find(userId, slot);
    const msg = raw?.message;
    const inner = msg?.ephemeralMessage?.message ?? msg?.viewOnceMessage?.message ?? msg;
    const audio = inner?.audioMessage;
    const image = inner?.imageMessage;
    if (!audio && !image) return null;
    // Áudio precisa da OpenAI; imagem também pode ser lida pelo Claude.
    if (audio && !ttsAvailable()) throw new Error('falta OPENAI_API_KEY nas variáveis do Railway');
    if (!s?.sock) throw new Error('sessão do WhatsApp fechada');
    if (audio && Number(audio.seconds) > MAX_TRANSCRIBE_SECONDS) throw new Error(`áudio com mais de ${MAX_TRANSCRIBE_SECONDS / 60} min`);
    if (image && Number(image.fileLength ?? 0) > MAX_IMAGE_BYTES) throw new Error('imagem grande demais');
    const sock = s.sock;
    const buf = (await downloadMediaMessage(raw, 'buffer', {}, { logger: libLogger, reuploadRequest: sock.updateMediaMessage })) as Buffer;
    return audio ? transcribe(buf, audio.mimetype ?? 'audio/ogg') : describeImageAny(buf, image.mimetype ?? 'image/jpeg', image.caption ?? undefined, userId);
  }

  /** Aviso ou relatório para o WhatsApp pessoal do dono (precisa da sessão conectada). */
  notifyOwner(userId: string, text: string): Promise<boolean> {
    const slot = this.pickSlot(userId);
    if (!slot) return Promise.resolve(false);
    return this.inbound.notifyOwner(userId, text, slot);
  }

  /** Resultado da consulta por número (DDD + 8 últimos dígitos), por 30 dias: não consulta de novo. */
  private waCache = new Map<string, { exists: boolean; at: number }>();
  /** Consultas por usuário na última hora (limite para não chamar atenção do WhatsApp). */
  private waChecks = new Map<string, number[]>();

  /**
   * Quais telefones têm WhatsApp (inclusive fixo com WhatsApp Business). Só consulta, não manda mensagem.
   * Em lotes de 20, com pausa entre eles; no máximo 300 números novos por hora por usuário.
   */
  async checkWhatsapp(userId: string, phones: string[]): Promise<{ ok: true; found: string[]; unchecked: string[] } | { ok: false; error: string }> {
    const picked = this.pickSlot(userId);
    const s = picked ? this.find(userId, picked) : undefined;
    if (!s?.sock || s.status !== 'conectado') return { ok: false, error: 'WhatsApp desconectado' };
    const norm = (raw: string) => {
      let d = raw.replace(/\D/g, '');
      if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
      if (d.startsWith('0')) d = d.slice(1);
      return d.length === 10 || d.length === 11 ? d : null;
    };
    const kOf = (d: string) => `${d.slice(0, 2)}${d.slice(-8)}`;
    const found: string[] = [];
    const unchecked: string[] = [];
    const todo: { raw: string; d: string }[] = [];
    const now = Date.now();
    for (const raw of phones) {
      const d = norm(raw);
      if (!d) continue;
      const c = this.waCache.get(kOf(d));
      if (c && now - c.at < 30 * 864e5) {
        if (c.exists) found.push(raw);
      } else todo.push({ raw, d });
    }
    const recent = (this.waChecks.get(userId) ?? []).filter((t) => now - t < 3600_000);
    const room = Math.max(0, 300 - recent.length);
    const batch = todo.slice(0, room);
    unchecked.push(...todo.slice(room).map((x) => x.raw));
    for (let i = 0; i < batch.length; i += 20) {
      const part = batch.slice(i, i + 20);
      try {
        if (!s.sock) throw new Error('sessão fechada');
        const res = (await s.sock.onWhatsApp(...part.map((x) => `55${x.d}`))) ?? [];
        const ok = new Set(res.filter((r) => r.exists).map((r) => kOf(String(r.jid).split('@')[0].replace(/^55/, ''))));
        for (const x of part) {
          const exists = ok.has(kOf(x.d));
          this.waCache.set(kOf(x.d), { exists, at: Date.now() });
          if (exists) found.push(x.raw);
          recent.push(Date.now());
        }
      } catch (err) {
        log.warn({ user: maskUser(userId), err: err instanceof Error ? err.message : String(err) }, 'consulta de WhatsApp falhou');
        unchecked.push(...part.map((x) => x.raw));
      }
      if (i + 20 < batch.length) await new Promise((r) => setTimeout(r, 1500));
    }
    this.waChecks.set(userId, recent);
    if (this.waCache.size > 50_000) this.waCache.clear();
    return { ok: true, found, unchecked };
  }

  /** Ao subir o serviço: reconecta quem estava conectado (sessão salva no banco). */
  async restoreAll() {
    const { data, error } = await this.db.from('whatsapp_connections').select('user_id, slot').in('status', ['conectado', 'reconectando', 'conectando']);
    if (error) {
      log.error({ err: error.message }, 'falha ao listar sessões para restaurar');
      return;
    }
    for (const row of data ?? []) {
      const slot = (row as { slot?: string }).slot ?? MAIN_SLOT;
      log.info({ user: maskUser(row.user_id), slot }, 'restaurando sessão');
      await this.connect(row.user_id, slot, { restoring: true });
    }
  }

  /** Desligamento limpo: grava o que estiver pendente. Não faz logout (a sessão continua válida). */
  async shutdown() {
    this.stopping = true;
    for (const s of this.sessions.values()) {
      s.closing = true;
      await s.flush?.().catch(() => undefined);
      try {
        s.sock?.end(undefined);
      } catch {
        /* ignore */
      }
    }
  }
}
