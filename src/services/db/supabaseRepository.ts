import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead, Profile } from '@/core/types';
import { APPEND_ONLY, emptyDb, type DbState, type Repository, type TableName, type Tables } from './schema';
import { chunks, purgeState, type PurgeRequest } from './purge';

/**
 * Persistência no Supabase (Postgres + RLS).
 *
 * Leitura: carrega tudo do usuário uma vez (load) e serve do cache em memória,
 * para a interface continuar instantânea. Escrita: atualiza o cache na hora e
 * grava no banco numa fila, na mesma ordem das operações (as chaves estrangeiras
 * dependem disso). Uma falha de gravação é reportada por onError.
 */

interface TableDef {
  sql: string;
  cols: string[];
  order: string;
}

const DEFS: Record<TableName, TableDef> = {
  companies: {
    sql: 'companies',
    cols: ['id', 'legal_name', 'trade_name', 'cnpj', 'segment', 'city', 'state', 'address', 'lat', 'lng', 'website', 'phone', 'whatsapp', 'whatsapp_status', 'instagram', 'linkedin', 'employees_range', 'employees_min', 'company_size', 'cnae', 'registration_status', 'opened_at', 'field_provenance', 'dedupe_key', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  leadSources: { sql: 'lead_sources', cols: ['id', 'company_id', 'search_id', 'provider', 'external_id', 'fetched_at', 'expires_at'], order: 'fetched_at' },
  leads: {
    sql: 'leads',
    cols: ['id', 'company_id', 'stage', 'current_score', 'score_tier', 'first_search_id', 'origin', 'discovered_at', 'last_activity_at', 'contact_name', 'contact_role', 'email', 'tags', 'owner_name', 'next_action', 'next_action_at', 'last_contact_at', 'whatsapp_consent_at', 'whatsapp_consent_source', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  leadScores: {
    sql: 'lead_scores',
    cols: ['id', 'lead_id', 'score', 'tier', 'rule_score', 'ai_adjustment', 'breakdown', 'justification', 'model', 'prompt_version', 'created_at'],
    order: 'created_at',
  },
  analyses: { sql: 'company_analyses', cols: ['id', 'lead_id', 'sections', 'model', 'prompt_version', 'created_at'], order: 'created_at' },
  notes: { sql: 'lead_notes', cols: ['id', 'lead_id', 'body', 'created_at'], order: 'created_at' },
  activities: { sql: 'lead_activities', cols: ['id', 'lead_id', 'type', 'description', 'payload', 'created_at'], order: 'created_at' },
  lists: { sql: 'lists', cols: ['id', 'name', 'description', 'created_at', 'updated_at'], order: 'created_at' },
  listMembers: { sql: 'lead_lists', cols: ['list_id', 'lead_id', 'added_at'], order: 'added_at' },
  searches: {
    sql: 'searches',
    cols: ['id', 'raw_query', 'parsed_criteria', 'confirmed_criteria', 'status', 'providers_used', 'ignored_criteria', 'result_count', 'new_count', 'duplicates_removed', 'saved_search_id', 'error', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  savedSearches: { sql: 'saved_searches', cols: ['id', 'name', 'raw_query', 'criteria', 'last_run_at', 'schedule', 'next_run_at', 'created_at', 'updated_at'], order: 'created_at' },
  searchResults: { sql: 'search_results', cols: ['id', 'search_id', 'company_id', 'lead_id', 'rank', 'provider', 'was_duplicate'], order: 'rank' },
  messages: {
    sql: 'messages',
    cols: ['id', 'lead_id', 'channel', 'generated_content', 'final_content', 'status', 'model', 'prompt_version', 'campaign_id', 'enrollment_id', 'step_index', 'subject', 'sender', 'recipient', 'template', 'context', 'provider', 'external_id', 'sent_at', 'delivered_at', 'read_at', 'replied_at', 'failed_at', 'failure_reason', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  suppression: { sql: 'suppression_list', cols: ['id', 'kind', 'value', 'reason', 'created_at'], order: 'created_at' },
  aiRuns: { sql: 'ai_runs', cols: ['id', 'fn', 'model', 'prompt_version', 'latency_ms', 'status', 'created_at'], order: 'created_at' },
  campaigns: {
    sql: 'campaigns',
    cols: ['id', 'name', 'objective', 'audience', 'channel', 'cadence_id', 'owner_name', 'status', 'scheduled_at', 'started_at', 'finished_at', 'daily_limit_email', 'daily_limit_whatsapp', 'auto_enroll', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  cadences: { sql: 'cadences', cols: ['id', 'name', 'description', 'stop_on_reply', 'steps', 'created_at', 'updated_at'], order: 'created_at' },
  enrollments: {
    sql: 'enrollments',
    cols: ['id', 'campaign_id', 'cadence_id', 'lead_id', 'step_index', 'status', 'next_run_at', 'started_at', 'last_step_at', 'stop_reason', 'draft', 'created_at', 'updated_at'],
    order: 'created_at',
  },
  inbound: {
    sql: 'inbound_messages',
    cols: ['id', 'lead_id', 'channel', 'from_address', 'body', 'received_at', 'external_id', 'campaign_id', 'enrollment_id', 'classification', 'confidence', 'summary'],
    order: 'received_at',
  },
  tasks: {
    sql: 'tasks',
    cols: ['id', 'lead_id', 'campaign_id', 'title', 'description', 'owner_name', 'due_at', 'status', 'source', 'action_url', 'created_at', 'done_at'],
    order: 'created_at',
  },
};

const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Objeto do app → linha do banco, só com colunas conhecidas. undefined vira null em updates. */
export function toRow(table: TableName, obj: Record<string, unknown>, forUpdate = false): Record<string, unknown> {
  const cols = new Set(DEFS[table].cols);
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const col = toSnake(k);
    if (!cols.has(col)) continue;
    if (v === undefined) {
      if (forUpdate) row[col] = null;
      continue;
    }
    row[col] = v;
  }
  return row;
}

/** Linha do banco → objeto do app. null vira ausente (campos opcionais). */
export function fromRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of DEFS[table].cols) {
    const v = row[col];
    if (v !== null && v !== undefined) out[toCamel(col)] = typeof v === 'string' && col === 'opened_at' ? v.slice(0, 10) : v;
  }
  if (table === 'listMembers') out.id = `${row.list_id}:${row.lead_id}`;
  return out;
}

/**
 * Registros que o próprio banco cria (não reenviamos):
 * - mudança de etapa: o trigger log_stage_change grava a atividade;
 * - ai_runs: a Edge Function `ai` registra cada chamada.
 */
function serverOwned(table: TableName, row: Record<string, unknown>): boolean {
  return table === 'aiRuns' || (table === 'activities' && row.type === 'stage_changed');
}

/** Confere o servidor a cada minuto: os envios e respostas acontecem lá. */
export const REMOTE_REFRESH_MS = 60_000;

/**
 * Atualização incremental: a cada minuto só vem o que mudou (pela coluna de data abaixo), não a base inteira.
 * Antes, a base toda era baixada a cada minuto com o app aberto, o que estourava a cota de tráfego do Supabase.
 * - 'full': tabelas pequenas sem coluna de alteração confiável (vêm inteiras).
 * - 'byParent': resultados de busca, só das buscas que mudaram.
 * Uma recarga completa a cada 15 min pega o que foi apagado no servidor.
 */
const SYNC: Record<TableName, string | 'full' | 'byParent'> = {
  companies: 'updated_at',
  leadSources: 'fetched_at',
  leads: 'updated_at',
  leadScores: 'created_at',
  analyses: 'created_at',
  notes: 'updated_at',
  activities: 'created_at',
  lists: 'updated_at',
  listMembers: 'added_at',
  searches: 'updated_at',
  savedSearches: 'updated_at',
  searchResults: 'byParent',
  messages: 'updated_at',
  suppression: 'created_at',
  aiRuns: 'created_at',
  campaigns: 'updated_at',
  cadences: 'updated_at',
  enrollments: 'updated_at',
  inbound: 'full',
  tasks: 'full',
};
const FULL_RELOAD_MS = 15 * 60_000;
/** Margem para relógio diferente e gravações que terminam durante a leitura. */
const OVERLAP_MS = 5 * 60_000;

export class SupabaseRepository implements Repository {
  private state: DbState = emptyDb();
  private listeners = new Set<() => void>();
  private batching = 0;
  private dirty = false;
  private queue: Promise<void> = Promise.resolve();
  /** As colunas da imagem da assinatura existem (migration 900 aplicada). */
  private signatureCols = false;
  /** A coluna leads.beelie (memória do Beelie) existe (migration 1000 aplicada). */
  private beelieCol = false;
  /**
   * Gravações locais ainda não confirmadas pelo banco. Um recarregamento que começa antes de uma
   * gravação chegar ao servidor traria a versão antiga: essas linhas mantêm a versão local.
   */
  private seq = 0;
  private savedSeq = 0;
  private touched: { table: TableName; key: string; seq: number }[] = [];

  private rowKey(r: Record<string, unknown>): string {
    return r.id != null ? String(r.id) : `${r.listId}:${r.leadId}`;
  }

  /** Marca a linha como alterada localmente; a marca sai quando a fila de gravação passa por ela. */
  private touch(table: TableName, key: string) {
    const seq = ++this.seq;
    this.touched.push({ table, key, seq });
    this.queue = this.queue.then(() => {
      this.savedSeq = Math.max(this.savedSeq, seq);
    });
  }

  /** Mantém no estado recarregado a versão local das linhas gravadas depois do início da leitura. */
  private keepLocal(next: DbState, savedAtStart: number) {
    const pending = this.touched.filter((t) => t.seq > savedAtStart);
    for (const t of pending) {
      const k = (r: unknown) => this.rowKey(r as Record<string, unknown>);
      const local = (this.state[t.table] as unknown[]).find((r) => k(r) === t.key);
      const rows = (next[t.table] as unknown[]).filter((r) => k(r) !== t.key);
      (next as unknown as Record<string, unknown[]>)[t.table] = local ? [local, ...rows] : rows;
    }
    this.touched = this.touched.filter((t) => t.seq > this.savedSeq);
  }

  /** Início da última leitura (completa ou incremental) e da última completa. */
  private syncedAt = 0;
  private fullAt = 0;

  constructor(
    private client: SupabaseClient,
    private user: { id: string; email: string },
    private onError: (message: string) => void = () => {},
  ) {}

  /** Todas as linhas de uma consulta, de 1000 em 1000. */
  private async pages(t: TableName, build: (q: ReturnType<SupabaseClient['from']>) => unknown, extraCols = ''): Promise<Record<string, unknown>[]> {
    const def = DEFS[t];
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = build(this.client.from(def.sql));
      const { data, error } = await q.select(def.cols.join(',') + extraCols).order(def.order, { ascending: t === 'searchResults' }).range(from, from + 999);
      if (error) throw new Error(`Falha ao carregar ${def.sql}: ${error.message}`);
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }

  async load(): Promise<void> {
    const startedAt = Date.now();
    const savedAtStart = this.savedSeq;
    const next = emptyDb();
    const tables = Object.keys(DEFS) as TableName[];
    await Promise.all(
      tables.map(async (t) => {
        const def = DEFS[t];
        const rows: Record<string, unknown>[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await this.client
            .from(def.sql)
            .select(def.cols.join(','))
            .order(def.order, { ascending: t === 'searchResults' })
            .range(from, from + 999);
          if (error) throw new Error(`Falha ao carregar ${def.sql}: ${error.message}`);
          rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
          if (!data || data.length < 1000) break;
        }
        (next as unknown as Record<string, unknown[]>)[t] = rows.map((r) => fromRow(t, r));
      }),
    );
    // Memória do Beelie: lida à parte, para o app funcionar mesmo antes da migration.
    {
      const intel = new Map<string, unknown>();
      this.beelieCol = true;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.client.from('leads').select('id, beelie').range(from, from + 999);
        if (error) {
          this.beelieCol = false;
          break;
        }
        for (const r of (data ?? []) as { id: string; beelie: unknown }[]) if (r.beelie) intel.set(r.id, r.beelie);
        if (!data || data.length < 1000) break;
      }
      if (intel.size) next.leads = next.leads.map((l) => (intel.has(l.id) ? { ...l, beelie: intel.get(l.id) as Lead['beelie'] } : l));
    }
    const { data: p, error } = await this.client.from('profiles').select('*').eq('id', this.user.id).maybeSingle();
    if (error) throw new Error(`Falha ao carregar o perfil: ${error.message}`);
    if (p) {
      this.signatureCols = 'signature_image_url' in p;
      next.profile = {
        id: p.id,
        email: this.user.email,
        fullName: p.full_name ?? '',
        companyName: p.company_name ?? '',
        offer: p.offer ?? '',
        icpSegments: p.icp_segments ?? [],
        icpRegions: p.icp_regions ?? [],
        senderEmail: p.sender_email ?? undefined,
        signature: p.signature ?? undefined,
        sendWindow: p.send_window ?? undefined,
        whatsappQrCampaigns: typeof p.whatsapp_qr_campaigns === 'boolean' ? p.whatsapp_qr_campaigns : undefined,
        // Chaves só existem quando as colunas existem: a tela usa isso para avisar da migration.
        ...('signature_image_url' in p
          ? { signatureImageUrl: p.signature_image_url ?? '', signatureLinkUrl: p.signature_link_url ?? '', signatureImageWidth: p.signature_image_width ?? undefined }
          : {}),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      };
    }
    this.keepLocal(next, savedAtStart);
    this.state = next;
    this.syncedAt = startedAt;
    this.fullAt = startedAt;
    this.emit();
  }

  /**
   * Atualiza do servidor depois de gravar o que está pendente: só o que mudou desde a última leitura
   * (ver SYNC). Falhas são silenciosas (tenta de novo depois).
   */
  async refresh(): Promise<void> {
    await this.flush();
    if (!this.syncedAt || Date.now() - this.fullAt > FULL_RELOAD_MS) return this.load();
    const startedAt = Date.now();
    const savedAtStart = this.savedSeq;
    const since = new Date(this.syncedAt - OVERLAP_MS).toISOString();
    const tables = (Object.keys(DEFS) as TableName[]).filter((t) => SYNC[t] !== 'byParent');
    const got = new Map<TableName, Record<string, unknown>[]>();
    await Promise.all(
      tables.map(async (t) => {
        const mode = SYNC[t];
        const extra = t === 'leads' && this.beelieCol ? ',beelie' : '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        got.set(t, await this.pages(t, (q: any) => (mode === 'full' ? q : q.gte(mode, since)), extra));
      }),
    );
    const changedSearches = (got.get('searches') ?? []).map((r) => String(r.id));
    if (changedSearches.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      got.set('searchResults', await this.pages('searchResults', (q: any) => q.in('search_id', changedSearches.slice(0, 100))));
    }

    const next = { ...this.state } as DbState;
    for (const [t, rows] of got) {
      const fresh = rows.map((r) => {
        const o = fromRow(t, r);
        if (t === 'leads' && r.beelie) (o as Record<string, unknown>).beelie = r.beelie;
        return o;
      });
      if (SYNC[t] === 'full') {
        (next as unknown as Record<string, unknown[]>)[t] = fresh;
        continue;
      }
      if (!fresh.length) continue;
      const key = (r: unknown) => this.rowKey(r as Record<string, unknown>);
      const byKey = new Map((this.state[t] as unknown[]).map((r) => [key(r), r]));
      for (const r of fresh) {
        const old = byKey.get(key(r)) as Record<string, unknown> | undefined;
        // A memória do Beelie só vem quando a coluna existe: sem ela no pacote, mantém a que já estava.
        byKey.set(key(r), t === 'leads' && old?.beelie && !(r as Record<string, unknown>).beelie ? { ...r, beelie: old.beelie } : r);
      }
      const order = toCamel(DEFS[t].order);
      const asc = t === 'searchResults';
      (next as unknown as Record<string, unknown[]>)[t] = [...byKey.values()].sort((a, b) => {
        const x = (a as Record<string, unknown>)[order];
        const y = (b as Record<string, unknown>)[order];
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
        return asc ? c : -c;
      });
    }
    this.keepLocal(next, savedAtStart);
    this.state = next;
    this.syncedAt = startedAt;
    this.emit();
  }

  /** Espera todas as gravações pendentes (útil antes de sair). */
  flush(): Promise<void> {
    return this.queue;
  }

  private enqueue(label: string, op: () => PromiseLike<{ error: { message: string } | null }>) {
    this.queue = this.queue.then(async () => {
      try {
        const { error } = await op();
        if (error) this.onError(`${label}: ${error.message}`);
      } catch (e) {
        this.onError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  private emit() {
    if (this.batching > 0) {
      this.dirty = true;
      return;
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
    const obj = row as unknown as Record<string, unknown>;
    if (!serverOwned(table, obj)) {
      const def = DEFS[table];
      this.enqueue(`Salvar em ${def.sql}`, () => this.client.from(def.sql).insert(toRow(table, obj)));
      this.touch(table, this.rowKey(obj));
    }
    this.emit();
    return row;
  }

  update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Tables[K] | null {
    if (APPEND_ONLY.includes(table)) throw new Error(`${table} é somente inserção (auditoria).`);
    const rows = this.state[table] as unknown as (Tables[K] & { id: string })[];
    const current = rows.find((r) => r.id === id);
    if (!current) return null;
    const stamp = 'updatedAt' in current ? { updatedAt: new Date().toISOString() } : {};
    const updated = { ...current, ...patch, ...stamp } as Tables[K] & { id: string };
    this.state = { ...this.state, [table]: rows.map((r) => (r.id === id ? updated : r)) } as DbState;
    const def = DEFS[table];
    const values = toRow(table, { ...(patch as Record<string, unknown>), ...stamp }, true);
    delete values.id;
    if (Object.keys(values).length) this.enqueue(`Atualizar ${def.sql}`, () => this.client.from(def.sql).update(values).eq('id', id));
    if (table === 'leads' && 'beelie' in (patch as Record<string, unknown>) && this.beelieCol) {
      const beelie = (patch as Record<string, unknown>).beelie ?? null;
      this.enqueue('Atualizar memória do Beelie', () => this.client.from('leads').update({ beelie }).eq('id', id));
    }
    this.touch(table, id);
    this.emit();
    return updated;
  }

  remove<K extends TableName>(table: K, id: string) {
    if (APPEND_ONLY.includes(table)) throw new Error(`${table} é somente inserção (auditoria).`);
    const rows = this.state[table] as unknown as (Tables[K] & { id: string })[];
    this.state = { ...this.state, [table]: rows.filter((r) => r.id !== id) } as DbState;
    const def = DEFS[table];
    if (table === 'listMembers') {
      const [listId, leadId] = id.split(':');
      this.enqueue(`Excluir de ${def.sql}`, () => this.client.from(def.sql).delete().eq('list_id', listId).eq('lead_id', leadId));
    } else {
      this.enqueue(`Excluir de ${def.sql}`, () => this.client.from(def.sql).delete().eq('id', id));
    }
    this.touch(table, id);
    this.emit();
  }

  setProfile(profile: Profile) {
    this.state = { ...this.state, profile };
    const row = {
      full_name: profile.fullName,
      company_name: profile.companyName,
      offer: profile.offer,
      icp_segments: profile.icpSegments,
      icp_regions: profile.icpRegions,
      sender_email: profile.senderEmail ?? null,
      signature: profile.signature ?? null,
      send_window: profile.sendWindow ?? null,
      // Só grava quando a coluna existe (migration aplicada) e o valor foi definido na tela.
      ...(profile.whatsappQrCampaigns !== undefined ? { whatsapp_qr_campaigns: profile.whatsappQrCampaigns } : {}),
      // Assinatura com imagem: só grava quando a tela definiu (colunas da migration 900).
      ...(this.signatureCols
        ? { signature_image_url: profile.signatureImageUrl || null, signature_link_url: profile.signatureLinkUrl || null, signature_image_width: profile.signatureImageWidth ?? null }
        : {}),
    };
    // O perfil é criado pelo banco no cadastro (trigger handle_new_user): aqui só atualizamos.
    // Se por algum motivo ainda não existir, cria (permitido pela policy "perfil próprio: criar").
    this.enqueue('Salvar perfil', async () => {
      const upd = await this.client.from('profiles').update(row).eq('id', profile.id).select('id');
      if (upd.error || (upd.data && upd.data.length > 0)) return upd;
      return this.client.from('profiles').insert({ id: profile.id, ...row });
    });
    this.emit();
  }

  batch(fn: () => void) {
    this.batching++;
    try {
      fn();
    } finally {
      this.batching--;
      if (this.batching === 0 && this.dirty) {
        this.dirty = false;
        this.emit();
      }
    }
  }

  reset() {
    throw new Error('Apagar todos os dados não está disponível no modo Supabase.');
  }

  /**
   * Exclusão em massa. Apaga as empresas (o banco apaga em cascata leads, histórico, mensagens,
   * tarefas e inscrições) e as campanhas (mensagens e tarefas só perdem o vínculo).
   * A RLS garante que só os dados do próprio usuário são apagados. Espera o banco confirmar.
   */
  async purge(req: PurgeRequest) {
    const before = this.state;
    const companyIds = req.everything ? before.companies.map((c) => c.id) : (req.companyIds ?? []);
    const campaignIds = req.everything ? before.campaigns.map((c) => c.id) : (req.campaignIds ?? []);
    this.state = purgeState(before, req);
    this.emit();
    // Nenhum filtro "pega tudo" no Supabase: tudo é por id, em lotes, e a RLS limita ao dono.
    const run = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op();
      if (error) throw new Error(`${label}: ${error.message}`);
    };
    await this.queue; // termina as gravações pendentes antes de apagar
    try {
      for (const ids of chunks(campaignIds)) await run('Excluir campanhas', () => this.client.from('campaigns').delete().in('id', ids));
      for (const ids of chunks(companyIds)) await run('Excluir leads', () => this.client.from('companies').delete().in('id', ids));
      if (req.everything) {
        const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
        for (const part of chunks(ids(before.searches))) await run('Excluir histórico de buscas', () => this.client.from('searches').delete().in('id', part));
        for (const part of chunks(ids(before.lists))) await run('Excluir listas', () => this.client.from('lists').delete().in('id', part));
        for (const part of chunks(ids(before.tasks))) await run('Excluir tarefas', () => this.client.from('tasks').delete().in('id', part));
        for (const part of chunks(ids(before.messages))) await run('Excluir mensagens', () => this.client.from('messages').delete().in('id', part));
        // Respostas recebidas saem junto com os leads (cascata no banco).
      }
    } catch (e) {
      // Falhou no meio: recarrega do banco para a tela mostrar o que de fato ficou.
      this.onError(e instanceof Error ? e.message : String(e));
      await this.load().catch(() => undefined);
      throw e;
    }
  }
}
