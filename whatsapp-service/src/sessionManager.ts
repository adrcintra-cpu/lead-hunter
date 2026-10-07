import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, generateMessageIDV2, type WASocket, type proto } from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { clearAuthState, useDatabaseAuthState } from './authState.js';
import { InboundRelay, phoneKey } from './inbound.js';
import { MAX_TRANSCRIBE_SECONDS, textToSpeech, transcribe, ttsAvailable } from './tts.js';
import { describeImage, MAX_IMAGE_BYTES } from './vision.js';
import { config } from './config.js';
import { libLogger, log, maskPhone, maskUser } from './log.js';
import { formatPhone, normalizePhone, toJid } from './phone.js';

export type ConnectionStatus = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'reconectando' | 'erro';

export interface StatusView {
  status: ConnectionStatus;
  /** QR em imagem (data URL), só enquanto aguarda a leitura. */
  qr: string | null;
  phone: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  error: string | null;
}

interface Session {
  userId: string;
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

/**
 * Uma sessão de WhatsApp por usuário, isolada. Toda a lógica da biblioteca fica aqui:
 * o resto do serviço só chama estes métodos.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();

  private inbound: InboundRelay;

  constructor(private db: SupabaseClient) {
    this.inbound = new InboundRelay(
      db,
      (userId, phone, text, o) => this.sendMessage(userId, phone, text, { ...o, typing: true, own: true }),
      (userId, raw) => this.transcribeIncoming(userId, raw),
      (userId, phone) => this.sessions.get(userId)?.known.has(phoneKey(phone)) ?? false,
    );
  }

  private get(userId: string): Session {
    let s = this.sessions.get(userId);
    if (!s) {
      s = {
        userId,
        sock: null,
        status: 'desconectado',
        qr: null,
        phone: null,
        connectedAt: null,
        lastSeenAt: null,
        error: null,
        retries: 0,
        closing: false,
        flush: null,
        lastSendAt: 0,
        sentDay: '',
        sentToday: 0,
        sent: new Map(),
        known: new Set(),
      };
      this.sessions.set(userId, s);
    }
    return s;
  }

  view(userId: string): StatusView {
    const s = this.sessions.get(userId);
    if (!s) return { status: 'desconectado', qr: null, phone: null, connectedAt: null, lastSeenAt: null, error: null };
    return { status: s.status, qr: s.status === 'aguardando_qr' ? s.qr : null, phone: s.phone, connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, error: s.error };
  }

  /** Status atual, completando com o que está salvo no banco (ex.: depois de reiniciar o serviço). */
  async status(userId: string): Promise<StatusView> {
    if (this.sessions.has(userId)) return this.view(userId);
    const { data } = await this.db.from('whatsapp_connections').select('*').eq('user_id', userId).maybeSingle();
    if (!data) return this.view(userId);
    return {
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
        phone_number: s.phone,
        status: s.status,
        last_error: s.error,
        connected_at: s.connectedAt,
        last_seen_at: s.lastSeenAt,
      },
      { onConflict: 'user_id' },
    );
    if (error) log.error({ user: maskUser(s.userId), err: error.message }, 'falha ao salvar o status da conexão');
  }

  private set(s: Session, patch: Partial<Session>) {
    Object.assign(s, patch);
    void this.persist(s);
  }

  /** Inicia (ou retoma) a sessão. Sem sessão salva, gera QR code. */
  async connect(userId: string, opts: { restoring?: boolean } = {}): Promise<StatusView> {
    const s = this.get(userId);
    if (s.sock && (s.status === 'conectado' || s.status === 'aguardando_qr' || s.status === 'conectando')) return this.view(userId);
    s.closing = false;
    this.set(s, { status: opts.restoring ? 'reconectando' : 'conectando', error: null, qr: null });

    try {
      const auth = await useDatabaseAuthState(this.db, userId);
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
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (s.sock !== sock) return;
        for (const m of messages) {
          // Você escreveu no celular para esse contato: a resposta automática pendente é cancelada.
          if (m.key?.fromMe) {
            remember(s, m.key.id, m.message);
            // Você escreveu para esse número (não foi o Beelie): é um contato seu.
            if (!this.inbound.isOwn(m.key.id ?? '')) learn({ id: m.key.remoteJid, phoneNumber: m.key.remoteJidAlt }, false);
            this.inbound.cancelFor(userId, m);
          }
          else if (type === 'notify') void this.inbound.handle(userId, m);
        }
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
            await clearAuthState(this.db, userId).catch(() => undefined);
            this.set(s, { status: 'desconectado', qr: null, phone: null, error: 'O WhatsApp foi desconectado pelo celular. Conecte de novo.' });
            return;
          }
          if (code === DisconnectReason.connectionReplaced) {
            // Outra instância do serviço abriu a mesma sessão (deploy sobreposto). Esta sai de cena
            // sem reconectar e sem gravar status: duas instâncias brigando corrompem as chaves de
            // criptografia e o celular do contato passa a mostrar "Aguardando mensagem".
            log.warn({ user: maskUser(userId) }, 'sessão assumida por outra instância do serviço: esta para');
            s.closing = true;
            await s.flush?.().catch(() => undefined);
            return;
          }
          if (code === DisconnectReason.restartRequired) {
            // Normal logo após a leitura do QR: a biblioteca pede para abrir um socket novo.
            this.set(s, { status: 'conectando', qr: null });
            setTimeout(() => void this.connect(userId, { restoring: opts.restoring }), 500);
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
          setTimeout(() => void this.connect(userId, { restoring: true }), wait);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ user: maskUser(userId), err: msg }, 'erro de autenticação');
      this.set(s, { status: 'erro', error: msg });
    }
    return this.view(userId);
  }

  /** A sessão do usuário está conectada e pronta para enviar. */
  isConnected(userId: string) {
    const s = this.sessions.get(userId);
    return !!s?.sock && s.status === 'conectado';
  }

  /** Verifica se a sessão está de fato ativa (consulta o próprio número no WhatsApp). */
  async test(userId: string): Promise<{ ok: boolean; message: string }> {
    const s = this.sessions.get(userId);
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
  async disconnect(userId: string) {
    const s = this.get(userId);
    s.closing = true;
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
    await clearAuthState(this.db, userId);
    this.set(s, { status: 'desconectado', qr: null, phone: null, connectedAt: null, error: null, retries: 0 });
    log.info({ user: maskUser(userId) }, 'sessão desconectada pelo usuário');
  }

  /**
   * Envio individual. Valida e normaliza o telefone, confere a conexão e se o número tem WhatsApp,
   * respeita o intervalo mínimo e o limite diário, e devolve o id da mensagem.
   * Não há envio em massa: cada chamada envia uma mensagem.
   */
  async sendMessage(
    userId: string,
    rawPhone: string,
    message: string,
    opts: { audio?: boolean; voice?: string; typing?: boolean; /** Enviada pelo BEELIE (resposta automática ou campanha): o eco não cancela a resposta automática. */ own?: boolean } = {},
  ): Promise<{ ok: true; id: string; to: string } | { ok: false; error: string }> {
    const s = this.sessions.get(userId);
    if (!s?.sock || s.status !== 'conectado') return { ok: false, error: 'WhatsApp não conectado. Conecte em Configurações → WhatsApp.' };
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return { ok: false, error: 'A mensagem está vazia.' };
    if (text.length > 4000) return { ok: false, error: 'Mensagem longa demais (máx. 4.000 caracteres).' };
    const phone = normalizePhone(rawPhone);
    if (!phone) return { ok: false, error: 'Telefone inválido.' };

    const today = new Date().toISOString().slice(0, 10);
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
      log.info({ user: maskUser(userId), to: maskPhone(phone), today: s.sentToday, audio: !!audio }, 'mensagem enviada');
      return { ok: true, id: sent?.key?.id ?? '', to: phone };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ user: maskUser(userId), to: maskPhone(phone), err: msg }, 'erro de envio');
      return { ok: false, error: `Falha no envio: ${msg}` };
    }
  }

  /** Baixa o áudio recebido pela sessão do usuário e transcreve. Só é chamado para mensagens de leads. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async transcribeIncoming(userId: string, raw: any): Promise<string | null> {
    const s = this.sessions.get(userId);
    const msg = raw?.message;
    const inner = msg?.ephemeralMessage?.message ?? msg?.viewOnceMessage?.message ?? msg;
    const audio = inner?.audioMessage;
    const image = inner?.imageMessage;
    if (!audio && !image) return null;
    if (!ttsAvailable()) throw new Error('falta OPENAI_API_KEY nas variáveis do Railway');
    if (!s?.sock) throw new Error('sessão do WhatsApp fechada');
    if (audio && Number(audio.seconds) > MAX_TRANSCRIBE_SECONDS) throw new Error(`áudio com mais de ${MAX_TRANSCRIBE_SECONDS / 60} min`);
    if (image && Number(image.fileLength ?? 0) > MAX_IMAGE_BYTES) throw new Error('imagem grande demais');
    const sock = s.sock;
    const buf = (await downloadMediaMessage(raw, 'buffer', {}, { logger: libLogger, reuploadRequest: sock.updateMediaMessage })) as Buffer;
    return audio ? transcribe(buf, audio.mimetype ?? 'audio/ogg') : describeImage(buf, image.mimetype ?? 'image/jpeg', image.caption ?? undefined);
  }

  /** Ao subir o serviço: reconecta quem estava conectado (sessão salva no banco). */
  async restoreAll() {
    const { data, error } = await this.db.from('whatsapp_connections').select('user_id').in('status', ['conectado', 'reconectando', 'conectando']);
    if (error) {
      log.error({ err: error.message }, 'falha ao listar sessões para restaurar');
      return;
    }
    for (const row of data ?? []) {
      log.info({ user: maskUser(row.user_id) }, 'restaurando sessão');
      await this.connect(row.user_id, { restoring: true });
    }
  }

  /** Desligamento limpo: grava o que estiver pendente. Não faz logout (a sessão continua válida). */
  async shutdown() {
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
