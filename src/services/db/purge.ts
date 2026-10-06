import type { DbState } from './schema';

/**
 * Exclusão em massa, pedida pelo usuário (leads, campanhas ou "começar do zero").
 * Aplica na memória o mesmo efeito das chaves estrangeiras do banco:
 * - empresa → leads, fontes, notas, histórico, mensagens, tarefas, inscrições… (on delete cascade);
 * - campanha → inscrições (cascade); mensagens, tarefas e respostas só perdem o vínculo (set null).
 * O que NÃO é apagado: perfil, cadências, buscas salvas, lista de supressão (opt-out) e o assistente.
 */
export interface PurgeRequest {
  companyIds?: string[];
  campaignIds?: string[];
  /** Começar do zero: todos os leads e campanhas, histórico de buscas, listas, tarefas e mensagens. */
  everything?: boolean;
}

export function purgeState(s: DbState, req: PurgeRequest): DbState {
  const companies = new Set(req.everything ? s.companies.map((c) => c.id) : (req.companyIds ?? []));
  const campaigns = new Set(req.everything ? s.campaigns.map((c) => c.id) : (req.campaignIds ?? []));
  const leads = new Set(s.leads.filter((l) => companies.has(l.companyId)).map((l) => l.id));
  const byLead = <T extends { leadId?: string }>(rows: T[]) => rows.filter((r) => !r.leadId || !leads.has(r.leadId));
  const unlink = <T extends { campaignId?: string }>(rows: T[]) => rows.map((r) => (r.campaignId && campaigns.has(r.campaignId) ? { ...r, campaignId: undefined } : r));

  const next: DbState = {
    ...s,
    companies: s.companies.filter((c) => !companies.has(c.id)),
    leadSources: s.leadSources.filter((r) => !companies.has(r.companyId)),
    leads: s.leads.filter((l) => !leads.has(l.id)),
    leadScores: byLead(s.leadScores),
    analyses: byLead(s.analyses),
    notes: byLead(s.notes),
    activities: byLead(s.activities),
    listMembers: byLead(s.listMembers),
    searchResults: s.searchResults.filter((r) => !companies.has(r.companyId) && !leads.has(r.leadId)),
    messages: unlink(byLead(s.messages)),
    enrollments: byLead(s.enrollments).filter((e) => !campaigns.has(e.campaignId)),
    inbound: unlink(byLead(s.inbound)),
    tasks: unlink(byLead(s.tasks)),
    campaigns: s.campaigns.filter((c) => !campaigns.has(c.id)),
  };
  if (req.everything) {
    Object.assign(next, { searches: [], searchResults: [], lists: [], listMembers: [], tasks: [], messages: [], inbound: [], enrollments: [] });
  }
  return next;
}

/** Divide uma lista em pedaços (o banco recebe as exclusões em lotes). */
export function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
