// Meta Leads (formulários de anúncio do Facebook/Instagram). Leitura direta com RLS da equipe;
// conectar, importar e inscrever passam pela função `meta-leads` (tokens nunca chegam aqui).
import { supabase } from '@/lib/supabase';

export interface MetaPage {
  id: string;
  page_id: string;
  page_name: string | null;
  instagram_username: string | null;
  status: 'conectado' | 'desconectado' | 'erro';
  scopes: string[];
  subscribed: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  connected_at: string;
}

export interface MetaStatus {
  configured: boolean;
  tokenKey: boolean;
  verifyToken: boolean;
  redirectUri: string;
  webhookUrl: string;
  scopes: string[];
  missingScopes: string[];
  lastWebhookAt: string | null;
  pages: MetaPage[];
}

export interface MetaLead {
  id: string;
  meta_lead_id: string;
  page_ref: string | null;
  form_id: string | null;
  form_name: string | null;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  platform: string | null;
  is_organic: boolean | null;
  created_time: string | null;
  field_data: { name: string; values: string[] }[];
  contact: { name?: string; email?: string; phone?: string; company?: string; jobTitle?: string; city?: string };
  lead_id: string | null;
  imported_via: 'webhook' | 'importacao';
  enrolled_at: string | null;
  skip_reason: string | null;
}

export interface MetaSyncLog {
  id: string;
  action: string;
  status: 'ok' | 'erro' | 'ignorado';
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface MetaLeadsData {
  leads: MetaLead[];
  stages: Record<string, string>;
  replied: Set<string>;
  logs: MetaSyncLog[];
  autoFirstContact: boolean;
}

function need() {
  if (!supabase) throw new Error('Disponível só no modo real (Supabase).');
  return supabase;
}

const missing = (msg: string) => /meta_|does not exist|schema cache/i.test(msg);

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await need().functions.invoke('meta-leads', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || (/not found|404/i.test(error.message) ? 'A função meta-leads ainda não foi publicada no Supabase.' : error.message));
  }
  return data as T;
}

export interface ImportResult {
  forms: number;
  novos: number;
  existentes: number;
  repetidos: number;
  erros: number;
  more: boolean;
}

export const metaLeadsApi = {
  status: () => call<MetaStatus>({ action: 'status' }),
  startConnect: () => call<{ url: string }>({ action: 'start' }),
  finishConnect: (code: string, state: string) => call<{ ok: true; pages: { page: string; subscribed: boolean; error?: string }[]; declined: string[] }>({ action: 'callback', code, state }),
  importHistory: (pageRef: string) => call<ImportResult>({ action: 'import', pageRef }),
  resubscribe: (pageRef: string) => call<{ ok: true }>({ action: 'resubscribe', pageRef }),
  disconnect: (pageRef: string) => call<{ ok: true }>({ action: 'disconnect', pageRef }),

  async load(sinceDays = 90): Promise<MetaLeadsData> {
    const db = need();
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const [l, logs, s] = await Promise.all([
      db
        .from('meta_leads')
        .select('id, meta_lead_id, page_ref, form_id, form_name, ad_name, adset_name, campaign_name, platform, is_organic, created_time, field_data, contact, lead_id, imported_via, enrolled_at, skip_reason')
        .gte('created_time', since)
        .order('created_time', { ascending: false })
        .limit(2000),
      db.from('meta_sync_logs').select('id, action, status, detail, created_at').order('created_at', { ascending: false }).limit(30),
      db.from('meta_settings').select('auto_first_contact').maybeSingle(),
    ]);
    if (l.error) throw new Error(missing(l.error.message) ? 'As tabelas do Meta Leads ainda não existem no banco.' : l.error.message);
    const leads = (l.data ?? []) as MetaLead[];
    const ids = [...new Set(leads.map((x) => x.lead_id).filter(Boolean))] as string[];
    const stages: Record<string, string> = {};
    const replied = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      const [st, rep] = await Promise.all([
        db.from('leads').select('id, stage').in('id', part),
        db.from('lead_activities').select('lead_id').in('lead_id', part).eq('type', 'reply_received').limit(5000),
      ]);
      for (const r of st.data ?? []) stages[r.id as string] = r.stage as string;
      for (const r of rep.data ?? []) replied.add(r.lead_id as string);
    }
    return { leads, stages, replied, logs: (logs.data ?? []) as MetaSyncLog[], autoFirstContact: s.data?.auto_first_contact ?? true };
  },

  async setAutoFirstContact(ownerId: string, on: boolean) {
    const { error } = await need().from('meta_settings').upsert({ owner_id: ownerId, auto_first_contact: on, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
    if (error) throw new Error(/row-level|policy/i.test(error.message) ? 'Só o administrador da conta pode mudar isso.' : error.message);
  },
};

/** O state do login é assinado no servidor; aqui só lemos o tipo (não é segredo) para saber qual função conclui. */
export function isMetaLeadsState(state: string | null): boolean {
  try {
    const body = (state ?? '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(body + '='.repeat((4 - (body.length % 4)) % 4)));
    return json?.k === 'meta-leads';
  } catch {
    return false;
  }
}

export const PLATFORM_LABEL: Record<string, string> = { fb: 'Facebook', ig: 'Instagram' };
