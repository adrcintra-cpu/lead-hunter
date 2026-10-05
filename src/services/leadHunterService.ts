import { AIService } from '@/core/ai/aiService';
import type { ProviderSet } from '@/core/providers/types';
import { unsupportedCriteria } from '@/core/providers/types';
import { MOCK_SUPPRESSED_PHONE } from '@/core/providers/mock/mockCompanies';
import { applyCompanyData, mergeInto, toCompany } from '@/core/scoring';
import { formatCnpj, isValidCnpj } from '@/core/cnpj';
import type { Engagement, ScoreExtras } from '@/core/scoring';
import { DEFAULT_CADENCE } from '@/services/automation/defaultCadence';
import { AutomationService } from '@/services/automation/automationService';
import { WhatsAppService } from '@/services/whatsapp/whatsAppService';
import {
  CLOSED_STAGES,
  stageLabel,
  type ActivityType,
  type Channel,
  type Company,
  type CriteriaField,
  type Lead,
  type LeadScore,
  type LeadStage,
  type Message,
  type ParsedCriteria,
  type Profile,
  type RawCompany,
  type SearchCriteria,
  type Search,
} from '@/core/types';
import { digits, normalize, normalizeDomain, nowIso, uid } from '@/core/utils';
import type { Repository } from './db/schema';

export type SearchStep = 'providers' | 'enrich' | 'dedupe' | 'score' | 'done';

export interface ParseResult extends ParsedCriteria {
  unsupported: CriteriaField[];
}

/** Todas as chaves que identificam a mesma empresa. */
function identityKeys(c: Pick<RawCompany, 'cnpj' | 'website' | 'phone' | 'city'>): string[] {
  const keys: string[] = [];
  if (c.cnpj) keys.push(`cnpj:${digits(c.cnpj)}`);
  if (c.website) keys.push(`web:${normalizeDomain(c.website)}`);
  if (c.phone) keys.push(`tel:${digits(c.phone)}:${normalize(c.city)}`);
  return keys;
}

/**
 * Regras de negócio do Lead Hunter. Fala com o repositório e com os providers;
 * a interface só chama métodos daqui.
 */
export class LeadHunterService {
  readonly ai: AIService;
  /** Campanhas, cadências, envios, respostas e tarefas. */
  readonly automation: AutomationService;
  /** WhatsApp sem API (wa.me): preparar, abrir, marcar como enviado. */
  readonly whatsapp: WhatsAppService;

  constructor(
    readonly repo: Repository,
    readonly providers: ProviderSet,
  ) {
    this.ai = new AIService(providers.ai, (run) =>
      this.repo.insert('aiRuns', { id: uid('ai'), createdAt: nowIso(), ...run }),
    );
    this.automation = new AutomationService(this);
    this.whatsapp = new WhatsAppService(this);
  }

  get db() {
    return this.repo.snapshot();
  }

  get profile(): Profile {
    const p = this.db.profile;
    if (!p) throw new Error('Perfil não carregado.');
    return p;
  }

  // ---------- Perfil ----------

  /** Cria o perfil se ainda não existir. Exemplos (ICP e opt-out fictícios) só no modo mock. */
  ensureProfile(user: { id: string; email: string; name?: string }, opts: { seedExamples?: boolean } = { seedExamples: true }) {
    if (this.db.profile?.id === user.id) return;
    const seed = opts.seedExamples !== false;
    const at = nowIso();
    this.repo.batch(() => {
      this.repo.setProfile({
        id: user.id,
        email: user.email,
        fullName: user.name ?? '',
        companyName: '',
        offer: '',
        icpSegments: seed ? ['Máquinas agrícolas', 'Agronegócio', 'Indústria'] : [],
        icpRegions: seed ? ['Campinas', 'Limeira', 'Piracicaba', 'Americana'] : [],
        createdAt: at,
        updatedAt: at,
      });
      if (seed && this.db.suppression.length === 0) {
        this.repo.insert('suppression', {
          id: uid('sup'),
          kind: 'phone',
          value: digits(MOCK_SUPPRESSED_PHONE),
          reason: 'Pediu para não ser contatada (exemplo do mock)',
          createdAt: at,
        });
      }
    });
  }

  /** Garante que exista ao menos uma cadência (a do exemplo da especificação), como ponto de partida. */
  ensureDefaultCadence() {
    if (this.db.cadences.length > 0) return;
    const at = nowIso();
    this.repo.insert('cadences', { ...DEFAULT_CADENCE(), id: uid('cad'), createdAt: at, updatedAt: at });
  }

  updateProfile(patch: Partial<Profile>) {
    this.repo.setProfile({ ...this.profile, ...patch, updatedAt: nowIso() });
  }

