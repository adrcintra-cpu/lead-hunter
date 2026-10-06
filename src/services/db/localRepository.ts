import { LEGACY_STAGES, type Profile } from '@/core/types';
import { APPEND_ONLY, emptyDb, type DbState, type Repository, type TableName, type Tables } from './schema';
import { purgeState, type PurgeRequest } from './purge';

/**
 * Persistência local, por usuário, no localStorage.
 * Cada usuário tem sua própria chave — o equivalente local da RLS.
 */
/** Converte dados salvos por versões anteriores. */
function migrate(db: DbState): DbState {
  const leads = db.leads.map((l) => (LEGACY_STAGES[l.stage as string] ? { ...l, stage: LEGACY_STAGES[l.stage as string] } : l));
  return { ...db, leads, version: 2, clockOffsetMs: db.clockOffsetMs ?? 0 };
}

export class LocalRepository implements Repository {
  private state: DbState;
  private listeners = new Set<() => void>();
  private batching = 0;
  private dirty = false;

  constructor(private storageKey: string) {
    this.state = this.load();
  }

  private load(): DbState {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return migrate({ ...emptyDb(), ...(JSON.parse(raw) as DbState) });
    } catch {
      /* dados corrompidos ou storage bloqueado: começa vazio */
    }
    return emptyDb();
  }

  private commit() {
    if (this.batching > 0) {
      this.dirty = true;
      return;
    }
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* cota cheia ou storage bloqueado: segue em memória */
    }
    this.listeners.forEach((l) => l());
  }

  snapshot() {
    return this.state;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  insert<K extends TableName>(table: K, row: Tables[K]): Tables[K] {
    const rows = this.state[table] as Tables[K][];
    this.state = { ...this.state, [table]: [row, ...rows] } as DbState;
    this.commit();
    return row;
  }

  update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Tables[K] | null {
    if (APPEND_ONLY.includes(table)) throw new Error(`${table} é somente inserção (auditoria).`);
    const rows = this.state[table] as unknown as (Tables[K] & { id: string })[];
    const current = rows.find((r) => r.id === id);
    if (!current) return null;
    const updated = { ...current, ...patch, ...('updatedAt' in current ? { updatedAt: new Date().toISOString() } : {}) } as Tables[K] & { id: string };
    this.state = { ...this.state, [table]: rows.map((r) => (r.id === id ? updated : r)) } as DbState;
    this.commit();
    return updated;
  }

  remove<K extends TableName>(table: K, id: string) {
    if (APPEND_ONLY.includes(table)) throw new Error(`${table} é somente inserção (auditoria).`);
    const rows = this.state[table] as unknown as (Tables[K] & { id: string })[];
    this.state = { ...this.state, [table]: rows.filter((r) => r.id !== id) } as DbState;
    this.commit();
  }

  setProfile(profile: Profile) {
    this.state = { ...this.state, profile };
    this.commit();
  }

  batch(fn: () => void) {
    this.batching++;
    try {
      fn();
    } finally {
      this.batching--;
      if (this.batching === 0 && this.dirty) {
        this.dirty = false;
        this.commit();
      }
    }
  }

  setClockOffset(ms: number) {
    this.state = { ...this.state, clockOffsetMs: ms };
    this.commit();
  }

  reset() {
    this.state = { ...emptyDb(), profile: this.state.profile };
    this.commit();
  }

  async purge(req: PurgeRequest) {
    this.state = purgeState(this.state, req);
    this.commit();
  }
}
