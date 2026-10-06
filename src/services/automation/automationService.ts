import { nextDayWindow, plan, startOfDayBRT, type Effect, type PlanContext } from '../../../supabase/functions/_shared/automation/planner.ts';
import { ADVANCED_STAGES, messageStage, parseSubject, renderTemplate, replyDecision, withOptOutFooter, type TemplateData } from '../../../supabase/functions/_shared/automation/replies.ts';
import {
  CLOSED_STAGES,
  DEFAULT_SEND_WINDOW,
  REPLY_CATEGORY_LABEL,
  type Cadence,
  type CadenceStep,
  type Campaign,
  type CampaignAudience,
  type Company,
  type Enrollment,
  type InboundMessage,
  type Lead,
  type LeadStage,
  type Message,
  type MessageDraft,
  type ReplyAnalysis,
  type SendChannel,
  type Task,
} from '@/core/types';
import type { ResultsSnapshot } from '@/core/providers/types';
import { digits, normalize, uid } from '@/core/utils';
import { leadContext, type LeadHunterService } from '../leadHunterService';
import { WhatsAppService } from '../whatsapp/whatsAppService';
import { DEFAULT_ASSISTANT, loadAssistant } from '@/services/assistant/assistantSettings';

type SendStep = Extract<CadenceStep, { type: 'send' }>;


/**
 * Campanhas, cadências, envios, respostas e tarefas.
 *
 * No modo de teste tudo roda aqui, com relógio simulado e envios simulados.
 * No modo Supabase o app só configura (campanhas, rascunhos, ativação); quem envia
 * e processa respostas é o servidor (Edge Functions cadence-runner e webhooks),
 * usando o mesmo planejador de cadências.
 */
export class AutomationService {
  private ticking = false;

  constructor(private svc: LeadHunterService) {}

  private get repo() {
    return this.svc.repo;
  }
  private get db() {
    return this.svc.db;
  }
  private nowIso() {
    return this.svc.now().toISOString();
  }

  /** Envio roda neste navegador? (só no modo de teste) */
  get runsLocally(): boolean {
    return !!(this.svc.providers.whatsappSender && this.svc.providers.emailSender);
  }

  // ---------- Cadências ----------

  saveCadence(c: Cadence): Cadence {
    const clean: Cadence = {
      ...c,
      name: c.name.trim() || 'Cadência sem nome',
      steps: c.steps.map((s) => (s.type === 'wait' ? { ...s, days: Math.max(0, Math.round(Number(s.days) || 0)) } : s)),
      updatedAt: this.nowIso(),
    };
    if (this.db.cadences.some((x) => x.id === c.id)) {
      this.repo.update('cadences', c.id, clean);
      return clean;
    }
    return this.repo.insert('cadences', { ...clean, id: c.id || uid('cad'), createdAt: this.nowIso() });
  }

  cadenceInUse(cadenceId: string): Campaign | undefined {
    return this.db.campaigns.find((c) => c.cadenceId === cadenceId && (c.status === 'ativa' || c.status === 'agendada' || c.status === 'pausada'));
  }

  deleteCadence(cadenceId: string) {
    const used = this.cadenceInUse(cadenceId);
    if (used) throw new Error(`A cadência está em uso na campanha “${used.name}”.`);
    this.repo.remove('cadences', cadenceId);
  }

  // ---------- Campanhas ----------

