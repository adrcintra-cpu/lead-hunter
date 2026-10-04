import { AIService } from '@/core/ai/aiService';
import type { ProviderSet } from '@/core/providers/types';
import { unsupportedCriteria } from '@/core/providers/types';
import { MOCK_SUPPRESSED_PHONE } from '@/core/providers/mock/mockCompanies';
import { applyCompanyData, mergeInto, toCompany } from '@/core/scoring';
import { formatCnpj, isValidCnpj } from '@/core/cnpj';
import {
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

  constructor(
    readonly repo: Repository,
    readonly providers: ProviderSet,
  ) {
    this.ai = new AIService(providers.ai, (run) =>
      this.repo.insert('aiRuns', { id: uid('ai'), createdAt: nowIso(), ...run }),
    );
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

  updateProfile(patch: Partial<Profile>) {
    this.repo.setProfile({ ...this.profile, ...patch, updatedAt: nowIso() });
  }

  // ---------- Auditoria ----------

  private log(leadId: string, type: ActivityType, description: string, payload: Record<string, unknown> = {}) {
    const at = nowIso();
    this.repo.insert('activities', { id: uid('act'), leadId, type, description, payload, createdAt: at });
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (lead) this.repo.update('leads', leadId, { lastActivityAt: at });
  }

  // ---------- Busca ----------

  async parseQuery(text: string): Promise<ParseResult> {
    const parsed = await this.ai.parseSearchQuery(text);
    return { ...parsed, unsupported: unsupportedCriteria(parsed.criteria, this.providers) };
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

  async rescore(leadId: string) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!lead || !company) return;
    const score = await this.ai.scoreLead(company, this.profile, leadId);
    this.repo.batch(() => {
      this.repo.insert('leadScores', score);
      this.repo.update('leads', leadId, { currentScore: score.score, scoreTier: score.tier });
      this.log(leadId, 'scored', `Score recalculado: ${score.score}/100`, { score: score.score });
    });
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

  suppressionFor(company: Company) {
    const values = [company.phone, company.whatsapp].filter(Boolean).map((v) => digits(v!));
    if (company.cnpj) values.push(digits(company.cnpj));
    return this.db.suppression.find((s) => values.includes(digits(s.value)) || values.includes(s.value));
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
    if (this.suppressionFor(company)) throw new Error('Contato na lista de supressão: abordagem bloqueada.');
    const p = this.profile;
    const text = await this.ai.generateApproach(company, channel, {
      variant,
      senderName: p.fullName,
      senderCompany: p.companyName,
      offer: p.offer,
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
      createdAt: at,
      updatedAt: at,
    };
    this.repo.batch(() => {
      this.repo.insert('messages', msg);
      this.log(leadId, 'message_generated', `Abordagem gerada (${channelLabel(channel)})`, { messageId: msg.id, channel });
      if (lead.stage === 'novo' || lead.stage === 'qualificado') this.changeStage(leadId, 'contato_preparado');
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
    const m = this.db.messages.find((x) => x.id === messageId);
    const lead = m && this.db.leads.find((l) => l.id === m.leadId);
    const company = lead && this.db.companies.find((c) => c.id === lead.companyId);
    if (!m || !lead || !company?.whatsapp || this.suppressionFor(company)) return null;
    return this.providers.whatsapp.buildLink(company.whatsapp, text ?? m.finalContent);
  }

  markWhatsappOpened(messageId: string) {
    const m = this.db.messages.find((x) => x.id === messageId);
    const lead = m && this.db.leads.find((l) => l.id === m.leadId);
    if (!m || !lead) return;
    this.repo.batch(() => {
      this.repo.update('messages', messageId, { status: 'opened_whatsapp' });
      this.log(lead.id, 'whatsapp_opened', 'Conversa aberta no WhatsApp (wa.me)', { messageId });
      const order: LeadStage[] = ['novo', 'qualificado', 'contato_preparado'];
      if (order.includes(lead.stage)) this.changeStage(lead.id, 'contatado');
    });
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
  }

  resetAll() {
    this.repo.reset();
  }
}

export const channelLabel = (c: Channel) => (c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'E-mail' : 'LinkedIn');
