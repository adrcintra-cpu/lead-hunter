import type {
  AIRun,
  Company,
  CompanyAnalysis,
  Lead,
  LeadActivity,
  LeadList,
  LeadListMember,
  LeadNote,
  LeadScore,
  LeadSource,
  Message,
  Profile,
  SavedSearch,
  Search,
  SearchResult,
  SuppressionEntry,
} from '@/core/types';

/** Uma "tabela" por coleção, como no Postgres. */
export interface Tables {
  companies: Company;
  leadSources: LeadSource;
  leads: Lead;
  leadScores: LeadScore;
  analyses: CompanyAnalysis;
  notes: LeadNote;
  activities: LeadActivity;
  lists: LeadList;
  listMembers: LeadListMember;
  searches: Search;
  savedSearches: SavedSearch;
  searchResults: SearchResult;
  messages: Message;
  suppression: SuppressionEntry;
  aiRuns: AIRun;
}

export type TableName = keyof Tables;

export type DbState = { [K in TableName]: Tables[K][] } & { profile: Profile | null; version: number };

/** Tabelas de auditoria: só aceitam inserção (espelha a RLS do Supabase). */
export const APPEND_ONLY: TableName[] = ['activities', 'aiRuns'];

/**
 * Contrato de persistência. O MVP usa LocalRepository (localStorage).
 * Um SupabaseRepository implementa o mesmo contrato com
 * supabase.from(tabela) e as políticas de RLS da migration.
 */
export interface Repository {
  snapshot(): DbState;
  subscribe(listener: () => void): () => void;
  insert<K extends TableName>(table: K, row: Tables[K]): Tables[K];
  update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Tables[K] | null;
  remove<K extends TableName>(table: K, id: string): void;
  setProfile(profile: Profile): void;
  batch(fn: () => void): void;
  reset(): void;
}

export const emptyDb = (): DbState => ({
  version: 1,
  profile: null,
  companies: [],
  leadSources: [],
  leads: [],
  leadScores: [],
  analyses: [],
  notes: [],
  activities: [],
  lists: [],
  listMembers: [],
  searches: [],
  savedSearches: [],
  searchResults: [],
  messages: [],
  suppression: [],
  aiRuns: [],
});
