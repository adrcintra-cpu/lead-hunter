import type { Message } from '@/core/types';
import { toWhatsappNumber } from '@/core/utils';
import { whatsappClient, whatsappQrAvailable } from '@/lib/whatsappClient';
import { loadAssistant } from '@/services/assistant/assistantSettings';
import type { LeadHunterService } from '../leadHunterService';

/**
 * WhatsApp sem API: prepara a mensagem, monta o link wa.me e registra o que o usuário fez.
 * Nada é enviado pelo sistema — quem envia é a pessoa, no próprio WhatsApp.
 *
 * Toda a lógica de WhatsApp das telas passa por aqui. Para ligar uma API oficial no futuro,
 * basta trocar a implementação destes métodos; as telas continuam iguais.
 */
export class WhatsAppService {
  constructor(private svc: LeadHunterService) {}

  /** Número no padrão internacional, só dígitos (ex.: 5519999999999). */
  static toInternational(phone: string): string | null {
    return toWhatsappNumber(phone);
  }

  /** Link https://wa.me/TELEFONE?text=MENSAGEM, com o texto codificado. */
  static generateWhatsAppUrl(phone: string, text: string): string | null {
    const n = WhatsAppService.toInternational(phone);
    return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
  }

  /** Gera (pela IA, com os dados do lead) a mensagem de WhatsApp; é um follow-up se já houve contato. */
  prepareMessage(leadId: string, variant = 0): Promise<Message> {
    return this.svc.generateMessage(leadId, 'whatsapp', variant);
  }

  /** Link wa.me da mensagem (ou de um texto editado). Bloqueado para contatos na lista de supressão. */
  linkFor(messageId: string, text?: string): string | null {
    const m = this.svc.db.messages.find((x) => x.id === messageId);
    const lead = m && this.svc.db.leads.find((l) => l.id === m.leadId);
    const company = lead && this.svc.db.companies.find((c) => c.id === lead.companyId);
    if (!m || !lead || !company?.whatsapp || this.svc.suppressionFor(company, lead)) return null;
    return WhatsAppService.generateWhatsAppUrl(company.whatsapp, text ?? m.finalContent);
  }

  /** Registra que o WhatsApp foi aberto com a mensagem. Não é envio: entregue/lido não são confirmáveis. */
  registerOpen(messageId: string) {
    const m = this.svc.db.messages.find((x) => x.id === messageId);
    const lead = m && this.svc.db.leads.find((l) => l.id === m.leadId);
    if (!m || !lead) return;
    const at = this.svc.now().toISOString();
    this.svc.repo.batch(() => {
      if (m.status !== 'sent' && m.status !== 'replied') this.svc.repo.update('messages', messageId, { status: 'opened_whatsapp', updatedAt: at });
      this.svc.log(lead.id, 'whatsapp_opened', 'WhatsApp aberto com a mensagem preparada (wa.me)', {
        messageId,
        channel: 'whatsapp',
        status: 'WhatsApp aberto',
        message: m.finalContent,
        user: this.svc.profile.email,
      });
    });
  }

  /** Há serviço de WhatsApp por QR code configurado neste ambiente? */
  get connectedAvailable() {
    return whatsappQrAvailable;
  }

  /**
   * Envia UMA mensagem pelo WhatsApp conectado (QR code), a pedido do usuário.
   * Respeita a lista de supressão; o servidor confere conexão, número, intervalo e limite diário.
   * Não há envio em massa: cada clique envia uma mensagem.
   */
  async sendConnected(messageId: string, text?: string, opts: { audio?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
    const m = this.svc.db.messages.find((x) => x.id === messageId);
    const lead = m && this.svc.db.leads.find((l) => l.id === m.leadId);
    const company = lead && this.svc.db.companies.find((c) => c.id === lead.companyId);
    if (!m || !lead || !company) return { ok: false, error: 'Mensagem não encontrada.' };
    if (m.status === 'sent' || m.status === 'replied') return { ok: false, error: 'Esta mensagem já foi enviada.' };
    if (this.svc.suppressionFor(company, lead)) return { ok: false, error: 'Contato na lista de supressão: envio bloqueado.' };
    if (!company.whatsapp) return { ok: false, error: 'Esta empresa não tem WhatsApp cadastrado.' };
    const body = (text ?? m.finalContent).trim();
    if (!body) return { ok: false, error: 'A mensagem está vazia.' };
    // Envio direto não passa pela revisão do usuário no app do WhatsApp: não deixa sair "[SEU NOME]" e afins.
    if (/\[(SEU|SUA|SEUS|SUAS)\b[^\]]*\]/i.test(body)) return { ok: false, error: 'Complete os campos entre colchetes (ex.: [SEU NOME]) antes de enviar. Preencha seu perfil em Configurações ou edite a mensagem.' };
    try {
      if (opts.audio && body.length > 1500) return { ok: false, error: 'Texto longo demais para áudio (máx. 1.500 caracteres).' };
      const voice = opts.audio ? (await loadAssistant().catch(() => null))?.prefs.voice : undefined;
      const r = await whatsappClient.send(company.whatsapp, body, opts.audio ? { audio: true, voice } : {});
      if (!r.ok) {
        this.svc.log(lead.id, 'message_failed', 'Falha ao enviar pelo WhatsApp conectado', { messageId, channel: 'whatsapp', status: 'Falha no envio', error: r.error, user: this.svc.profile.email });
        return r;
      }
      this.svc.markSent(messageId, { provider: 'whatsapp_qr', externalId: r.id || undefined, recipient: r.to, audio: opts.audio });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** O usuário confirma que enviou. Registra "Enviado manualmente" com data e hora. */
  markSent(messageId: string) {
    return this.svc.markSent(messageId);
  }
}