  // ---------- Auditoria ----------

  /** Hora atual do sistema. No modo de teste inclui o relógio simulado. */
  now(): Date {
    return new Date(Date.now() + (this.db.clockOffsetMs ?? 0));
  }

  /** Registra uma atividade na linha do tempo do lead (auditoria). */
  log(leadId: string, type: ActivityType, description: string, payload: Record<string, unknown> = {}) {
    const at = this.now().toISOString();
    this.repo.insert('activities', { id: uid('act'), leadId, type, description, payload, createdAt: at });
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (lead) this.repo.update('leads', leadId, { lastActivityAt: at });
  }

  // ---------- Busca ----------

  async parseQuery(text: string): Promise<ParseResult> {
    const parsed = await this.ai.parseSearchQuery(text);
    return { ...parsed, unsupported: unsupportedCriteria(parsed.criteria, this.providers) };
  }

  /** Resultado da entrada automática da última busca (para a interface avisar). */
  lastAutoEnroll: { campaign: string; count: number }[] = [];

  /** Liga/desliga a execução automática de uma busca salva. A primeira execução acontece na próxima verificação. */
  setSavedSearchSchedule(id: string, schedule: 'off' | 'diaria' | 'semanal') {
    this.repo.update('savedSearches', id, { schedule, nextRunAt: schedule === 'off' ? undefined : this.now().toISOString() });
  }

  private runningSaved = false;

  /**
   * Roda as buscas salvas agendadas que venceram. Só empresas novas viram leads (a deduplicação
   * descarta as que já existem) e elas entram nas campanhas com entrada automática.
   * Chamado ao abrir o app e periodicamente enquanto ele está aberto.
   */
  async runDueSavedSearches(): Promise<{ name: string; news: number; enrolled: number }[]> {
    if (this.runningSaved || !this.db.profile) return [];
    this.runningSaved = true;
    const out: { name: string; news: number; enrolled: number }[] = [];
    try {
      const now = this.now();
      const due = this.db.savedSearches.filter((s) => s.schedule && s.schedule !== 'off' && (!s.nextRunAt || new Date(s.nextRunAt) <= now));
      for (const s of due) {
        // Marca a próxima execução antes de rodar: evita rodar duas vezes (outra aba, outro aparelho).
        const next = new Date(now.getTime() + (s.schedule === 'semanal' ? 7 : 1) * 864e5);
        this.repo.update('savedSearches', s.id, { nextRunAt: next.toISOString() });
        try {
          const search = await this.runSearch(s.rawQuery, s.criteria, s.criteria, () => {}, s.id);
          out.push({ name: s.name, news: search.newCount, enrolled: this.lastAutoEnroll.reduce((n, x) => n + x.count, 0) });
        } catch {
          /* falha registrada na própria busca (status "erro"); tenta de novo na próxima data */
        }
      }
    } finally {
      this.runningSaved = false;
    }
    return out;
  }

  /** Buscas rodam uma por vez: evita duas buscas simultâneas criarem a mesma empresa. */
  private searchQueue: Promise<unknown> = Promise.resolve();

  runSearch(
    rawQuery: string,
    parsed: SearchCriteria,
    confirmed: SearchCriteria,
    onStep: (s: SearchStep) => void = () => {},
    savedSearchId?: string,
  ): Promise<Search> {
    const run = this.searchQueue.then(() => this.executeSearch(rawQuery, parsed, confirmed, onStep, savedSearchId));
    this.searchQueue = run.catch(() => undefined);
    return run;
  }

