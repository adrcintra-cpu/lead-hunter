// Prospecção diária automática (no servidor, sem depender do app aberto).
// Campanhas ativas com "Entrada automática" e "Limite diário de WhatsApp" completam o dia com
// leads da base que ainda nunca foram prospectados, melhor score primeiro, dentro do horário
// de envio. O BEELIE escreve e envia cada primeira mensagem nas execuções seguintes do runner.

import { inWindow, startOfDayBRT } from './planner.ts';
import { DEFAULT_SEND_WINDOW, type SendWindow } from './types.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const PAGE = 1000;
/** Etapas de quem ainda não foi abordado: quando o público não define etapas, só estas entram. */
const FRESH_STAGES = ['novo', 'qualificado'];
const CLOSED = ['cliente', 'nao_interessado'];

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
const same = (a?: string | null, b?: string | null) => {
  const x = digits(a).slice(-8);
  return x.length === 8 && x === digits(b).slice(-8);
};

/** Todas as linhas (em páginas de 1000: o banco devolve no máximo isso por consulta). */
/** Todas as linhas (de 1000 em 1000). O filtro vem depois do select: no supabase-js, .eq só existe após .select. */
async function all(db: Db, table: string, cols: string, filter: (q: Row) => Row): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(db.from(table).select(cols)).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Quantos filtros o público tem: o lead vai para a campanha mais específica. */
const specificity = (a: Row) =>
  (a?.segments?.length ? 1 : 0) + (a?.cities?.length ? 1 : 0) + (a?.stages?.length ? 1 : 0) + (a?.tags?.length ? 1 : 0) + (a?.listId ? 1 : 0) + (a?.minScore ? 1 : 0);

export function matchesAudience(a: Row, lead: Row, company: Row, inList: Set<string> | null): boolean {
  const aud = a ?? {};
  const stages: string[] = aud.stages?.length ? aud.stages : FRESH_STAGES;
  if (!stages.includes(lead.stage) || CLOSED.includes(lead.stage)) return false;
  if (inList && !inList.has(lead.id)) return false;
  if (aud.segments?.length && !aud.segments.some((s: string) => norm(s) === norm(company.segment))) return false;
  if (aud.cities?.length && !aud.cities.some((s: string) => norm(s) === norm(company.city))) return false;
  if (aud.tags?.length && !aud.tags.some((t: string) => ((lead.tags ?? []) as string[]).map(norm).includes(norm(t)))) return false;
  return Number(lead.current_score ?? 0) >= Number(aud.minScore ?? 0);
}

export interface FeedSummary {
  enrolled: number;
  campaigns: number;
}

/** Completa a cota diária das campanhas com entrada automática. Barato quando a cota do dia já foi atingida. */
/** Leads só com e-mail por dia em cada campanha WhatsApp + e-mail sem limite de e-mail definido. */
export const EMAIL_ONLY_DAILY = 20;

