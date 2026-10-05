import { config } from './config.js';
import { log, maskPhone, maskUser } from './log.js';

/**
 * Fila das mensagens de campanha que saem pelo WhatsApp conectado (QR).
 *
 * O agendador das campanhas (Supabase) entrega as mensagens aqui; a fila envia uma de cada vez,
 * por usuário, com um intervalo sorteado entre envios para parecer gente (e não disparo em massa).
 * O resultado volta para o Supabase: enviada, ou falhou → vira tarefa manual como antes.
 * A fila fica em memória; se o serviço reiniciar, o Supabase transforma as pendentes em tarefa (após 2 h).
 */

export interface CampaignJob {
  ownerId: string;
  leadId: string;
  messageId: string;
  phone: string;
  text: string;
}

type Sender = (userId: string, phone: string, text: string) => Promise<{ ok: true; id: string; to: string } | { ok: false; error: string }>;

const MAX_PER_USER = 300;

export class CampaignQueue {
  private queues = new Map<string, CampaignJob[]>();
  private running = new Set<string>();
  private seen = new Set<string>();

  constructor(
    private send: Sender,
    private isConnected: (userId: string) => boolean,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Coloca na fila. false = não dá para enviar agora (WhatsApp desconectado ou fila cheia). */
  enqueue(job: CampaignJob): boolean {
    if (!this.isConnected(job.ownerId)) return false;
    if (this.seen.has(job.messageId)) return true;
    const q = this.queues.get(job.ownerId) ?? [];
    if (q.length >= MAX_PER_USER) return false;
    q.push(job);
    this.queues.set(job.ownerId, q);
    this.seen.add(job.messageId);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value as string);
    log.info({ user: maskUser(job.ownerId), to: maskPhone(job.phone), pending: q.length }, 'mensagem de campanha na fila');
    void this.run(job.ownerId);
    return true;
  }

  pending(userId: string) {
    return this.queues.get(userId)?.length ?? 0;
  }

  private gapMs() {
    const min = config.campaignGapMinSeconds;
    const max = Math.max(min, config.campaignGapMaxSeconds);
    return (min + Math.random() * (max - min)) * 1000;
  }

  private async run(userId: string) {
    if (this.running.has(userId)) return;
    this.running.add(userId);
    try {
      let first = true;
      for (;;) {
        const q = this.queues.get(userId);
        const job = q?.shift();
        if (!job) break;
        if (!first) await this.sleep(this.gapMs());
        first = false;
        await this.deliver(job);
      }
    } finally {
      this.running.delete(userId);
      this.queues.delete(userId);
    }
  }

  private async deliver(job: CampaignJob) {
    let r = await this.send(job.ownerId, job.phone, job.text);
    // Intervalo mínimo entre envios (uma resposta do BEELIE pode ter acabado de sair): espera e tenta de novo.
    for (let i = 0; i < 3 && !r.ok && /^Aguarde (\d+) s/.test(r.error); i++) {
      const s = Number(/^Aguarde (\d+) s/.exec(r.error)?.[1] ?? 10);
      await this.sleep((s + 1) * 1000);
      r = await this.send(job.ownerId, job.phone, job.text);
    }
    if (r.ok) {
      log.info({ user: maskUser(job.ownerId), to: maskPhone(job.phone) }, 'mensagem de campanha enviada');
      await report({ action: 'campaign_sent', ownerId: job.ownerId, leadId: job.leadId, messageId: job.messageId, externalId: r.id, to: r.to });
    } else {
      log.warn({ user: maskUser(job.ownerId), to: maskPhone(job.phone), err: r.error }, 'mensagem de campanha não enviada');
      await report({ action: 'campaign_failed', ownerId: job.ownerId, leadId: job.leadId, messageId: job.messageId, error: r.error });
    }
  }
}

async function report(body: Record<string, unknown>) {
  const url = config.inboundUrl || `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/whatsapp-qr-inbound`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': config.inboundSecret },
      body: JSON.stringify(body),
    });
    if (!res.ok) log.error({ status: res.status, action: body.action }, 'falha ao registrar envio de campanha');
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err), action: body.action }, 'falha ao registrar envio de campanha');
  }
}
