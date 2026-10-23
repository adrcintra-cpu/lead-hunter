import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { mediaFailReason } from './vision.js';
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
  // Cartão de contato (ex.: o lead indica quem decide): nome e telefone viram texto.
  const cards = m.contactMessage ? [m.contactMessage] : (m.contactsArrayMessage?.contacts ?? []);
  if (cards.length) {
    const lines = cards.slice(0, 5).map(contactCard).filter(Boolean);
    if (lines.length) return lines.map((l: string) => `[Contato compartilhado] ${l}`).join('\n').slice(0, 4000);
  }
  if (m.contactMessage || m.contactsArrayMessage || m.locationMessage) return '[Contato ou localização recebidos — veja no WhatsApp]';
  return null;
}

/** "Nome — telefone(s) — e-mail" a partir de um cartão de contato (vCard) do WhatsApp. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function contactCard(c: any): string {
  const vcard = String(c?.vcard ?? '');
  const fn = /^FN[^:]*:(.+)$/im.exec(vcard)?.[1]?.trim();
  const name = String(c?.displayName ?? fn ?? '').trim().slice(0, 80);
  const phones = [...vcard.matchAll(/^TEL[^:\n]*?(?:waid=(\d+))?[^:\n]*:(.+)$/gim)].map((x) => (x[2] ?? '').trim() || (x[1] ? `+${x[1]}` : '')).filter(Boolean);
  const emails = [...vcard.matchAll(/^EMAIL[^:\n]*:(.+)$/gim)].map((x) => x[1].trim()).filter(Boolean);
  const parts = [name, ...new Set(phones)].filter(Boolean);
  if (emails.length) parts.push(emails[0]);
  return parts.join(' — ');
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
export type AutoSender = (userId: string, slot: string, phone: string, text: string, o: { audio?: boolean; voice?: string }) => Promise<{ ok: true; id: string; to: string } | { ok: false; error: string }>;

/** O que a Edge Function devolve quando o BEELIE deve responder sozinho. */
interface AutoReply {
  messageId: string;
  body: string;
  intent?: string;
  format: 'texto' | 'audio';
  voice?: string;
  delaySec: number;
}

/** Linhas por página nas consultas ao banco (limite padrão do Supabase). */
const PAGE = 1000;

export class InboundRelay {
  private indexes = new Map<string, Index>();
  private loading = new Map<string, Promise<Index>>();
  /** Respostas automáticas agendadas, por conversa (usuário + telefone). */
  private pending = new Map<string, NodeJS.Timeout>();
  /** IDs das mensagens que o próprio BEELIE enviou (o eco delas não cancela nada). */
  private ownIds = new Set<string>();
  private warnedDisabled = false;

  constructor(
    private db: SupabaseClient,
    private send?: AutoSender,
    /** Transcreve um áudio recebido (baixa a mídia pela sessão do usuário). Sem ele, o áudio vira um aviso. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private transcriber?: (userId: string, slot: string, raw: any) => Promise<string | null>,
    /** O número já é contato seu (agenda ou conversa anterior)? Esses nunca viram lead sozinhos. */
    private isKnownContact?: (userId: string, phone: string) => boolean,
  ) {}

  private unknownCfg = new Map<string, { on: boolean; at: number }>();
  private ownerCfg = new Map<string, { phone: string | null; at: number }>();

  /** Seu WhatsApp pessoal (Configurações → Assistente). Cache de 1 min; sem a coluna, nenhum. */
  private async ownerPhone(userId: string): Promise<string | null> {
    const c = this.ownerCfg.get(userId);
    if (c && Date.now() - c.at < 60_000) return c.phone;
    const { data, error } = await this.db.from('assistant_settings').select('owner_whatsapp').eq('owner_id', userId).maybeSingle();
    const raw = !error && typeof data?.owner_whatsapp === 'string' ? data.owner_whatsapp : '';
    const phone = toDigits(raw) ? raw : null;
    this.ownerCfg.set(userId, { phone, at: Date.now() });
    return phone;
  }

  private async isOwner(userId: string, phone: string): Promise<boolean> {
    const owner = await this.ownerPhone(userId);
    const d = owner ? toDigits(owner) : null;
    return !!d && phoneKey(d) === phoneKey(phone);
  }

