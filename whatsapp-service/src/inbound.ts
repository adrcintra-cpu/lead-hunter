import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { log, maskPhone, maskUser } from './log.js';

/**
 * Respostas recebidas no WhatsApp conectado.
 *
 * Só mensagens de números que são leads do próprio usuário seguem adiante; conversas
 * pessoais são ignoradas aqui mesmo (não são gravadas, registradas nem enviadas a lugar nenhum).
 * As que são de leads vão para a Edge Function whatsapp-qr-inbound, que usa o mesmo
 * processamento das outras respostas: grava, a IA classifica, a cadência para.
 */

/** Mensagem recebida, já extraída do formato da biblioteca. */
export interface IncomingMessage {
  id: string;
  /** Telefone de quem enviou, só dígitos (ex.: 5519999991234). */
  phone: string;
  text: string;
  at: string;
}

/**
 * Chave de comparação de telefones. No Brasil o WhatsApp às vezes usa o celular sem o 9 extra
 * (55 19 9999-1234 em vez de 55 19 99999-1234), então compara DDI + DDD + últimos 8 dígitos.
 */
export function phoneKey(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `55${d.slice(2, 4)}${d.slice(-8)}`;
  return d;
}

/** Converte telefone salvo no cadastro (qualquer formato) para dígitos internacionais. */
function toDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/** Texto legível de uma mensagem da biblioteca; null para o que não é conversa (reação, sistema). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function textOf(message: any): string | null {
  if (!message) return null;
  if (message.reactionMessage || message.protocolMessage || (message.senderKeyDistributionMessage && Object.keys(message).length === 1)) return null;
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText;
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 4000);
  if (m.audioMessage) return '[Áudio recebido — ouça no WhatsApp]';
  if (m.imageMessage) return '[Imagem recebida — veja no WhatsApp]';
  if (m.videoMessage) return '[Vídeo recebido — veja no WhatsApp]';
  if (m.documentMessage) return '[Documento recebido — veja no WhatsApp]';
  if (m.stickerMessage) return null;
  if (m.contactMessage || m.locationMessage) return '[Contato ou localização recebidos — veja no WhatsApp]';
  return null;
}

/**
 * Extrai remetente e texto de uma mensagem recebida. Ignora grupos, status, canais,
 * mensagens enviadas pelo próprio usuário e mensagens antigas (histórico).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseIncoming(msg: any, maxAgeHours = 72): IncomingMessage | null {
  const key = msg?.key;
  if (!key || key.fromMe) return null;
  const jid: string = key.remoteJid ?? '';
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  let phoneJid: string | undefined;
  if (jid.endsWith('@s.whatsapp.net')) phoneJid = jid;
  else if (jid.endsWith('@lid')) phoneJid = key.senderPn ?? key.remoteJidAlt;
  const phone = phoneJid ? phoneJid.split(/[:@]/)[0].replace(/\D/g, '') : '';
  if (!phone) return null;
  const text = textOf(msg.message);
  if (!text) return null;
  const ts = Number(msg.messageTimestamp ?? 0);
  const atMs = ts > 0 ? ts * 1000 : Date.now();
  if (Date.now() - atMs > maxAgeHours * 3600_000) return null;
  return { id: String(key.id ?? ''), phone, text, at: new Date(atMs).toISOString() };
}

interface Index {
  map: Map<string, string>; // phoneKey -> leadId
  at: number;
}

/** Envio usado pela resposta automática (o SessionManager implementa). */
export type AutoSender = (userId: string, phone: string, text: string, o: { audio?: boolean; voice?: string }) => Promise<{ ok: true; id: string; to: string } | { ok: false; error: string }>;

/** O que a Edge Function devolve quando a BEELIE deve responder sozinha. */
interface AutoReply {
  messageId: string;
  body: string;
  intent?: string;
  format: 'texto' | 'audio';
  voice?: string;
  delaySec: number;
}

export class InboundRelay {
  private indexes = new Map<string, Index>();
  private loading = new Map<string, Promise<Index>>();
  /** Respostas automáticas agendadas, por conversa (usuário + telefone). */
  private pending = new Map<string, NodeJS.Timeout>();
  /** IDs das mensagens que a própria BEELIE enviou (o eco delas não cancela nada). */
  private ownIds = new Set<string>();
  private warnedDisabled = false;

  constructor(
    private db: SupabaseClient,
    private send?: AutoSender,
  ) {}

  get enabled() {
    return !!config.inboundSecret;
  }

  private url() {
    return config.inboundUrl || `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/whatsapp-qr-inbound`;
  }

