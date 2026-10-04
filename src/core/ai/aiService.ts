import type { AnalysisSections, Channel, Company, CompanyField, LeadScore, ParsedCriteria, Profile } from '../types';
import { nowIso, uid } from '../utils';
import type { AIProvider, ApproachOptions } from '../providers/types';
import { ruleScore, tierOf, type ScoreExtras } from '../scoring';
import { classifyReplyRules } from '../../../supabase/functions/_shared/automation/replies.ts';
import type { ReplyClass } from '../types';
import type { ResultsSnapshot } from '../providers/types';
import { ruleBasedParse } from '../providers/mock/mockAIProvider';

export interface AIRunLog {
  fn: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  status: 'ok' | 'error';
}

/**
 * Camada central de IA. Componentes React nunca chamam um AIProvider direto:
 * tudo passa por aqui, que valida a saída, impede "fatos" sem evidência
 * e registra cada chamada (tabela ai_runs).
 */
export class AIService {
  constructor(
    private provider: AIProvider,
    private log: (run: AIRunLog) => void = () => {},
  ) {}

  get model() {
    return this.provider.model;
  }

  private async run<T>(fn: string, task: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await task();
      this.log({ fn, model: this.provider.model, promptVersion: this.provider.promptVersion, latencyMs: Math.round(performance.now() - started), status: 'ok' });
      return result;
    } catch (err) {
      this.log({ fn, model: this.provider.model, promptVersion: this.provider.promptVersion, latencyMs: Math.round(performance.now() - started), status: 'error' });
      throw err;
    }
  }

  async parseSearchQuery(text: string): Promise<ParsedCriteria> {
    try {
      const parsed = await this.run('parseSearchQuery', () => this.provider.parseSearchQuery(text));
      const c = parsed.criteria;
      c.quantity = Math.max(1, Math.min(200, Math.round(Number(c.quantity) || 50)));
      if (c.radiusKm != null) c.radiusKm = Math.max(1, Math.min(500, Math.round(c.radiusKm)));
      return parsed;
    } catch {
      // Se a IA falhar, a busca não para: cai para a interpretação por regras.
      return ruleBasedParse(text);
    }
  }

  async scoreLead(company: Company, profile: Profile, leadId: string, extras: ScoreExtras = {}): Promise<LeadScore> {
    const base = ruleScore(company, profile, extras);
    let adjustment = 0;
    let reason = 'sem ajuste da IA';
    try {
      const adj = await this.run('scoreLead', () => this.provider.adjustScore(company, base.total, icpText(profile)));
      adjustment = Math.max(-15, Math.min(15, Math.round(adj.adjustment)));
      reason = adj.reason || reason;
    } catch {
      /* mantém só a base de regras */
    }
    const score = Math.max(0, Math.min(100, base.total + adjustment));
    const tier = tierOf(score);
    const top = [...base.rules].sort((a, b) => b.points / b.max - a.points / a.max);
    return {
      id: uid('sc'),
      leadId,
      score,
      tier,
      ruleScore: base.total,
      aiAdjustment: adjustment,
      breakdown: base.rules,
      justification: `Base de regras ${base.total}: ${top.slice(0, 2).map((r) => r.evidence).join('; ')}. Ajuste da IA ${adjustment >= 0 ? '+' : ''}${adjustment}: ${reason}.`,
      model: this.provider.model,
      promptVersion: this.provider.promptVersion,
      createdAt: nowIso(),
    };
  }

  async analyzeCompany(company: Company, profile: Profile): Promise<AnalysisSections> {
    const sections = await this.run('analyzeCompany', () => this.provider.analyzeCompany(company, icpText(profile)));
    return enforceEvidence(sections, company);
  }

  summarizeCompany(company: Company): Promise<string> {
    return this.run('summarizeCompany', () => this.provider.summarizeCompany(company));
  }

  generateApproach(company: Company, channel: Channel, options: ApproachOptions): Promise<string> {
    return this.run('generateApproach', () => this.provider.generateApproach(company, channel, options));
  }

  /** Classifica a resposta do lead. Se a IA falhar, usa regras (nunca deixa a resposta sem classificação). */
  async classifyReply(text: string): Promise<{ classification: ReplyClass; confidence: number; summary: string }> {
    try {
      return await this.run('classifyReply', () => this.provider.classifyReply(text));
    } catch {
      return classifyReplyRules(text);
    }
  }

  /** Leitura em linguagem natural dos números (só usa os números fornecidos). */
  summarizeResults(snapshot: ResultsSnapshot): Promise<string[]> {
    return this.run('summarizeResults', () => this.provider.summarizeResults(snapshot));
  }
}

function icpText(p: Profile): string {
  return `Oferta: ${p.offer || 'não informada'}. Segmentos: ${p.icpSegments.join(', ') || 'qualquer'}. Regiões: ${p.icpRegions.join(', ') || 'qualquer'}.`;
}

/** Um item "fato" sem campo de evidência preenchido vira inferência. */
function enforceEvidence(sections: AnalysisSections, company: Company): AnalysisSections {
  const out = {} as AnalysisSections;
  for (const key of Object.keys(sections) as (keyof AnalysisSections)[]) {
    out[key] = (sections[key] ?? []).map((item) => {
      if (item.kind !== 'fact') return item;
      const field = item.evidenceField as CompanyField | undefined;
      const value = field ? company[field as keyof Company] : undefined;
      return value ? item : { ...item, kind: 'inference' as const, evidenceField: undefined };
    });
  }
  return out;
}