  /** Envia (com nova tentativa se outra mensagem acabou de sair) e marca como do BEELIE. */
  private async sendOwn(userId: string, slot: string, phone: string, text: string): Promise<boolean> {
    if (!this.send) return false;
    let r = await this.send(userId, slot, phone, text, {});
    for (let i = 0; i < 3 && !r.ok && /^Aguarde (\d+) s/.test(r.error); i++) {
      await new Promise((ok) => setTimeout(ok, (Number(/^Aguarde (\d+) s/.exec(r.ok ? '' : r.error)?.[1] ?? 10) + 1) * 1000));
      r = await this.send(userId, slot, phone, text, {});
    }
    if (!r.ok) {
      log.warn({ user: maskUser(userId), to: maskPhone(phone), err: r.error }, 'mensagem para o dono não enviada');
      return false;
    }
    if (r.id) this.markOwn(r.id);
    return true;
  }

  /** Aviso ou relatório para o seu WhatsApp pessoal. */
  async notifyOwner(userId: string, text: string, slot: string): Promise<boolean> {
    const owner = await this.ownerPhone(userId);
    const d = owner ? toDigits(owner) : null;
    if (!d || !text.trim()) return false;
    const ok = await this.sendOwn(userId, slot, d, text.slice(0, 3500));
    if (ok) log.info({ user: maskUser(userId) }, 'aviso enviado para o dono');
    return ok;
  }

  /** Mensagem sua para o BEELIE: pedido, contato para prospectar (cartão, texto ou print) ou relatório. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleOwner(userId: string, slot: string, m: IncomingMessage, raw: any): Promise<'forwarded' | 'error'> {
    const body = (await this.audioText(userId, slot, raw)) ?? m.text;
    const history = this.ownerHistory(userId);
    const res = await this.post({ action: 'owner', ownerId: userId, from: m.phone, body, history: history || undefined });
    if (!res.ok) throw new Error(`função respondeu ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { reply?: string | null };
    log.info({ user: maskUser(userId) }, 'pedido do dono recebido');
    this.rememberOwner(userId, `Você: ${body}`);
    if (data.reply) {
      await this.sendOwn(userId, slot, m.phone, data.reply);
      this.rememberOwner(userId, `BEELIE: ${data.reply}`);
    }
    return 'forwarded';
  }

  /** Últimas trocas com o dono (só em memória, 30 min), para perguntas de continuação ("e ela?"). */
  private ownerChat = new Map<string, { lines: string[]; at: number }>();
  private rememberOwner(userId: string, line: string) {
    const cur = this.ownerChat.get(userId);
    const lines = cur && Date.now() - cur.at < 30 * 60_000 ? cur.lines : [];
    lines.push(line.replace(/\s+/g, ' ').slice(0, 500));
    this.ownerChat.set(userId, { lines: lines.slice(-8), at: Date.now() });
  }
  private ownerHistory(userId: string): string {
    const cur = this.ownerChat.get(userId);
    return cur && Date.now() - cur.at < 30 * 60_000 ? cur.lines.join('\n') : '';
  }

  /** Opção "Atender quem chama sem ser lead" (cache de 1 min; sem a coluna, desligada). */
  private async answersUnknown(userId: string): Promise<boolean> {
    const c = this.unknownCfg.get(userId);
    if (c && Date.now() - c.at < 60_000) return c.on;
    const { data, error } = await this.db.from('assistant_settings').select('answer_unknown').eq('owner_id', userId).maybeSingle();
    const on = !error && data?.answer_unknown === true;
    this.unknownCfg.set(userId, { on, at: Date.now() });
    return on;
  }

