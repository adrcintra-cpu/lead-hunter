import { useMemo } from 'react';
import type { Company, Lead, LeadScore } from '@/core/types';
import type { DbState } from '@/services/db/schema';
import { useDb } from './AppStore';

export interface LeadRow {
  lead: Lead;
  company: Company;
  score: LeadScore | undefined;
}

export function buildLeadRows(db: DbState): LeadRow[] {
  const companies = new Map(db.companies.map((c) => [c.id, c]));
  const latestScore = new Map<string, LeadScore>();
  for (const s of db.leadScores) {
    const prev = latestScore.get(s.leadId);
    if (!prev || prev.createdAt < s.createdAt) latestScore.set(s.leadId, s);
  }
  return db.leads
    .map((lead) => ({ lead, company: companies.get(lead.companyId)!, score: latestScore.get(lead.id) }))
    .filter((r) => r.company);
}

export function useLeadRows(): LeadRow[] {
  const db = useDb();
  return useMemo(() => buildLeadRows(db), [db.leads, db.companies, db.leadScores]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useLeadRow(leadId: string | null): LeadRow | null {
  const rows = useLeadRows();
  return useMemo(() => rows.find((r) => r.lead.id === leadId) ?? null, [rows, leadId]);
}