  private async executeSearch(
    rawQuery: string,
    parsed: SearchCriteria,
    confirmed: SearchCriteria,
    onStep: (s: SearchStep) => void,
    savedSearchId?: string,
  ): Promise<Search> {
    const at = nowIso();
    const ignored = unsupportedCriteria(confirmed, this.providers);
    const search = this.repo.insert('searches', {
      id: uid('srch'),
      rawQuery,
      parsedCriteria: parsed,
      confirmedCriteria: confirmed,
      status: 'running',
      providersUsed: this.providers.companySearch.map((p) => p.id),
      ignoredCriteria: ignored,
      resultCount: 0,
      newCount: 0,
      duplicatesRemoved: 0,
      savedSearchId,
      createdAt: at,
      updatedAt: at,
    });

    try {
      onStep('providers');
      const batches = await Promise.all(this.providers.companySearch.map((p) => p.search(confirmed)));
      let raws = batches.flat();

      onStep('enrich');
      // Dados oficiais de CNPJ, quando a fonte de busca já trouxe o número. Falha aqui não derruba a busca.
      const cd = this.providers.companyData;
      const extras = new Map<RawCompany, Partial<RawCompany>>();
      if (cd) {
        await Promise.all(
          raws.map(async (r) => {
            if (!r.cnpj) return;
            try {
              const extra = await cd.enrichByCnpj(r.cnpj);
              if (extra) extras.set(r, extra);
            } catch {
              /* segue sem o enriquecimento */
            }
          }),
        );
      }
      if (confirmed.minEmployees && cd?.capabilities.includes('employees')) {
        // Remove só quem tem porte conhecido abaixo do mínimo; desconhecidos ficam.
        raws = raws.filter((r) => {
          const min = extras.get(r)?.employeesMin ?? r.employeesMin;
          return min == null || min >= confirmed.minEmployees!;
        });
      }

      onStep('dedupe');
      // 1) Duplicados dentro da própria busca (qualquer chave em comum).
      const groups: RawCompany[][] = [];
      for (const r of raws) {
        const keys = identityKeys(r);
        const g = groups.find((grp) => grp.some((x) => identityKeys(x).some((k) => keys.includes(k))));
        if (g) g.push(r);
        else groups.push([r]);
      }
      const duplicates = raws.length - groups.length;

      // 2) Empresas que o usuário já tem.
      const existingByKey = new Map<string, Company>();
      for (const c of this.db.companies) for (const k of identityKeys(c)) existingByKey.set(k, c);

      type Candidate = { company: Company; isNew: boolean; provider: string; raws: RawCompany[] };
      const candidates: Candidate[] = groups.map((grp) => {
        const [first, ...rest] = grp;
        const existing = grp.flatMap((r) => identityKeys(r)).map((k) => existingByKey.get(k)).find(Boolean);
        let company = existing ? grp.reduce((acc, r) => mergeInto(acc, r), existing) : rest.reduce((acc, r) => mergeInto(acc, r), toCompany(first));
        for (const r of grp) {
          const extra = extras.get(r);
          if (extra && cd) company = applyCompanyData(company, extra, cd.id);
        }
        return { company, isNew: !existing, provider: first.provider, raws: grp };
      });

      const sourceRows = (cand: Candidate) =>
        cand.raws.map((r) => ({
          id: uid('src'),
          companyId: cand.company.id,
          searchId: search.id,
          provider: r.provider,
          externalId: r.externalId,
          fetchedAt: nowIso(),
          expiresAt: r.expiresAt,
        }));

      onStep('score');
      const profile = this.profile;
      // Score em paralelo (até 5 por vez): com a Claude real, cada lead é uma chamada.
      const fresh = candidates.filter((c) => c.isNew);
      const scores = new Map<Candidate, LeadScore>();
      const leadIds = new Map<Candidate, string>(fresh.map((c) => [c, uid('lead')]));
      for (let i = 0; i < fresh.length; i += 5) {
        await Promise.all(
          fresh.slice(i, i + 5).map(async (c) => scores.set(c, await this.ai.scoreLead(c.company, profile, leadIds.get(c)!))),
        );
      }

      const results: { company: Company; lead: Lead; isNew: boolean; provider: string }[] = [];
      for (const cand of candidates) {
        if (cand.isNew) {
          const score = scores.get(cand)!;
          const lead: Lead = {
            id: leadIds.get(cand)!,
            companyId: cand.company.id,
            stage: 'novo',
            currentScore: score.score,
            scoreTier: score.tier,
            firstSearchId: search.id,
            origin: this.providerLabel(cand.provider),
            discoveredAt: nowIso(),
            lastActivityAt: nowIso(),
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          this.repo.batch(() => {
            this.repo.insert('companies', cand.company);
            sourceRows(cand).forEach((row) => this.repo.insert('leadSources', row));
            this.repo.insert('leads', lead);
            this.repo.insert('leadScores', score);
            this.log(lead.id, 'discovered', `Encontrada pela busca “${rawQuery}”`, { searchId: search.id, provider: cand.provider });
            this.log(lead.id, 'scored', `Score calculado: ${score.score}/100`, { score: score.score, ruleScore: score.ruleScore, aiAdjustment: score.aiAdjustment });
          });
          results.push({ company: cand.company, lead, isNew: true, provider: cand.provider });
        } else {
          this.repo.batch(() => {
            this.repo.update('companies', cand.company.id, cand.company);
            sourceRows(cand).forEach((row) => this.repo.insert('leadSources', row));
          });
          const lead = this.db.leads.find((l) => l.companyId === cand.company.id);
          if (lead) results.push({ company: cand.company, lead, isNew: false, provider: cand.provider });
        }
      }

      const wa = confirmed.whatsapp === 'preferencial';
      results.sort((a, b) => {
        if (wa) {
          const wa1 = a.company.whatsappStatus !== 'desconhecido' ? 1 : 0;
          const wa2 = b.company.whatsappStatus !== 'desconhecido' ? 1 : 0;
          if (wa1 !== wa2) return wa2 - wa1;
        }
        return b.lead.currentScore - a.lead.currentScore;
      });
      const limited = results.slice(0, confirmed.quantity);

      this.repo.batch(() => {
        limited.forEach((r, i) =>
          this.repo.insert('searchResults', {
            id: uid('res'),
            searchId: search.id,
            companyId: r.company.id,
            leadId: r.lead.id,
            rank: i + 1,
            provider: r.provider,
            wasDuplicate: !r.isNew,
          }),
        );
        this.repo.update('searches', search.id, {
          status: 'done',
          resultCount: limited.length,
          newCount: limited.filter((r) => r.isNew).length,
          duplicatesRemoved: duplicates,
        });
        if (savedSearchId) this.repo.update('savedSearches', savedSearchId, { lastRunAt: nowIso() });
      });
      // Empresas novas entram sozinhas nas campanhas ativas com "entrada automática".
      this.lastAutoEnroll = this.automation.autoEnrollNewLeads(limited.filter((r) => r.isNew).map((r) => r.lead.id));
      onStep('done');
      return this.db.searches.find((s) => s.id === search.id)!;
    } catch (err) {
      this.repo.update('searches', search.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  providerLabel(id: string): string {
    const all = [...this.providers.companySearch, this.providers.companyData, this.providers.places].filter(Boolean) as { id: string; label: string }[];
    return all.find((p) => p.id === id)?.label ?? id;
  }

  saveSearch(name: string, rawQuery: string, criteria: SearchCriteria) {
    const at = nowIso();
    return this.repo.insert('savedSearches', { id: uid('ss'), name, rawQuery, criteria, createdAt: at, updatedAt: at });
  }

  deleteSavedSearch(id: string) {
    this.repo.remove('savedSearches', id);
  }

  // ---------- Leads ----------

  changeStage(leadId: string, stage: LeadStage) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    this.repo.batch(() => {
      this.repo.update('leads', leadId, { stage });
      this.log(leadId, 'stage_changed', `Etapa: ${stageLabel(lead.stage)} → ${stageLabel(stage)}`, { from: lead.stage, to: stage });
      // Cliente ou não interessado: cancela os próximos contatos automáticos deste lead.
      if (CLOSED_STAGES.includes(stage)) this.automation.cancelForLead(leadId, `lead marcado como ${stageLabel(stage)}`);
    });
  }

  async ensureAnalysis(leadId: string, force = false) {
    const existing = this.db.analyses.find((a) => a.leadId === leadId);
    if (existing && !force) return existing;
    const lead = this.db.leads.find((l) => l.id === leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!lead || !company) throw new Error('Lead não encontrado.');
    const sections = await this.ai.analyzeCompany(company, this.profile);
    const row = { id: uid('an'), leadId, sections, model: this.ai.model, promptVersion: this.providers.ai.promptVersion, createdAt: nowIso() };
    this.repo.batch(() => {
      if (existing) this.repo.remove('analyses', existing.id);
      this.repo.insert('analyses', row);
      this.log(leadId, 'analyzed', 'Análise da IA gerada', { model: row.model });
    });
    return row;
  }

  /** Contato e engajamento do lead, usados no score. */
  scoreExtras(lead: Lead): ScoreExtras {
    const replies = this.db.inbound.filter((r) => r.leadId === lead.id && r.classification !== 'ausente');
    const has = (c: string) => replies.some((r) => r.classification === c);
    const engagement: Engagement =
      lead.stage === 'reuniao' || has('reuniao')
        ? 'reuniao'
        : lead.stage === 'interessado' || has('interessado')
          ? 'interessado'
          : lead.stage === 'nao_interessado' || has('nao_interessado') || has('opt_out')
            ? 'nao_interessado'
            : replies.length
              ? 'respondeu'
              : 'nenhum';
    return { contactName: lead.contactName, contactRole: lead.contactRole, email: lead.email, engagement };
  }

  /** Edita os dados de CRM do lead e registra o que mudou. */
  updateLead(leadId: string, patch: Partial<Pick<Lead, 'contactName' | 'contactRole' | 'email' | 'tags' | 'ownerName' | 'nextAction' | 'nextActionAt'>>) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const value = Array.isArray(v) ? v.map((t) => String(t).trim()).filter(Boolean) : typeof v === 'string' ? v.trim() || undefined : v;
      if (JSON.stringify(value) !== JSON.stringify((lead as unknown as Record<string, unknown>)[k])) clean[k] = value;
    }
    if (!Object.keys(clean).length) return;
    const LABELS: Record<string, string> = { contactName: 'contato', contactRole: 'cargo', email: 'e-mail', tags: 'tags', ownerName: 'responsável', nextAction: 'próxima ação', nextActionAt: 'data da próxima ação' };
    this.repo.batch(() => {
      this.repo.update('leads', leadId, clean as Partial<Lead>);
      this.log(leadId, 'lead_updated', `Dados atualizados: ${Object.keys(clean).map((k) => LABELS[k] ?? k).join(', ')}`, { fields: Object.keys(clean) });
    });
  }

  /** Registra (ou remove) o opt-in de WhatsApp, com a origem do consentimento. */
  setWhatsappConsent(leadId: string, source: string | null) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead) return;
    this.repo.batch(() => {
      if (source) {
        this.repo.update('leads', leadId, { whatsappConsentAt: this.now().toISOString(), whatsappConsentSource: source.trim() });
        this.log(leadId, 'consent_recorded', `Opt-in de WhatsApp registrado: ${source.trim()}`, { source });
      } else {
        this.repo.update('leads', leadId, { whatsappConsentAt: undefined, whatsappConsentSource: undefined });
        this.log(leadId, 'consent_recorded', 'Opt-in de WhatsApp removido', {});
      }
    });
  }

  async rescore(leadId: string) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!lead || !company) return;
    const score = await this.ai.scoreLead(company, this.profile, leadId, this.scoreExtras(lead));
    this.repo.batch(() => {
      this.repo.insert('leadScores', score);
      this.repo.update('leads', leadId, { currentScore: score.score, scoreTier: score.tier });
      this.log(leadId, 'scored', `Score recalculado: ${score.score}/100`, { score: score.score });
    });
  }

  /**
   * Modo Supabase: as respostas chegam pelos webhooks no servidor, que não roda o score do app.
   * Depois de recarregar, recalcula o score de quem respondeu desde o último cálculo (no máx. 5 por vez).
   */
  async rescoreAfterReplies() {
    const lastScore = new Map<string, string>();
    for (const sc of this.db.leadScores) if ((lastScore.get(sc.leadId) ?? '') < sc.createdAt) lastScore.set(sc.leadId, sc.createdAt);
    const pending = new Set<string>();
    for (const r of this.db.inbound) if (r.receivedAt > (lastScore.get(r.leadId) ?? '')) pending.add(r.leadId);
    for (const id of [...pending].slice(0, 5)) await this.rescore(id);
  }

  addNote(leadId: string, body: string) {
    const text = body.trim();
    if (!text) return;
    this.repo.batch(() => {
      this.repo.insert('notes', { id: uid('note'), leadId, body: text, createdAt: nowIso() });
      this.log(leadId, 'note_added', 'Nota adicionada');
    });
  }

  /**
   * Completa a empresa com os dados oficiais do CNPJ (BrasilAPI no modo real).
   * Devolve um aviso quando a cidade da Receita difere da cidade encontrada na busca.
   */
  async enrichCnpj(leadId: string, cnpjInput: string): Promise<{ warning?: string }> {
    const cnpj = formatCnpj(cnpjInput);
    if (!isValidCnpj(cnpj)) throw new Error('CNPJ inválido. Confira os 14 dígitos.');
    const lead = this.db.leads.find((l) => l.id === leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!lead || !company) throw new Error('Lead não encontrado.');
    const other = this.db.companies.find((c) => c.id !== company.id && c.cnpj && digits(c.cnpj) === digits(cnpj));
    if (other) throw new Error(`Esse CNPJ já está cadastrado em ${other.tradeName ?? other.legalName}.`);
    const cd = this.providers.companyData;
    if (!cd) throw new Error('Nenhuma fonte de CNPJ configurada.');
    const data = await cd.enrichByCnpj(cnpj);
    if (!data) throw new Error('CNPJ não encontrado na base da Receita.');
    const updated = applyCompanyData(company, { ...data, cnpj }, cd.id);
    const warning =
      data.city && normalize(data.city) !== normalize(company.city)
        ? `Atenção: na Receita este CNPJ é de ${data.city}/${data.state ?? ''}, e a empresa foi encontrada em ${company.city}/${company.state}. Confira se é a mesma.`
        : undefined;
    this.repo.batch(() => {
      this.repo.update('companies', company.id, updated);
      this.log(leadId, 'enriched', `Dados do CNPJ ${cnpj} incluídos (${this.providerLabel(cd.id)})`, { cnpj, provider: cd.id });
    });
    await this.rescore(leadId);
    return { warning };
  }

  // ---------- Opt-out ----------

  /** Opt-out que atinge a empresa ou o contato (telefone, WhatsApp, CNPJ ou e-mail). */
  suppressionFor(company: Company, lead?: Lead) {
    const values = [company.phone, company.whatsapp].filter(Boolean).map((v) => digits(v!)).filter(Boolean);
    if (company.cnpj) values.push(digits(company.cnpj));
    const email = (lead ?? this.db.leads.find((l) => l.companyId === company.id))?.email?.trim().toLowerCase();
    return this.db.suppression.find((s) => (s.kind === 'email' ? !!email && s.value === email : values.includes(digits(s.value))));
  }

  addSuppression(kind: 'phone' | 'email' | 'cnpj', value: string, reason: string) {
    const v = kind === 'email' ? value.trim().toLowerCase() : digits(value);
    if (!v) return;
    this.repo.insert('suppression', { id: uid('sup'), kind, value: v, reason: reason.trim() || 'Opt-out', createdAt: nowIso() });
  }

  removeSuppression(id: string) {
    this.repo.remove('suppression', id);
  }

  // ---------- Abordagem ----------

  async generateMessage(leadId: string, channel: Channel, variant: number): Promise<Message> {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!lead || !company) throw new Error('Lead não encontrado.');
    if (this.suppressionFor(company, lead)) throw new Error('Contato na lista de supressão: abordagem bloqueada.');
    const p = this.profile;
    const conv = this.conversationContext(leadId);
    const followUp = conv.history.length > 0;
    const text = await this.ai.generateApproach(company, channel, {
      variant,
      senderName: p.fullName,
      senderCompany: p.companyName,
      offer: p.offer,
      contactName: lead.contactName,
      contactRole: lead.contactRole,
      stage: followUp ? 'acompanhamento' : 'primeira',
      ...conv,
    });
    const at = nowIso();
    const msg: Message = {
      id: uid('msg'),
      leadId,
      channel,
      generatedContent: text,
      finalContent: text,
      status: 'draft',
      model: this.ai.model,
      promptVersion: this.providers.ai.promptVersion,
      template: followUp ? 'IA — follow-up (com histórico)' : 'IA — abordagem inicial',
      context: leadContext(company, lead),
      createdAt: at,
      updatedAt: at,
    };
    this.repo.batch(() => {
      this.repo.insert('messages', msg);
      this.log(leadId, 'message_generated', `${followUp ? 'Follow-up preparado' : 'Mensagem preparada'} (${channelLabel(channel)})`, { messageId: msg.id, channel, followUp });
      if (lead.stage === 'novo') this.changeStage(leadId, 'qualificado');
    });
    return msg;
  }

  editMessage(messageId: string, finalContent: string) {
    this.repo.update('messages', messageId, { finalContent });
  }

  markCopied(messageId: string) {
    const m = this.db.messages.find((x) => x.id === messageId);
    if (!m) return;
    this.repo.batch(() => {
      this.repo.update('messages', messageId, { status: m.status === 'opened_whatsapp' ? m.status : 'copied' });
      this.log(m.leadId, 'message_copied', `Mensagem copiada (${channelLabel(m.channel)})`, { messageId });
    });
  }

  /** Devolve o link wa.me. Nada é enviado automaticamente. */
  whatsappLink(messageId: string, text?: string): string | null {
    return this.whatsapp.linkFor(messageId, text);
  }

  markWhatsappOpened(messageId: string) {
    const m = this.db.messages.find((x) => x.id === messageId);
    const lead = m && this.db.leads.find((l) => l.id === m.leadId);
    if (!m || !lead) return;
    this.repo.batch(() => {
      this.whatsapp.registerOpen(messageId);
      this.repo.update('leads', lead.id, { lastContactAt: this.now().toISOString() });
      const order: LeadStage[] = ['novo', 'qualificado', 'em_cadencia'];
      if (order.includes(lead.stage)) this.changeStage(lead.id, 'contatado');
    });
  }

  /**
   * O usuário confirma que enviou a mensagem (WhatsApp, e-mail ou LinkedIn) pelo próprio app.
   * Registra "Enviado manualmente" com data e hora. Entregue/lido não são marcados: não dá para confirmar sem API.
   */
  /**
   * Registra o envio. Sem opções: o usuário confirma que enviou por fora (manual).
   * Com provider/externalId: o envio foi feito pelo sistema (ex.: WhatsApp conectado por QR code).
   */
  markSent(messageId: string, via?: { provider: string; externalId?: string; recipient?: string }) {
    const m = this.db.messages.find((x) => x.id === messageId);
    const lead = m && this.db.leads.find((l) => l.id === m.leadId);
    if (!m || !lead || m.status === 'sent' || m.status === 'replied') return;
    const at = this.now().toISOString();
    const auto = via?.provider === 'whatsapp_qr';
    this.repo.batch(() => {
      this.repo.update('messages', messageId, {
        status: 'sent',
        provider: via?.provider ?? m.provider ?? 'manual',
        ...(via?.externalId ? { externalId: via.externalId } : {}),
        ...(via?.recipient ? { recipient: via.recipient } : {}),
        sentAt: at,
        updatedAt: at,
      });
      this.repo.update('leads', lead.id, { lastContactAt: at });
      this.log(lead.id, 'message_sent', auto ? 'WhatsApp enviado pelo WhatsApp conectado' : `${channelLabel(m.channel)} marcado como enviado (manual)`, {
        messageId,
        channel: m.channel,
        status: auto ? 'Enviado pelo WhatsApp conectado' : 'Enviado manualmente',
        user: this.profile.email,
      });
      const order: LeadStage[] = ['novo', 'qualificado', 'em_cadencia'];
      if (order.includes(lead.stage)) this.changeStage(lead.id, 'contatado');
      // Tarefa de envio manual criada pela cadência: concluída junto.
      if (m.channel === 'whatsapp') {
        this.db.tasks
          .filter((t) => t.leadId === lead.id && t.status === 'aberta' && t.source === 'cadencia' && t.actionUrl?.startsWith('https://wa.me/'))
          .forEach((t) => this.automation.completeTask(t.id));
      }
    });
  }

  /** Agenda o próximo contato (usa a "próxima ação" que o lead já tem). */
  scheduleFollowUp(leadId: string, at: Date, channel?: Channel) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const when = at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    this.repo.batch(() => {
      this.repo.update('leads', leadId, { nextAction: `Follow-up${channel ? ` por ${channelLabel(channel)}` : ''}`, nextActionAt: at.toISOString() });
      this.log(leadId, 'lead_updated', `Follow-up agendado para ${when}`, { kind: 'followup_scheduled', at: at.toISOString(), channel, user: this.profile.email });
    });
  }

  /**
   * O que a IA precisa para escrever um follow-up que continua a conversa:
   * mensagens já enviadas, tempo desde o último contato e observações do usuário.
   */
  conversationContext(leadId: string) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const when = (m: Message) => m.sentAt ?? (m.status === 'opened_whatsapp' ? m.updatedAt : undefined);
    const history = this.db.messages
      .filter((m) => m.leadId === leadId && when(m))
      .sort((a, b) => when(a)!.localeCompare(when(b)!))
      .slice(-4)
      .map((m) => ({
        channel: channelLabel(m.channel),
        date: new Date(when(m)!).toLocaleDateString('pt-BR'),
        text: m.finalContent.length > 600 ? `${m.finalContent.slice(0, 600)}…` : m.finalContent,
      }));
    const last = lead?.lastContactAt;
    const daysSinceLastContact = last ? Math.max(0, Math.floor((this.now().getTime() - new Date(last).getTime()) / 864e5)) : undefined;
    const notes = this.db.notes
      .filter((n) => n.leadId === leadId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3)
      .map((n) => n.body);
    return { history, daysSinceLastContact, notes };
  }

  // ---------- Listas ----------

  createList(name: string, description?: string) {
    const at = nowIso();
    return this.repo.insert('lists', { id: uid('list'), name: name.trim(), description: description?.trim() || undefined, createdAt: at, updatedAt: at });
  }

  renameList(id: string, name: string, description?: string) {
    this.repo.update('lists', id, { name: name.trim(), description: description?.trim() || undefined });
  }

  deleteList(id: string) {
    this.repo.batch(() => {
      this.db.listMembers.filter((m) => m.listId === id).forEach((m) => this.repo.remove('listMembers', m.id));
      this.repo.remove('lists', id);
    });
  }

  addToList(leadId: string, listId: string) {
    const id = `${listId}:${leadId}`;
    if (this.db.listMembers.some((m) => m.id === id)) return;
    const list = this.db.lists.find((l) => l.id === listId);
    this.repo.batch(() => {
      this.repo.insert('listMembers', { id, listId, leadId, addedAt: nowIso() });
      this.log(leadId, 'list_added', `Adicionado à lista “${list?.name ?? ''}”`, { listId });
    });
  }

  removeFromList(leadId: string, listId: string) {
    const id = `${listId}:${leadId}`;
    const list = this.db.lists.find((l) => l.id === listId);
    this.repo.batch(() => {
      this.repo.remove('listMembers', id);
      this.log(leadId, 'list_removed', `Removido da lista “${list?.name ?? ''}”`, { listId });
    });
  }

  // ---------- Demonstração ----------

  async loadDemo(onProgress: (text: string) => void = () => {}) {
    const queries = [
      'Empresas de máquinas agrícolas na região de Campinas com site e WhatsApp',
      'Indústrias de Limeira com mais de 50 funcionários',
      'Clínicas odontológicas em Piracicaba com WhatsApp',
      'Empresas do agronegócio no interior de São Paulo',
      'Empresas de logística no interior de São Paulo',
    ];
    for (const q of queries) {
      onProgress(q);
      const parsed = await this.parseQuery(q);
      await this.runSearch(q, parsed.criteria, parsed.criteria);
    }
    const byName = (n: string) => {
      const c = this.db.companies.find((x) => (x.tradeName ?? x.legalName).startsWith(n));
      return c && this.db.leads.find((l) => l.companyId === c.id);
    };
    const agro = this.createList('Agro Campinas', 'Máquinas e agronegócio na região de Campinas');
    const ind = this.createList('Indústrias Limeira', 'Indústrias de médio porte');
    this.createList('Prospects Outubro', 'Alta oportunidade para abordar este mês');
    ['Agromaq', 'Campo Forte', 'Irrigar Sul'].forEach((n) => {
      const l = byName(n);
      if (l) this.addToList(l.id, agro.id);
    });
    ['Polímeros', 'Fundição', 'Metalúrgica'].forEach((n) => {
      const l = byName(n);
      if (l) this.addToList(l.id, ind.id);
    });
    const moves: [string, LeadStage][] = [['Agromaq', 'qualificado'], ['Irrigar Sul', 'contatado'], ['Plantare', 'reuniao'], ['Campo Forte', 'proposta'], ['Semear', 'respondeu'], ['Colheita Certa', 'cliente']];
    moves.forEach(([n, st]) => {
      const l = byName(n);
      if (l) this.changeStage(l.id, st);
    });
    const ag = this.db.searches.find((s) => s.rawQuery.startsWith('Empresas de máquinas'));
    if (ag?.confirmedCriteria) this.saveSearch('Agro Campinas', ag.rawQuery, ag.confirmedCriteria);

    // Contatos fictícios para testar o CRM e as cadências (dois com opt-in de WhatsApp).
    const owner = this.profile.fullName || 'Você';
    const contacts: [string, Partial<Lead>, string | null][] = [
      ['Agromaq', { contactName: 'Carlos Menezes', contactRole: 'Diretor comercial', email: 'carlos@agromaqvaleverde.com.br', tags: ['agro', 'prioridade'] }, 'Formulário do site (exemplo)'],
      ['Polímeros', { contactName: 'Juliana Prado', contactRole: 'Gerente de compras', email: 'compras@polimerosipe.com.br', tags: ['indústria'] }, null],
      ['Fundição', { contactName: 'Roberto Alves', contactRole: 'Sócio', email: 'roberto@fundicaoserraazul.com.br', tags: ['indústria'] }, null],
      ['Metalúrgica', { email: 'contato@metalurgicatambore.com.br', tags: ['indústria'] }, null],
      ['Sorriso', { contactName: 'Renata Lima', contactRole: 'Sócia', email: 'contato@sorrisopiracicabano.com.br', tags: ['saúde'] }, 'Pediu contato na feira (exemplo)'],
    ];
    for (const [n, patch, consent] of contacts) {
      const l = byName(n);
      if (!l) continue;
      this.updateLead(l.id, { ...patch, ownerName: owner });
      if (consent) this.setWhatsappConsent(l.id, consent);
      await this.rescore(l.id);
    }
    const cad = this.db.cadences[0];
    if (cad && !this.db.campaigns.length) {
      this.automation.createCampaign({
        name: 'Agro e indústria — outubro',
        objective: 'Agendar conversas com empresas de máquinas, agronegócio e indústria da região.',
        audience: { segments: ['Máquinas agrícolas', 'Agronegócio', 'Indústria'], cities: [], minScore: 50, stages: ['novo', 'qualificado'], tags: [] },
        channel: 'multicanal',
        cadenceId: cad.id,
        ownerName: owner,
      });
    }
  }

  resetAll() {
    this.repo.reset();
    this.ensureDefaultCadence();
  }
}

/** Campos reais do lead que a IA pode usar para personalizar ("contexto utilizado"). */
export function leadContext(c: Company, lead?: Lead) {
  const out: { field: string; label: string; value: string }[] = [];
  const add = (field: string, label: string, value?: string) => value && out.push({ field, label, value });
  add('empresa', 'Empresa', c.tradeName ?? c.legalName);
  add('nome', 'Nome do contato', lead?.contactName);
  add('cargo', 'Cargo', lead?.contactRole);
  add('segmento', 'Segmento', c.segment);
  add('cidade', 'Cidade', c.city && `${c.city}/${c.state}`);
  add('site', 'Site', c.website);
  return out;
}

export const channelLabel = (c: Channel) => (c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'E-mail' : 'LinkedIn');