  /** Número que não é lead: com a opção ligada, a Edge Function decide se é contato comercial. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleUnknown(userId: string, slot: string, m: IncomingMessage, raw: any): Promise<'forwarded' | 'ignored'> {
    const skip = (why: string) => {
      log.info({ user: maskUser(userId), why }, 'mensagem de contato que não é lead (ignorada)');
      return 'ignored' as const;
    };
    if (!(await this.answersUnknown(userId))) return skip('opção desligada');
    if (this.isKnownContact?.(userId, m.phone)) return skip('contato seu');
    // Só texto de agora: áudio, imagem e histórico de quem não é lead não são processados.
    if (m.text.startsWith('[')) return skip('não é texto');
    if (Date.now() - Date.parse(m.at) > 15 * 60_000) return skip('mensagem antiga');
    if (!m.phone.startsWith('55')) return skip('número de fora do Brasil');
    const name = typeof raw?.pushName === 'string' ? raw.pushName.slice(0, 60) : undefined;
    const res = await this.post({ action: 'unknown', ownerId: userId, from: m.phone, body: m.text, name, externalId: m.id, receivedAt: m.at, waSlot: slot });
    if (!res.ok) throw new Error(`função respondeu ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { leadId?: string | null; created?: boolean; auto?: AutoReply | null; notify?: string | null };
    if (!data.leadId) return skip('não é contato comercial');
    if (data.notify) void this.notifyOwner(userId, data.notify, slot);
    // Daqui em diante o número é lead: as próximas mensagens seguem o caminho normal.
    const idx = this.indexes.get(userId);
    if (idx) idx.map.set(phoneKey(m.phone), data.leadId);
    log.info({ user: maskUser(userId), from: maskPhone(m.phone), created: !!data.created }, 'contato novo virou lead');
    if (data.auto?.body && data.auto.messageId) this.schedule(userId, slot, data.leadId, m.phone, data.auto);
    return 'forwarded';
  }

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
    // Em páginas de 1000 e sem listas de ids na URL: com milhares de leads, ".in(ids)" estoura o
    // tamanho da URL e a consulta falha ("fetch failed"), e nenhuma resposta chegava aos leads.
    const all = async (table: string, cols: string): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.db.from(table).select(cols).eq('owner_id', userId).order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    };
    const leads = await all('leads', 'id, company_id');
    const byCompany = new Map<string, string>();
    for (const l of leads) byCompany.set(l.company_id as string, l.id as string);
    const comps = await all('companies', 'id, whatsapp, phone');
    for (const c of comps) {
      const leadId = byCompany.get(c.id as string);
      if (!leadId) continue;
      for (const raw of [c.whatsapp, c.phone] as (string | null)[]) {
        const d = toDigits(raw);
        if (d && !map.has(phoneKey(d))) map.set(phoneKey(d), leadId);
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

  /** Registra uma mensagem enviada pelo próprio serviço (resposta automática ou campanha). */
  markOwn(id: string) {
    if (!id) return;
    this.ownIds.add(id);
    if (this.ownIds.size > 500) this.ownIds.delete(this.ownIds.values().next().value as string);
  }

  isOwn(id: string) {
    return !!id && this.ownIds.has(id);
  }