  private post(body: Record<string, unknown>) {
    return fetch(this.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': config.inboundSecret },
      body: JSON.stringify(body),
    });
  }

  /** Telefones (WhatsApp e fixo) das empresas que são leads do usuário. */
  private async load(userId: string): Promise<Index> {
    const map = new Map<string, string>();
    const { data: leads, error } = await this.db.from('leads').select('id, company_id').eq('owner_id', userId);
    if (error) throw new Error(error.message);
    const byCompany = new Map<string, string>();
    for (const l of leads ?? []) byCompany.set(l.company_id as string, l.id as string);
    const ids = [...byCompany.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const { data: comps, error: e2 } = await this.db.from('companies').select('id, whatsapp, phone').eq('owner_id', userId).in('id', ids.slice(i, i + 500));
      if (e2) throw new Error(e2.message);
      for (const c of comps ?? []) {
        const leadId = byCompany.get(c.id as string);
        if (!leadId) continue;
        for (const raw of [c.whatsapp, c.phone] as (string | null)[]) {
          const d = toDigits(raw);
          if (d && !map.has(phoneKey(d))) map.set(phoneKey(d), leadId);
        }
      }
    }
    return { map, at: Date.now() };
  }

  private async index(userId: string, fresh = false): Promise<Index> {
    const cur = this.indexes.get(userId);
    // Cache de 5 min; num número desconhecido, recarrega (no máximo a cada 10 s) para achar lead recém-criado.
    if (cur && !fresh && Date.now() - cur.at < 5 * 60_000) return cur;
    if (cur && fresh && Date.now() - cur.at < 10_000) return cur;
    let p = this.loading.get(userId);
    if (!p) {
      p = this.load(userId).finally(() => this.loading.delete(userId));
      this.loading.set(userId, p);
    }
    const idx = await p;
    this.indexes.set(userId, idx);
    return idx;
  }

  async findLead(userId: string, phone: string): Promise<string | null> {
    const k = phoneKey(phone);
    let leadId = (await this.index(userId)).map.get(k);
    if (!leadId) leadId = (await this.index(userId, true)).map.get(k);
    return leadId ?? null;
  }

  private chatKey(userId: string, phone: string) {
    return `${userId}:${phoneKey(phone)}`;
  }

  /** Mensagem enviada por você (no celular ou no Lead Hunter): cancela a resposta automática daquela conversa. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cancelFor(userId: string, raw: any) {
    const id = String(raw?.key?.id ?? '');
    if (id && this.ownIds.has(id)) return;
    const jid: string = raw?.key?.remoteJid ?? '';
    const pnJid = jid.endsWith('@s.whatsapp.net') ? jid : raw?.key?.senderPn ?? raw?.key?.remoteJidAlt;
    const phone = pnJid ? String(pnJid).split(/[:@]/)[0].replace(/\D/g, '') : '';
    if (!phone) return;
    const key = this.chatKey(userId, phone);
    const t = this.pending.get(key);
    if (t) {
      clearTimeout(t);
      this.pending.delete(key);
      log.info({ user: maskUser(userId), to: maskPhone(phone) }, 'resposta automática cancelada: você respondeu');
    }
  }

  private schedule(userId: string, leadId: string, phone: string, auto: AutoReply) {
    if (!this.send) return;
    const key = this.chatKey(userId, phone);
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev); // o lead mandou outra mensagem: vale a sugestão mais nova
    const delay = Math.max(config.autoMinDelaySeconds, Math.min(600, auto.delaySec)) * 1000;
    const t = setTimeout(async () => {
      this.pending.delete(key);
      const r = await this.send!(userId, phone, auto.body, { audio: auto.format === 'audio', voice: auto.voice });
      if (!r.ok) {
        log.warn({ user: maskUser(userId), to: maskPhone(phone), err: r.error }, 'resposta automática não enviada');
        await this.post({ action: 'auto_failed', ownerId: userId, leadId, messageId: auto.messageId, error: r.error }).catch(() => undefined);
        return;
      }
      if (r.id) {
        this.ownIds.add(r.id);
        if (this.ownIds.size > 500) this.ownIds.delete(this.ownIds.values().next().value as string);
      }
      log.info({ user: maskUser(userId), to: maskPhone(phone), audio: auto.format === 'audio' }, 'BEELIE respondeu automaticamente');
      await this.post({ action: 'sent', ownerId: userId, leadId, messageId: auto.messageId, externalId: r.id, to: r.to, format: auto.format, intent: auto.intent }).catch((err) =>
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'falha ao registrar envio automático'),
      );
    }, delay);
    this.pending.set(key, t);
    log.info({ user: maskUser(userId), to: maskPhone(phone), inSec: Math.round(delay / 1000) }, 'resposta automática agendada');
  }

  /** Processa uma mensagem recebida: se for de um lead, encaminha (e agenda a resposta automática, se houver). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handle(userId: string, raw: any): Promise<'forwarded' | 'ignored' | 'error'> {
    if (!this.enabled) {
      if (!this.warnedDisabled) log.warn('respostas desligadas: falta WHATSAPP_INBOUND_SECRET no Railway');
      this.warnedDisabled = true;
      return 'ignored';
    }
    const m = parseIncoming(raw);
    if (!m) {
      const jid: string = raw?.key?.remoteJid ?? '';
      if (jid.endsWith('@lid') && !raw?.key?.senderPn && textOf(raw?.message)) log.warn({ user: maskUser(userId) }, 'mensagem ignorada: o WhatsApp não informou o número do remetente');
      return 'ignored';
    }
    try {
      const leadId = await this.findLead(userId, m.phone);
      if (!leadId) {
        log.info({ user: maskUser(userId) }, 'mensagem de contato que não é lead (ignorada)');
        return 'ignored'; // conversa pessoal: não sai daqui
      }
      const res = await this.post({ ownerId: userId, leadId, from: m.phone, body: m.text, externalId: m.id, receivedAt: m.at });
      if (!res.ok) throw new Error(`função respondeu ${res.status}`);
      log.info({ user: maskUser(userId), from: maskPhone(m.phone) }, 'resposta de lead registrada');
      const data = (await res.json().catch(() => ({}))) as { auto?: AutoReply | null };
      if (data.auto?.body && data.auto.messageId) this.schedule(userId, leadId, m.phone, data.auto);
      return 'forwarded';
    } catch (err) {
      log.error({ user: maskUser(userId), from: maskPhone(m.phone), err: err instanceof Error ? err.message : String(err) }, 'falha ao registrar resposta');
      return 'error';
    }
  }
}