export async function feedCampaigns(db: Db, now = new Date()): Promise<FeedSummary> {
  const sum: FeedSummary = { enrolled: 0, campaigns: 0 };
  const { data: camps } = await db
    .from('campaigns')
    .select('id, owner_id, name, audience, cadence_id, channel, daily_limit_whatsapp, daily_limit_email')
    .eq('status', 'ativa')
    .eq('auto_enroll', true);
  const live = ((camps ?? []) as Row[]).filter((c) => Number(c.daily_limit_whatsapp ?? 0) > 0 || Number(c.daily_limit_email ?? 0) > 0);
  if (!live.length) return sum;

  const dayStart = startOfDayBRT(now).toISOString();
  const byOwner = new Map<string, Row[]>();
  for (const c of live) byOwner.set(c.owner_id, [...(byOwner.get(c.owner_id) ?? []), c]);

  for (const [owner, list] of byOwner) {
    const { data: p } = await db.from('profiles').select('send_window').eq('id', owner).maybeSingle();
    const window: SendWindow = (p?.send_window as SendWindow) ?? DEFAULT_SEND_WINDOW;
    if (!inWindow(now, window)) continue;

    // Cota de cada campanha: limite diário menos o que já entrou hoje e o que já saiu hoje.
    const quotas = new Map<string, number>();
    const emailOnlyToday = new Map<string, number>();
    for (const c of list) {
      // Quem entrou hoje só com e-mail não gasta a cota de WhatsApp.
      const { data: today } = await db.from('enrollments').select('lead_id').eq('campaign_id', c.id).gte('created_at', dayStart);
      const todayIds = ((today ?? []) as Row[]).map((e) => e.lead_id);
      if (todayIds.length && c.channel !== 'email') {
        const { data: ls } = await db.from('leads').select('id, company_id').in('id', todayIds);
        const cids = ((ls ?? []) as Row[]).map((l) => l.company_id);
        const { data: cs } = cids.length ? await db.from('companies').select('id, whatsapp').in('id', cids) : { data: [] };
        emailOnlyToday.set(c.id, ((cs ?? []) as Row[]).filter((x) => !x.whatsapp).length);
      }
      const limit = Number(c.channel === 'email' ? c.daily_limit_email : c.daily_limit_whatsapp) || 0;
      const { count: enrolledToday } = await db.from('enrollments').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).gte('created_at', dayStart);
      const ch = c.channel === 'email' ? 'email' : 'whatsapp';
      const { count: msgsToday } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('channel', ch).gte('created_at', dayStart);
      // Respostas da conversa (sugeridas pela IA) não contam como prospecção.
      const { count: repliesToday } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
        .eq('channel', ch)
        .like('template', 'IA — resposta sugerida%')
        .gte('created_at', dayStart);
      const sentToday = (msgsToday ?? 0) - (repliesToday ?? 0);
      const q = Math.min(limit - ((enrolledToday ?? 0) - (emailOnlyToday.get(c.id) ?? 0)), limit - sentToday);
      if (q > 0) quotas.set(c.id, q);
    }

    const { data: cads } = await db.from('cadences').select('id, steps').in('id', [...new Set(list.map((c) => c.cadence_id))]);
    const usesWa = new Map<string, boolean>(((cads ?? []) as Row[]).map((c) => [c.id, ((c.steps ?? []) as Row[]).some((s) => s.type === 'send' && s.channel === 'whatsapp')]));
    const usesEmail = new Map<string, boolean>(((cads ?? []) as Row[]).map((c) => [c.id, ((c.steps ?? []) as Row[]).some((s) => s.type === 'send' && s.channel === 'email')]));

    // Cota extra para quem só tem e-mail (achado no site), nas campanhas WhatsApp + e-mail.
    const emailQuotas = new Map<string, number>();
    if (Deno.env.get('RESEND_API_KEY')) {
      for (const c of list) {
        if (c.channel === 'email' || !usesEmail.get(c.cadence_id)) continue;
        const limit = Number(c.daily_limit_email ?? EMAIL_ONLY_DAILY) || 0;
        if (limit <= 0) continue;
        const emailOnly = emailOnlyToday.get(c.id) ?? 0;
        if (limit - emailOnly > 0) emailQuotas.set(c.id, limit - emailOnly);
      }
    }
    if (!quotas.size && !emailQuotas.size) continue;

    // Base do dono: leads, empresas, quem já passou por campanha, opt-out e listas.
    const leads = await all(db, 'leads', 'id, company_id, stage, current_score, tags, email', (q) => q.eq('owner_id', owner));
    const comps = await all(db, 'companies', 'id, segment, city, whatsapp, phone, cnpj', (q) => q.eq('owner_id', owner));
    const enrolledEver = new Set((await all(db, 'enrollments', 'id, lead_id', (q) => q.eq('owner_id', owner))).map((e) => e.lead_id));
    const supp = await all(db, 'suppression_list', 'id, kind, value', (q) => q.eq('owner_id', owner));
    const compById = new Map(comps.map((c) => [c.id, c]));
    const suppressed = (c: Row, l: Row) =>
      supp.some(
        (s) =>
          (s.kind === 'phone' && (same(s.value, c.whatsapp) || same(s.value, c.phone))) ||
          (s.kind === 'email' && l.email && String(s.value).toLowerCase() === String(l.email).toLowerCase()) ||
          (s.kind === 'cnpj' && c.cnpj && digits(s.value) === digits(c.cnpj)),
      );
    const pool = leads
      .filter((l) => !enrolledEver.has(l.id) && !CLOSED.includes(l.stage))
      .sort((a, b) => Number(b.current_score ?? 0) - Number(a.current_score ?? 0));

    const taken = new Set<string>();
    const ordered = [...list].filter((c) => quotas.has(c.id) || emailQuotas.has(c.id)).sort((a, b) => specificity(b.audience) - specificity(a.audience));
    for (const c of ordered) {
      let left = quotas.get(c.id) ?? 0;
      let leftEmail = emailQuotas.get(c.id) ?? 0;
      const listId = c.audience?.listId as string | undefined;
      const inList = listId ? new Set((await all(db, 'lead_lists', 'list_id, lead_id', (q) => q.eq('list_id', listId))).map((x) => x.lead_id)) : null;
      const needWa = usesWa.get(c.cadence_id) ?? c.channel !== 'email';
      const picked: Row[] = [];
      for (const l of pool) {
        if (left <= 0 && leftEmail <= 0) break;
        if (taken.has(l.id)) continue;
        const comp = compById.get(l.company_id);
        if (!comp) continue;
        // Sem WhatsApp mas com e-mail: entra pela cota de e-mail (as etapas de WhatsApp são puladas).
        const emailOnly = needWa && !comp.whatsapp && !!l.email && emailQuotas.has(c.id);
        if (emailOnly ? leftEmail <= 0 : left <= 0) continue;
        if (!emailOnly && (needWa ? !comp.whatsapp : !l.email)) continue;
        if (!matchesAudience(c.audience, l, comp, inList) || suppressed(comp, l)) continue;
        picked.push(l);
        taken.add(l.id);
        if (emailOnly) leftEmail--;
        else left--;
      }
      if (!picked.length) continue;
      const at = now.toISOString();
      const rows = picked.map((l) => ({ owner_id: owner, campaign_id: c.id, cadence_id: c.cadence_id, lead_id: l.id, step_index: 0, status: 'ativa', next_run_at: at, started_at: at }));
      const { data: ins, error } = await db.from('enrollments').upsert(rows, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true }).select('lead_id');
      if (error) {
        console.error('feedCampaigns', c.id, error.message);
        continue;
      }
      const ids = ((ins ?? []) as Row[]).map((x) => x.lead_id as string);
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        await db.from('leads').update({ stage: 'em_cadencia' }).in('id', part).in('stage', FRESH_STAGES);
        await db.from('lead_activities').insert(
          part.map((lead_id) => ({ owner_id: owner, lead_id, type: 'campaign_enrolled', description: `Entrou automaticamente na campanha “${c.name}” (prospecção diária)`, payload: { campaignId: c.id, auto: true, daily: true }, actor_id: null })),
        );
      }
      sum.enrolled += ids.length;
      sum.campaigns++;
    }
  }
  return sum;
}