  private dropPending(userId: string, phone: string) {
    const key = this.chatKey(userId, phone);
    const t = this.pending.get(key);
    if (!t) return;
    clearTimeout(t);
    this.pending.delete(key);
    log.info({ user: maskUser(userId), to: maskPhone(phone) }, 'resposta automática cancelada: nova mensagem sem resposta automática');
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

  private schedule(userId: string, slot: string, leadId: string, phone: string, reply: AutoReply) {
    let auto = reply;
    if (!this.send) return;
    const key = this.chatKey(userId, phone);
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev); // o lead mandou outra mensagem: vale a sugestão mais nova
    const delay = Math.max(config.autoMinDelaySeconds, Math.min(600, auto.delaySec)) * 1000;
    const t = setTimeout(async () => {
      this.pending.delete(key);
      let r = await this.send!(userId, slot, phone, auto.body, { audio: auto.format === 'audio', voice: auto.voice });
      // Outra mensagem acabou de sair (ex.: campanha para outro lead): espera o intervalo mínimo e tenta de novo.
      for (let i = 0; i < 3 && !r.ok && /^Aguarde (\d+) s/.test(r.error); i++) {
        await new Promise((ok) => setTimeout(ok, (Number(/^Aguarde (\d+) s/.exec(r.ok ? '' : r.error)?.[1] ?? 10) + 1) * 1000));
        r = await this.send!(userId, slot, phone, auto.body, { audio: auto.format === 'audio', voice: auto.voice });
      }
      if (!r.ok && auto.format === 'audio' && /udio|OPENAI/i.test(r.error)) {
        // A voz falhou (chave, crédito ou instabilidade): o lead recebe em texto em vez de ficar sem resposta.
        log.warn({ user: maskUser(userId), to: maskPhone(phone), err: r.error }, 'áudio indisponível: resposta enviada em texto');
        auto = { ...auto, format: 'texto' };
        r = await this.send!(userId, slot, phone, auto.body, {});
      }
      if (!r.ok) {
        log.warn({ user: maskUser(userId), to: maskPhone(phone), err: r.error }, 'resposta automática não enviada');
        await this.post({ action: 'auto_failed', ownerId: userId, leadId, messageId: auto.messageId, error: r.error }).catch(() => undefined);
        return;
      }
      if (r.id) this.markOwn(r.id);
      log.info({ user: maskUser(userId), to: maskPhone(phone), audio: auto.format === 'audio' }, 'O BEELIE respondeu automaticamente');
      await this.post({ action: 'sent', ownerId: userId, leadId, messageId: auto.messageId, externalId: r.id, to: r.to, format: auto.format, intent: auto.intent, waSlot: slot }).catch((err) =>
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'falha ao registrar envio automático'),
      );
    }, delay);
    this.pending.set(key, t);
    log.info({ user: maskUser(userId), to: maskPhone(phone), inSec: Math.round(delay / 1000) }, 'resposta automática agendada');
  }

  /**
   * Áudio ou imagem de lead: transcreve o áudio / lê a imagem (print de contato, cartão de visita).
   * Devolve null quando não é mídia ou não deu para ler (fica o aviso de sempre).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async audioText(userId: string, slot: string, raw: any): Promise<string | null> {
    const msg = raw?.message;
    const m = msg?.ephemeralMessage?.message ?? msg?.viewOnceMessage?.message ?? msg;
    const audio = m?.audioMessage;
    const image = m?.imageMessage;
    if ((!audio && !image) || !this.transcriber) return null;
    try {
      const text = await this.transcriber(userId, slot, raw);
      if (!text) return null;
      if (audio) {
        log.info({ user: maskUser(userId), seconds: Number(audio.seconds) || undefined }, 'áudio de lead transcrito');
        return `[Áudio transcrito] ${text}`.slice(0, 4000);
      }
      log.info({ user: maskUser(userId) }, 'imagem de lead lida');
      const caption = typeof image.caption === 'string' && image.caption.trim() ? `\nLegenda: ${image.caption.trim()}` : '';
      return `[Imagem] ${text}${caption}`.slice(0, 4000);
    } catch (err) {
      log.warn({ user: maskUser(userId), err: err instanceof Error ? err.message : String(err) }, audio ? 'áudio de lead não transcrito' : 'imagem de lead não lida');
      // Aviso com o motivo (vale para o histórico e para a resposta ao dono).
      const why = mediaFailReason(err);
      return audio ? `[Áudio recebido — não transcrito: ${why}]` : `[Imagem recebida — não lida: ${why}]`;
    }
  }

  /** Processa uma mensagem recebida: se for de um lead, encaminha (e agenda a resposta automática, se houver). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handle(userId: string, raw: any, slot = 'principal'): Promise<'forwarded' | 'ignored' | 'error'> {
    if (!this.enabled) {
      if (!this.warnedDisabled) log.warn('respostas desligadas: falta WHATSAPP_INBOUND_SECRET no Railway');
      this.warnedDisabled = true;
      return 'ignored';
    }
    const m = parseIncoming(raw);
    if (!m) {
      const jid: string = raw?.key?.remoteJid ?? '';
      if (!jid.endsWith('@g.us') && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter')) {
        const why = !textOf(raw?.message) ? 'sem texto (figurinha, reação ou tipo não suportado)' : 'mensagem antiga ou sem remetente';
        log.info({ user: maskUser(userId), why }, 'mensagem recebida ignorada');
      }
      if (jid.endsWith('@lid') && !raw?.key?.senderPn && !raw?.key?.remoteJidAlt && textOf(raw?.message)) log.warn({ user: maskUser(userId) }, 'mensagem ignorada: o WhatsApp não informou o número do remetente');
      return 'ignored';
    }
    try {
      // Você (o dono) escrevendo do seu WhatsApp pessoal: conversa com o BEELIE, não vira lead.
      if (await this.isOwner(userId, m.phone)) return await this.handleOwner(userId, slot, m, raw);
      const leadId = await this.findLead(userId, m.phone);
      log.info({ user: maskUser(userId), from: maskPhone(m.phone), lead: !!leadId }, 'mensagem de WhatsApp recebida');
      // Não é lead: conversa pessoal não sai daqui, a menos que a opção de atender desconhecidos esteja ligada.
      if (!leadId) return await this.handleUnknown(userId, slot, m, raw);
      const body = (await this.audioText(userId, slot, raw)) ?? m.text;
      const res = await this.post({ ownerId: userId, leadId, from: m.phone, body, externalId: m.id, receivedAt: m.at, waSlot: slot });
      if (!res.ok) throw new Error(`função respondeu ${res.status}`);
      log.info({ user: maskUser(userId), from: maskPhone(m.phone) }, 'resposta de lead registrada');
      const data = (await res.json().catch(() => ({}))) as { auto?: AutoReply | null; notify?: string | null };
      if (data.notify) void this.notifyOwner(userId, data.notify, slot);
      if (data.auto?.body && data.auto.messageId) this.schedule(userId, slot, leadId, m.phone, data.auto);
      // Sem resposta automática para esta mensagem (robô do outro lado, limite, fora do horário):
      // a resposta que estava agendada para a mensagem anterior também não sai.
      else this.dropPending(userId, m.phone);
      return 'forwarded';
    } catch (err) {
      log.error({ user: maskUser(userId), from: maskPhone(m.phone), err: err instanceof Error ? err.message : String(err) }, 'falha ao registrar resposta');
      return 'error';
    }
  }
}