  createCampaign(input: Omit<Campaign, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Campaign {
    const at = this.nowIso();
    return this.repo.insert('campaigns', { ...input, name: input.name.trim(), id: uid('camp'), status: 'rascunho', createdAt: at, updatedAt: at });
  }

  updateCampaign(id: string, patch: Partial<Campaign>) {
    this.repo.update('campaigns', id, patch);
  }

  /**
   * Exclui campanhas (qualquer status): as inscrições saem junto e os envios param.
   * Leads em cadência voltam para "Qualificado"; mensagens e tarefas ficam no histórico, sem o vínculo.
   */
  async deleteCampaigns(ids: string[]) {
    const set = new Set(ids);
    const camps = this.db.campaigns.filter((c) => set.has(c.id));
    if (!camps.length) return 0;
    const inCadence = new Set(this.db.enrollments.filter((e) => set.has(e.campaignId) && (e.status === 'ativa' || e.status === 'pausada')).map((e) => e.leadId));
    const otherActive = new Set(this.db.enrollments.filter((e) => !set.has(e.campaignId) && (e.status === 'ativa' || e.status === 'pausada')).map((e) => e.leadId));
    await this.repo.purge({ campaignIds: camps.map((c) => c.id) });
    this.repo.batch(() => {
      for (const lead of this.db.leads) {
        if (inCadence.has(lead.id) && !otherActive.has(lead.id) && lead.stage === 'em_cadencia') this.repo.update('leads', lead.id, { stage: 'qualificado' });
      }
    });
    return camps.length;
  }

  deleteCampaign(id: string) {
    return this.deleteCampaigns([id]);
  }

  private companyOf(lead: Lead): Company | undefined {
    return this.db.companies.find((c) => c.id === lead.companyId);
  }

  /** Leads que entram no público, sem opt-out, sem etapa final e sem outra cadência ativa. */
  audienceLeads(a: CampaignAudience, excludeCampaignId?: string): Lead[] {
    const busy = new Set(
      this.db.enrollments.filter((e) => e.campaignId !== excludeCampaignId && (e.status === 'ativa' || e.status === 'pausada')).map((e) => e.leadId),
    );
    const inList = a.listId ? new Set(this.db.listMembers.filter((m) => m.listId === a.listId).map((m) => m.leadId)) : null;
    return this.db.leads.filter((l) => {
      const c = this.companyOf(l);
      if (!c) return false;
      if (CLOSED_STAGES.includes(l.stage) || busy.has(l.id)) return false;
      if (this.svc.suppressionFor(c, l)) return false;
      if (inList && !inList.has(l.id)) return false;
      if (a.segments.length && !a.segments.some((s) => normalize(s) === normalize(c.segment))) return false;
      if (a.cities.length && !a.cities.some((s) => normalize(s) === normalize(c.city))) return false;
      if (a.stages.length && !a.stages.includes(l.stage)) return false;
      if (a.tags.length && !a.tags.some((t) => (l.tags ?? []).map(normalize).includes(normalize(t)))) return false;
      return l.currentScore >= (a.minScore || 0);
    });
  }

  /**
   * Inscreve o público e gera a primeira mensagem de cada lead para revisão.
   * Nada é enviado aqui: a campanha só envia depois de ativada.
   */
  async prepareCampaign(campaignId: string, onProgress: (done: number, total: number) => void = () => {}) {
    const camp = this.db.campaigns.find((c) => c.id === campaignId);
    const cad = camp && this.db.cadences.find((c) => c.id === camp.cadenceId);
    if (!camp || !cad) throw new Error('Campanha ou cadência não encontrada.');
    const enrolled = new Set(this.db.enrollments.filter((e) => e.campaignId === campaignId).map((e) => e.leadId));
    const leads = this.audienceLeads(camp.audience, campaignId).filter((l) => !enrolled.has(l.id));
    const firstIdx = cad.steps.findIndex((s) => s.type === 'send');
    const first = firstIdx >= 0 ? (cad.steps[firstIdx] as SendStep) : null;
    let done = 0;
    for (let i = 0; i < leads.length; i += 4) {
      await Promise.all(
        leads.slice(i, i + 4).map(async (lead) => {
          const draft = first ? await this.compose(lead, cad, firstIdx, camp.name) : undefined;
          const at = this.nowIso();
          this.repo.insert('enrollments', {
            id: uid('enr'),
            campaignId,
            cadenceId: cad.id,
            leadId: lead.id,
            stepIndex: 0,
            status: 'pendente',
            draft,
            createdAt: at,
            updatedAt: at,
          });
          onProgress(++done, leads.length);
        }),
      );
    }
    return leads.length;
  }

  editDraft(enrollmentId: string, body: string, subject?: string) {
    const e = this.db.enrollments.find((x) => x.id === enrollmentId);
    if (!e?.draft) return;
    this.repo.update('enrollments', enrollmentId, { draft: { ...e.draft, body, subject: subject ?? e.draft.subject, editedByUser: true } });
  }

  removeEnrollment(enrollmentId: string) {
    const e = this.db.enrollments.find((x) => x.id === enrollmentId);
    if (e && e.status !== 'pendente') throw new Error('Só é possível remover leads antes de ativar a campanha.');
    this.repo.remove('enrollments', enrollmentId);
  }

  /** Ativa agora ou agenda. Os envios respeitam a janela de horário do perfil. */
  activateCampaign(campaignId: string, scheduledAt?: string) {
    const camp = this.db.campaigns.find((c) => c.id === campaignId);
    if (!camp) return;
    const pending = this.db.enrollments.filter((e) => e.campaignId === campaignId && e.status === 'pendente');
    if (!pending.length && !camp.autoEnroll) throw new Error('Nenhum lead preparado. Clique em “Preparar mensagens” primeiro.');
    const now = this.svc.now();
    const start = scheduledAt && new Date(scheduledAt) > now ? scheduledAt : now.toISOString();
    const scheduled = start !== now.toISOString();
    this.repo.batch(() => {
      this.repo.update('campaigns', campaignId, { status: scheduled ? 'agendada' : 'ativa', scheduledAt: scheduled ? start : undefined, startedAt: scheduled ? undefined : start });
      for (const e of pending) {
        this.repo.update('enrollments', e.id, { status: 'ativa', nextRunAt: start, startedAt: start });
        const lead = this.db.leads.find((l) => l.id === e.leadId);
        this.svc.log(e.leadId, 'campaign_enrolled', `Entrou na campanha “${camp.name}”${scheduled ? ` (início ${new Date(start).toLocaleString('pt-BR')})` : ''}`, { campaignId });
        if (lead && (lead.stage === 'novo' || lead.stage === 'qualificado')) this.svc.changeStage(lead.id, 'em_cadencia');
      }
    });
  }

  pauseCampaign(campaignId: string) {
    this.repo.batch(() => {
      this.repo.update('campaigns', campaignId, { status: 'pausada' });
      this.db.enrollments.filter((e) => e.campaignId === campaignId && e.status === 'ativa').forEach((e) => this.setEnrollment(e, 'pausada', 'Campanha pausada'));
    });
  }

  resumeCampaign(campaignId: string) {
    this.repo.batch(() => {
      this.repo.update('campaigns', campaignId, { status: 'ativa', startedAt: this.db.campaigns.find((c) => c.id === campaignId)?.startedAt ?? this.nowIso() });
      // Só retoma quem foi pausado pela campanha; quem respondeu continua pausado para atendimento humano.
      this.db.enrollments
        .filter((e) => e.campaignId === campaignId && e.status === 'pausada' && e.stopReason === 'Campanha pausada')
        .forEach((e) => this.setEnrollment(e, 'ativa'));
    });
  }

  finishCampaign(campaignId: string) {
    this.repo.batch(() => {
      this.repo.update('campaigns', campaignId, { status: 'finalizada', finishedAt: this.nowIso() });
      this.db.enrollments
        .filter((e) => e.campaignId === campaignId && (e.status === 'ativa' || e.status === 'pausada' || e.status === 'pendente'))
        .forEach((e) => this.setEnrollment(e, 'interrompida', 'Campanha finalizada'));
    });
  }

  /** Pausar, retomar ou encerrar a cadência de um lead. */
  setEnrollment(e: Enrollment, status: 'ativa' | 'pausada' | 'interrompida', reason?: string) {
    const now = this.svc.now();
    const patch: Partial<Enrollment> = { status, stopReason: reason };
    if (status === 'ativa') patch.nextRunAt = new Date(Math.max(now.getTime(), new Date(e.nextRunAt ?? now).getTime())).toISOString();
    this.repo.update('enrollments', e.id, patch);
    const camp = this.db.campaigns.find((c) => c.id === e.campaignId);
    const type = status === 'ativa' ? 'cadence_resumed' : status === 'pausada' ? 'cadence_paused' : 'cadence_stopped';
    const verb = status === 'ativa' ? 'retomada' : status === 'pausada' ? 'pausada' : 'encerrada';
    this.svc.log(e.leadId, type, `Cadência ${verb}${camp ? ` (${camp.name})` : ''}${reason ? `: ${reason}` : ''}`, { enrollmentId: e.id });
  }

  // ---------- Composição de mensagens ----------

  private templateData(lead: Lead, c: Company): TemplateData {
    const p = this.svc.profile;
    return {
      empresa: c.tradeName ?? c.legalName,
      nome: lead.contactName?.split(' ')[0],
      cargo: lead.contactRole,
      cidade: c.city,
      estado: c.state,
      segmento: c.segment.toLowerCase(),
      site: c.website,
      remetente: p.fullName || undefined,
      minha_empresa: p.companyName || undefined,
      oferta: p.offer || undefined,
    };
  }

  /** Escreve a mensagem de uma etapa: pela IA (com dados reais) ou pelo template. */
  async compose(lead: Lead, cad: Cadence, stepIndex: number, campaignName?: string): Promise<MessageDraft> {
    const step = cad.steps[stepIndex] as SendStep;
    const c = this.companyOf(lead)!;
    const stage = messageStage(cad.steps, stepIndex);
    const at = this.nowIso();
    if (step.mode === 'template' && step.template.trim()) {
      const data = this.templateData(lead, c);
      const body = renderTemplate(step.template, data);
      const subject = step.subject ? renderTemplate(step.subject, data).text : undefined;
      const text = step.channel === 'email' ? withOptOutFooter(body.text) : body.text;
      return { channel: step.channel, subject, body: text, context: body.context, model: 'template', template: step.whatsappTemplate || step.label || 'Template', editedByUser: false, generatedAt: at };
    }
    const p = this.svc.profile;
    const raw = await this.svc.ai.generateApproach(c, step.channel, {
      variant: 0,
      senderName: p.fullName,
      senderCompany: p.companyName,
      offer: p.offer,
      contactName: lead.contactName,
      contactRole: lead.contactRole,
      stage,
      instructions: step.template || undefined,
      // Histórico do lead: o follow-up continua a conversa em vez de repetir a primeira mensagem.
      ...this.svc.conversationContext(lead.id),
      campaignName,
    });
    const parsed = parseSubject(raw);
    const subject = parsed.subject;
    let body = parsed.body;
    if (step.channel === 'email') {
      if (p.signature && !body.includes(p.signature)) body = `${body}\n\n${p.signature}`;
      body = withOptOutFooter(body);
    }
    return {
      channel: step.channel,
      subject: subject ?? (step.subject ? renderTemplate(step.subject, this.templateData(lead, c)).text : undefined),
      body,
      context: leadContext(c, lead),
      model: this.svc.ai.model,
      template: step.whatsappTemplate ? `IA + template Meta “${step.whatsappTemplate}”` : `IA — ${stage === 'primeira' ? 'mensagem inicial' : stage === 'ultimo' ? 'último contato' : 'acompanhamento'}`,
      editedByUser: false,
      generatedAt: at,
    };
  }

  // ---------- Execução (modo de teste) ----------

  private repliedSince(leadId: string, since?: string) {
    return this.db.inbound.filter((r) => r.leadId === leadId && r.classification !== 'ausente' && (!since || r.receivedAt >= since));
  }

  private context(e: Enrollment, lead: Lead, c: Company): PlanContext {
    const replies = this.repliedSince(lead.id, e.startedAt);
    const msgs = this.db.messages.filter((m) => m.enrollmentId === e.id);
    return {
      now: this.svc.now(),
      replied: replies.length > 0,
      interested: replies.some((r) => r.classification === 'interessado' || r.classification === 'reuniao'),
      read: msgs.some((m) => m.status === 'read' || m.status === 'replied'),
      suppressed: !!this.svc.suppressionFor(c, lead),
      hasWhatsapp: !!c.whatsapp,
      hasWhatsappConsent: !!lead.whatsappConsentAt,
      // WhatsApp sem API: a cadência nunca envia sozinha, cria tarefa com o link wa.me.
      whatsappAuto: false,
      closed: CLOSED_STAGES.includes(lead.stage),
      hasEmail: !!lead.email,
      window: this.svc.profile.sendWindow ?? DEFAULT_SEND_WINDOW,
    };
  }

  /** Processa o que está vencido. No modo de teste é chamado pelo relógio e pelo botão "Avançar". */
  async tick(): Promise<{ processed: number }> {
    if (!this.runsLocally || this.ticking) return { processed: 0 };
    this.ticking = true;
    let processed = 0;
    try {
      const now = this.svc.now();
      this.advanceDeliveryStatus(now);
      for (const camp of this.db.campaigns.filter((c) => c.status === 'agendada' && c.scheduledAt && new Date(c.scheduledAt) <= now)) {
        this.repo.update('campaigns', camp.id, { status: 'ativa', startedAt: camp.scheduledAt });
      }
      const active = new Set(this.db.campaigns.filter((c) => c.status === 'ativa').map((c) => c.id));
      // Melhores leads primeiro: com limite diário, são eles que usam a cota do dia.
      const score = (leadId: string) => this.db.leads.find((l) => l.id === leadId)?.currentScore ?? 0;
      const due = this.db.enrollments
        .filter((e) => e.status === 'ativa' && active.has(e.campaignId) && e.nextRunAt && new Date(e.nextRunAt) <= now)
        .sort((a, b) => score(b.leadId) - score(a.leadId));
      for (const e of due) {
        await this.runEnrollment(e.id);
        processed++;
      }
      // Campanha sem ninguém ativo termina sozinha (exceto com entrada automática: novos leads ainda podem chegar).
      for (const id of active) {
        if (this.db.campaigns.find((c) => c.id === id)?.autoEnroll) continue;
        const es = this.db.enrollments.filter((e) => e.campaignId === id);
        if (es.length && es.every((e) => e.status === 'concluida' || e.status === 'interrompida')) {
          this.repo.update('campaigns', id, { status: 'finalizada', finishedAt: now.toISOString() });
        }
      }
    } finally {
      this.ticking = false;
    }
    return { processed };
  }

  private async runEnrollment(enrollmentId: string) {
    const e = this.db.enrollments.find((x) => x.id === enrollmentId)!;
    const lead = this.db.leads.find((l) => l.id === e.leadId);
    const cad = this.db.cadences.find((c) => c.id === e.cadenceId);
    const c = lead && this.companyOf(lead);
    if (!lead || !cad || !c) {
      this.repo.update('enrollments', e.id, { status: 'interrompida', stopReason: 'Lead ou cadência não existe mais.' });
      return;
    }
    const p = plan(cad, e.stepIndex, this.context(e, lead, c));
    // Limite diário da campanha: sem cota hoje, a etapa fica para a primeira janela de amanhã.
    const send = p.effects.find((x) => x.kind === 'send' || x.kind === 'manual_whatsapp');
    if (send && 'step' in send) {
      const camp = this.db.campaigns.find((x) => x.id === e.campaignId);
      if (camp && this.dailyQuotaLeft(camp, send.step.channel) <= 0) {
        this.repo.update('enrollments', e.id, { nextRunAt: nextDayWindow(this.svc.now(), this.svc.profile.sendWindow ?? DEFAULT_SEND_WINDOW).toISOString() });
        return;
      }
    }
    for (const eff of p.effects) await this.apply(eff, e, lead, c, cad);
    const at = this.nowIso();
    this.repo.update('enrollments', e.id, {
      stepIndex: p.stepIndex,
      status: p.status,
      nextRunAt: p.nextRunAt?.toISOString(),
      lastStepAt: at,
      stopReason: p.stopReason,
    });
    if (p.status === 'concluida') {
      this.svc.log(lead.id, 'cadence_completed', 'Cadência concluída sem resposta', { enrollmentId: e.id });
      const fresh = this.db.leads.find((l) => l.id === lead.id)!;
      if (fresh.stage === 'em_cadencia' || fresh.stage === 'contatado') this.svc.changeStage(lead.id, 'sem_resposta');
    } else if (p.status === 'interrompida' && p.stopReason) {
      this.svc.log(lead.id, 'cadence_stopped', `Cadência encerrada: ${p.stopReason}`, { enrollmentId: e.id });
    } else if (p.nextRunAt) {
      this.svc.log(lead.id, 'cadence_step', `Próxima etapa em ${p.nextRunAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, { enrollmentId: e.id, stepIndex: p.stepIndex });
    }
  }

  private async apply(eff: Effect, e: Enrollment, lead: Lead, c: Company, cad: Cadence) {
    const camp = this.db.campaigns.find((x) => x.id === e.campaignId);
    if (eff.kind === 'skipped') {
      this.svc.log(lead.id, 'cadence_step', `Etapa ${eff.stepIndex + 1} pulada: ${eff.reason}`, { enrollmentId: e.id });
      return;
    }
    if (eff.kind === 'task') {
      this.createTask({ leadId: lead.id, campaignId: e.campaignId, title: eff.title, source: 'cadencia', ownerName: camp?.ownerName });
      return;
    }
    if (eff.kind === 'stage') {
      this.svc.changeStage(lead.id, eff.stage as LeadStage);
      return;
    }
    // send ou manual_whatsapp: compõe a mensagem
    const firstSend = cad.steps.findIndex((s) => s.type === 'send');
    const draft = eff.stepIndex === firstSend && e.draft && e.draft.channel === eff.step.channel ? e.draft : await this.compose(lead, cad, eff.stepIndex, camp?.name);
    const at = this.nowIso();
    const p = this.svc.profile;
    const channel: SendChannel = eff.step.channel;
    const msg: Message = {
      id: uid('msg'),
      leadId: lead.id,
      channel,
      generatedContent: draft.body,
      finalContent: draft.body,
      status: 'queued',
      model: draft.model,
      promptVersion: this.svc.providers.ai.promptVersion,
      campaignId: e.campaignId,
      enrollmentId: e.id,
      stepIndex: eff.stepIndex,
      subject: draft.subject,
      sender: channel === 'email' ? p.senderEmail || p.email : undefined,
      recipient: channel === 'email' ? lead.email : c.whatsapp,
      template: draft.template,
      context: draft.context,
      createdAt: at,
      updatedAt: at,
    };

    if (eff.kind === 'manual_whatsapp') {
      const link = WhatsAppService.generateWhatsAppUrl(c.whatsapp!, draft.body);
      this.repo.batch(() => {
        this.repo.insert('messages', { ...msg, status: 'draft', template: `${draft.template} (envio manual)` });
        this.createTask({
          leadId: lead.id,
          campaignId: e.campaignId,
          title: `Enviar WhatsApp para ${c.tradeName ?? c.legalName}`,
          description: 'Mensagem pronta. Revise, abra o WhatsApp pelo link, envie e clique em “Marcar como enviado”.',
          source: 'cadencia',
          ownerName: camp?.ownerName,
          actionUrl: link ?? undefined,
        });
      });
      return;
    }

    this.repo.insert('messages', msg);
    const sender = channel === 'whatsapp' ? this.svc.providers.whatsappSender! : this.svc.providers.emailSender!;
    try {
      const r =
        channel === 'whatsapp'
          ? await this.svc.providers.whatsappSender!.send({ to: c.whatsapp!, text: draft.body, templateName: eff.step.whatsappTemplate })
          : await this.svc.providers.emailSender!.send({ from: msg.sender!, fromName: p.fullName || p.companyName, to: lead.email!, subject: draft.subject || `Contato — ${p.companyName}`, text: draft.body });
      const sentAt = this.nowIso();
      this.repo.batch(() => {
        this.repo.update('messages', msg.id, { status: 'sent', externalId: r.externalId, provider: r.provider, sentAt });
        this.repo.update('leads', lead.id, { lastContactAt: sentAt });
        this.svc.log(lead.id, 'message_sent', `${channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} enviado${camp ? ` (${camp.name})` : ''}`, { messageId: msg.id, channel, provider: sender.id });
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.repo.batch(() => {
        this.repo.update('messages', msg.id, { status: 'failed', failedAt: this.nowIso(), failureReason: reason });
        this.svc.log(lead.id, 'message_failed', `Falha no envio de ${channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'}: ${reason}`, { messageId: msg.id });
      });
    }
  }

  /** Simula os avisos de entrega e leitura que, no modo real, chegam pelos webhooks. */
  private advanceDeliveryStatus(now: Date) {
    for (const m of this.db.messages) {
      if (!m.sentAt || !m.provider?.startsWith('mock')) continue;
      const age = now.getTime() - new Date(m.sentAt).getTime();
      if (m.status === 'sent' && age >= 60_000) {
        this.repo.update('messages', m.id, { status: 'delivered', deliveredAt: new Date(new Date(m.sentAt).getTime() + 60_000).toISOString() });
      } else if (m.status === 'delivered' && m.channel === 'whatsapp' && age >= 2 * 3600_000) {
        this.repo.update('messages', m.id, { status: 'read', readAt: new Date(new Date(m.sentAt).getTime() + 2 * 3600_000).toISOString() });
      }
    }
  }

  /**
   * Modo de teste: avança o relógio simulado hora a hora, processando o que vence em cada hora,
   * como o executor do servidor faz a cada poucos minutos. Assim as esperas e a janela de envio
   * acontecem nos horários certos.
   */
  async advanceClock(ms: number) {
    const HOUR = 3600_000;
    let left = ms;
    while (left > 0) {
      const d = Math.min(HOUR, left);
      left -= d;
      this.repo.setClockOffset?.((this.db.clockOffsetMs ?? 0) + d);
      await this.tick();
    }
  }

  resetClock() {
    this.repo.setClockOffset?.(0);
  }

  // ---------- Respostas ----------

  /**
   * Registra uma resposta do lead, classifica com IA e age:
   * pausa/encerra a cadência, muda a etapa, cria tarefa e, se for opt-out, bloqueia o contato.
   */
  async receiveReply(leadId: string, channel: SendChannel, body: string, fromAddress?: string): Promise<InboundMessage> {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const c = lead && this.companyOf(lead);
    if (!lead || !c) throw new Error('Lead não encontrado.');
    const text = body.trim();
    if (!text) throw new Error('A resposta está vazia.');
    const cls = await this.svc.ai.classifyReply(text, `Empresa ${c.tradeName ?? c.legalName}, etapa atual: ${lead.stage}`);
    const name = c.tradeName ?? c.legalName;
    const active = this.db.enrollments.filter((e) => e.leadId === leadId && (e.status === 'ativa' || e.status === 'pausada'));
    const enr = active[0];
    const at = this.nowIso();
    const inbound: InboundMessage = {
      id: uid('in'),
      leadId,
      channel,
      fromAddress: fromAddress ?? (channel === 'email' ? lead.email ?? '' : c.whatsapp ?? ''),
      body: text,
      receivedAt: at,
      campaignId: enr?.campaignId,
      enrollmentId: enr?.id,
      classification: cls.classification,
      confidence: cls.confidence,
      summary: cls.summary,
    };
    const camp = enr && this.db.campaigns.find((x) => x.id === enr.campaignId);
    this.repo.batch(() => {
      this.repo.insert('inbound', inbound);
      const contacted = (m: Message) => m.sentAt ?? (m.status === 'opened_whatsapp' ? m.updatedAt : undefined);
      const last = this.db.messages
        .filter((m) => m.leadId === leadId && m.channel === channel && contacted(m))
        .sort((a, b) => contacted(b)!.localeCompare(contacted(a)!))[0];
      if (last) this.repo.update('messages', last.id, { status: 'replied', repliedAt: at });
      this.repo.update('leads', leadId, { lastContactAt: at, ...this.nextStepFrom(cls) });
      this.svc.log(leadId, 'reply_received', `Resposta registrada (${channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'})`, { inboundId: inbound.id, user: this.svc.profile.email });
      this.svc.log(leadId, 'reply_classified', `IA classificou como “${REPLY_CATEGORY_LABEL[cls.category]}”`, {
        inboundId: inbound.id,
        category: cls.category,
        classification: cls.classification,
        confidence: cls.confidence,
        summary: cls.summary,
        suggestedAction: cls.suggestedAction,
      });
      this.actOnReply(cls, lead, c, name, active, camp?.ownerName, camp?.id, channel);
    });
    await this.svc.rescore(leadId);
    // Sugestão de resposta para o usuário revisar. Falha aqui não afeta o registro da resposta.
    await this.suggestReply(leadId, channel, cls.category, camp?.id).catch(() => null);
    return inbound;
  }

  /**
   * A IA escreve a próxima resposta da conversa (objetivo: marcar uma conversa rápida).
   * Fica como mensagem "draft" no lead: nunca é enviada sem o clique do usuário.
   * Uma sugestão por vez: a anterior não enviada é substituída.
   */
  async suggestReply(leadId: string, channel: SendChannel, category?: string, campaignId?: string): Promise<Message | null> {
    if (category === 'sem_contato' || category === 'ausente') return null;
    const lead = this.db.leads.find((l) => l.id === leadId);
    const c = lead && this.companyOf(lead);
    if (!lead || !c || this.svc.suppressionFor(c, lead)) return null;
    const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const out = this.db.messages
      .filter((m) => m.leadId === leadId && m.channel === channel && (m.sentAt || m.status === 'opened_whatsapp'))
      .map((m) => ({ from: 'vendedor' as const, at: m.sentAt ?? m.updatedAt, text: m.finalContent.slice(0, 800) }));
    const ins = this.db.inbound.filter((r) => r.leadId === leadId && r.channel === channel).map((r) => ({ from: 'lead' as const, at: r.receivedAt, text: r.body.slice(0, 800) }));
    const conv = [...out, ...ins].sort((a, b) => a.at.localeCompare(b.at)).slice(-12);
    if (!conv.length || conv[conv.length - 1].from !== 'lead') return null;
    const p = this.svc.profile;
    const assistant = await loadAssistant()
      .then((r) => r.settings)
      .catch(() => DEFAULT_ASSISTANT);
    const s = await this.svc.ai.suggestReply({
      assistant,
      channel,
      category,
      sender: { name: p.fullName, company: p.companyName, offer: p.offer },
      contact: { name: lead.contactName, role: lead.contactRole },
      company: c,
      conversation: conv.map((m) => ({ from: m.from, date: when(m.at), text: m.text })),
    });
    const body = s.message?.trim();
    if (!body) return null;
    const at = this.nowIso();
    const msg: Message = {
      id: uid('msg'),
      leadId,
      channel,
      generatedContent: body,
      finalContent: body,
      status: 'draft',
      model: this.svc.ai.model,
      promptVersion: this.svc.providers.ai.promptVersion,
      template: `IA — resposta sugerida (${s.intent})`,
      context: leadContext(c, lead),
      campaignId,
      createdAt: at,
      updatedAt: at,
    };
    const old = this.db.messages.filter((m) => m.leadId === leadId && m.channel === channel && m.status === 'draft' && m.template?.startsWith('IA — resposta sugerida'));
    this.repo.batch(() => {
      old.forEach((m) => this.repo.remove('messages', m.id));
      this.repo.insert('messages', msg);
      this.svc.log(leadId, 'message_generated', 'IA sugeriu uma resposta para você revisar', { messageId: msg.id, kind: 'reply_suggestion', note: s.note, intent: s.intent });
    });
    return msg;
  }

  /** Próxima ação sugerida pela IA vira a "próxima ação" do lead; "falar depois" agenda a data. */
  private nextStepFrom(a: ReplyAnalysis): Partial<Lead> {
    if (a.category === 'ausente') return {};
    if (a.category === 'sem_contato' || a.category === 'nao_interessado') return { nextAction: a.suggestedAction, nextActionAt: undefined };
    const at = a.category === 'posteriormente' ? new Date(this.svc.now().getTime() + (a.followUpDays ?? 30) * 864e5).toISOString() : this.nowIso();
    return { nextAction: a.suggestedAction, nextActionAt: at };
  }

  /** Envios de hoje (hora de Brasília) da campanha neste canal. WhatsApp conta as mensagens preparadas na fila. */
  sentToday(campaignId: string, channel: SendChannel): number {
    const start = startOfDayBRT(this.svc.now()).toISOString();
    return this.db.messages.filter((m) => m.campaignId === campaignId && m.channel === channel && m.createdAt >= start).length;
  }

  /** Quanto ainda pode ser enviado hoje (Infinity quando não há limite). */
  dailyQuotaLeft(camp: Campaign, channel: SendChannel): number {
    const limit = channel === 'email' ? camp.dailyLimitEmail : camp.dailyLimitWhatsapp;
    return limit ? Math.max(0, limit - this.sentToday(camp.id, channel)) : Infinity;
  }

  /**
   * Entrada automática: leads novos (de uma busca) que se encaixam no público de campanhas ativas
   * com "entrada automática" entram na cadência na hora. Cada lead entra em uma campanha só.
   */
  autoEnrollNewLeads(leadIds: string[]): { campaign: string; count: number }[] {
    if (!leadIds.length) return [];
    const wanted = new Set(leadIds);
    const out: { campaign: string; count: number }[] = [];
    const camps = this.db.campaigns.filter((c) => c.autoEnroll && c.status === 'ativa');
    this.repo.batch(() => {
      for (const camp of camps) {
        const cad = this.db.cadences.find((c) => c.id === camp.cadenceId);
        if (!cad) continue;
        const leads = this.audienceLeads(camp.audience).filter((l) => wanted.has(l.id));
        const at = this.nowIso();
        for (const lead of leads) {
          this.repo.insert('enrollments', { id: uid('enr'), campaignId: camp.id, cadenceId: cad.id, leadId: lead.id, stepIndex: 0, status: 'ativa', nextRunAt: at, startedAt: at, createdAt: at, updatedAt: at });
          this.svc.log(lead.id, 'campaign_enrolled', `Entrou automaticamente na campanha “${camp.name}” (score ${lead.currentScore})`, { campaignId: camp.id, auto: true });
          if (lead.stage === 'novo' || lead.stage === 'qualificado') this.svc.changeStage(lead.id, 'em_cadencia');
          wanted.delete(lead.id);
        }
        if (leads.length) out.push({ campaign: camp.name, count: leads.length });
      }
    });
    return out;
  }

  /** Para a automação do lead (ex.: virou cliente ou não interessado). */
  cancelForLead(leadId: string, reason: string) {
    this.db.enrollments
      .filter((e) => e.leadId === leadId && (e.status === 'ativa' || e.status === 'pausada' || e.status === 'pendente'))
      .forEach((e) => this.setEnrollment(e, 'interrompida', reason));
  }

  private actOnReply(cls: ReplyAnalysis, lead: Lead, c: Company, name: string, active: Enrollment[], owner?: string, campaignId?: string, channel?: SendChannel) {
    const d = replyDecision(cls.category, name);
    const today = this.svc.now();
    if (d.suppress) {
      const values: [('phone' | 'email'), string][] = [];
      if (c.whatsapp) values.push(['phone', c.whatsapp]);
      if (c.phone) values.push(['phone', c.phone]);
      if (lead.email && channel === 'email') values.push(['email', lead.email]);
      for (const [k, v] of values) {
        const exists = this.db.suppression.some((s) => s.kind === k && (k === 'email' ? s.value === v.toLowerCase() : digits(s.value) === digits(v)));
        if (!exists) this.svc.addSuppression(k, v, `Pediu para não receber mensagens (${today.toLocaleDateString('pt-BR')})`);
      }
    }
    if (d.enrollments === 'stop') active.forEach((e) => this.setEnrollment(e, 'interrompida', d.reason!));
    if (d.enrollments === 'pause') active.filter((e) => e.status === 'ativa').forEach((e) => this.setEnrollment(e, 'pausada', d.reason!));
    if (d.stage && lead.stage !== d.stage.to && (d.stage.force || !ADVANCED_STAGES.includes(lead.stage))) this.svc.changeStage(lead.id, d.stage.to);
    if (d.task) {
      this.createTask({ leadId: lead.id, campaignId, title: d.task.title, description: d.task.description, source: 'resposta', ownerName: owner ?? lead.ownerName, dueAt: today.toISOString() });
    }
  }

  // ---------- Tarefas ----------

  createTask(input: Omit<Task, 'id' | 'status' | 'createdAt'>): Task {
    const t = this.repo.insert('tasks', { ...input, id: uid('task'), status: 'aberta', createdAt: this.nowIso() });
    if (t.leadId) this.svc.log(t.leadId, 'task_created', `Tarefa criada: ${t.title}${t.ownerName ? ` (para ${t.ownerName})` : ''}`, { taskId: t.id });
    return t;
  }

  completeTask(taskId: string, done = true) {
    const t = this.db.tasks.find((x) => x.id === taskId);
    if (!t) return;
    this.repo.update('tasks', taskId, { status: done ? 'concluida' : 'aberta', doneAt: done ? this.nowIso() : undefined });
    if (t.leadId && done) this.svc.log(t.leadId, 'task_done', `Tarefa concluída: ${t.title}`, { taskId });
  }

  // ---------- Métricas ----------

  campaignMetrics(campaignId?: string) {
    const msgs = this.db.messages.filter((m) => m.campaignId && (!campaignId || m.campaignId === campaignId));
    const ens = this.db.enrollments.filter((e) => !campaignId || e.campaignId === campaignId);
    const ins = this.db.inbound.filter((r) => r.campaignId && (!campaignId || r.campaignId === campaignId) && r.classification !== 'ausente');
    const sent = msgs.filter((m) => m.sentAt);
    const repliedLeads = new Set(ins.map((r) => r.leadId));
    return {
      leads: ens.length,
      active: ens.filter((e) => e.status === 'ativa').length,
      sent: sent.length,
      delivered: sent.filter((m) => ['delivered', 'read', 'replied'].includes(m.status)).length,
      read: sent.filter((m) => ['read', 'replied'].includes(m.status)).length,
      failed: msgs.filter((m) => m.status === 'failed').length,
      manual: msgs.filter((m) => m.status === 'draft' && !m.template?.startsWith('IA — resposta sugerida')).length,
      replies: repliedLeads.size,
      interested: new Set(ins.filter((r) => r.classification === 'interessado' || r.classification === 'reuniao').map((r) => r.leadId)).size,
      meetings: new Set(ins.filter((r) => r.classification === 'reuniao').map((r) => r.leadId)).size,
      optOuts: new Set(ins.filter((r) => r.classification === 'opt_out').map((r) => r.leadId)).size,
      replyRate: ens.length ? Math.round((repliedLeads.size / Math.max(1, new Set(sent.map((m) => m.leadId)).size)) * 100) : 0,
    };
  }

  resultsSnapshot(): ResultsSnapshot {
    const m = this.campaignMetrics();
    const db = this.db;
    const sent = db.messages.filter((x) => x.campaignId && x.sentAt);
    const ins = db.inbound.filter((r) => r.classification !== 'ausente');
    const segOf = (leadId: string) => {
      const l = db.leads.find((x) => x.id === leadId);
      return db.companies.find((c) => c.id === l?.companyId)?.segment ?? '—';
    };
    const seg = new Map<string, { sent: Set<string>; replies: Set<string> }>();
    for (const s of sent) {
      const k = segOf(s.leadId);
      if (!seg.has(k)) seg.set(k, { sent: new Set(), replies: new Set() });
      seg.get(k)!.sent.add(s.leadId);
    }
    for (const r of ins) seg.get(segOf(r.leadId))?.replies.add(r.leadId);
    const ch = (channel: SendChannel) => ({
      channel: channel === 'whatsapp' ? 'WhatsApp' : 'E-mail',
      sent: sent.filter((s) => s.channel === channel).length,
      replies: ins.filter((r) => r.channel === channel).length,
    });
    return {
      leads: db.leads.length,
      inCadence: db.enrollments.filter((e) => e.status === 'ativa').length,
      sent: m.sent,
      delivered: m.delivered,
      read: m.read,
      replies: m.replies,
      interested: m.interested,
      meetings: m.meetings,
      optOuts: m.optOuts,
      failed: m.failed,
      openTasks: db.tasks.filter((t) => t.status === 'aberta').length,
      bySegment: [...seg.entries()].map(([segment, v]) => ({ segment, sent: v.sent.size, replies: v.replies.size })),
      byChannel: [ch('whatsapp'), ch('email')],
      campaigns: db.campaigns.map((c) => {
        const cm = this.campaignMetrics(c.id);
        return { name: c.name, status: c.status, sent: cm.sent, replies: cm.replies };
      }),
    };
  }
}

export const CAMPAIGN_STATUS_LABEL: Record<Campaign['status'], string> = {
  rascunho: 'Rascunho',
  agendada: 'Agendada',
  ativa: 'Ativa',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
};

export const ENROLLMENT_STATUS_LABEL: Record<Enrollment['status'], string> = {
  pendente: 'Aguardando ativação',
  ativa: 'Em andamento',
  pausada: 'Pausada',
  concluida: 'Concluída',
  interrompida: 'Encerrada',
};

