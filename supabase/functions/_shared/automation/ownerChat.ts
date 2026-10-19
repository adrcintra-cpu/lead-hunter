// O BEELIE conversando com o DONO pelo WhatsApp pessoal dele:
// - o dono passa contatos (cartão, texto ou print) → o BEELIE cadastra e coloca na prospecção;
// - "relatório" / "como estamos?" → resumo do dia;
// - avisos de lead em potencial (orçamento, reunião, interesse, pedido de pessoa) e relatório diário.
// Só mensagens do número cadastrado em Configurações são tratadas como do dono.

import { hasClaude, logRun, runTask } from '../ai/claude.ts';
import { nextWindowStart, startOfDayBRT } from './planner.ts';
import { formatBr, nationalDigits, ufFromPhone } from './unknownInbound.ts';
import { DEFAULT_SEND_WINDOW, type SendWindow } from './types.ts';
import { HUNTER_ORIGIN } from './hunter.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Origem dos leads que o dono passou pelo WhatsApp. */
export const OWNER_ORIGIN = 'Indicado por você (WhatsApp)';
const PAGE = 1000;

export interface OwnerSettings {
  phone: string | null;
  alerts: boolean;
  reportHour: number | null;
  reportSentOn: string | null;
}

/** Configuração do canal do dono. Sem as colunas (migration não aplicada), fica desligado. */
export async function ownerSettings(db: Db, ownerId: string): Promise<OwnerSettings> {
  const off: OwnerSettings = { phone: null, alerts: false, reportHour: null, reportSentOn: null };
  const { data, error } = await db
    .from('assistant_settings')
    .select('owner_whatsapp, owner_alerts, owner_report_hour, owner_report_sent_on')
    .eq('owner_id', ownerId)
    .maybeSingle()
    .then(
      (r: { data: Row | null; error: unknown }) => r,
      (e: unknown) => ({ data: null, error: e }),
    );
  if (error || !data) return off;
  return {
    phone: typeof data.owner_whatsapp === 'string' && data.owner_whatsapp.trim() ? data.owner_whatsapp.trim() : null,
    alerts: data.owner_alerts !== false,
    reportHour: typeof data.owner_report_hour === 'number' ? data.owner_report_hour : null,
    reportSentOn: data.owner_report_sent_on ?? null,
  };
}

/** DDD + últimos 8 dígitos: o mesmo número com ou sem 55, 0, máscara ou o 9 extra. */
export function phoneKey(raw?: string | null): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? `${d.slice(0, 2)}${d.slice(-8)}` : null;
}
export const samePhone = (a?: string | null, b?: string | null) => {
  const x = phoneKey(a);
  return !!x && x === phoneKey(b);
};

// ---------- entender o pedido ----------

export interface OwnerContact {
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  role: string | null;
  note: string | null;
}
export interface OwnerIntent {
  intent: 'add_contacts' | 'add_context' | 'report' | 'question' | 'help' | 'other';
  contacts: OwnerContact[];
  /** Empresa ou pessoa citada numa pergunta. */
  lookup?: string | null;
  /** Complemento sobre o último contato que você passou (empresa, relação, como conheceu). */
  context?: { company: string | null; note: string | null };
}

/** Espera antes da primeira mensagem para um contato seu: dá tempo de você contar algo sobre ele. */
export const OWNER_CONTACT_DELAY_MIN = 10;

export interface LastOwnerContact {
  leadId: string;
  label: string;
  at: string;
}

/** O último contato que você passou (nas últimas 3 h), para complementos como "ele já é cliente". */
export async function lastOwnerContact(db: Db, ownerId: string, now = new Date()): Promise<LastOwnerContact | null> {
  const since = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const { data } = await db
    .from('lead_activities')
    .select('lead_id, payload, created_at')
    .eq('owner_id', ownerId)
    .eq('payload->>kind', 'owner_contact')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  const a = ((data ?? []) as Row[])[0];
  if (!a) return null;
  return { leadId: a.lead_id, label: String(a.payload?.label ?? 'o contato'), at: a.created_at };
}

const PHONE_RE = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** Sem IA: telefones no texto viram contatos; palavras de resumo pedem relatório. */
export function parseOwnerRules(text: string): OwnerIntent {
  const t = text.trim();
  const lines = t.split(/\n+/).map((l) => l.replace(/^\[(Contato compartilhado|Imagem)\]\s*/i, '').trim()).filter(Boolean);
  const contacts: OwnerContact[] = [];
  for (const line of lines) {
    const phones = line.match(PHONE_RE) ?? [];
    if (!phones.length) continue;
    const rest = line
      .replace(PHONE_RE, ' ')
      .replace(EMAIL_RE, ' ')
      .replace(/\s*[—–|,;-]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    contacts.push({ name: rest || null, company: null, phone: phones[0] ?? null, email: line.match(EMAIL_RE)?.[0] ?? null, city: null, role: null, note: null });
  }
  if (contacts.length) return { intent: 'add_contacts', contacts };
  if (/^(relat[oó]rio|resumo)\??$/i.test(t) || /^como (estamos|est[aã]o as coisas|vai a prospec[cç][aã]o|foi o dia)( hoje)?\??$/i.test(t) || /^(manda|me (manda|passa)|quero) (o )?(relat|resumo)/i.test(t)) return { intent: 'report', contacts: [] };
  if (/^(oi|ol[aá]|e a[ií]|bom dia|boa tarde|boa noite|ajuda|menu)\b[\s!.,?]*$/i.test(t)) return { intent: 'help', contacts: [] };
  if (/\?|^(quant|qual|quais|quem|como|quando|onde|por ?que|o que|me (diz|fala|conta)|tem |teve |algu[eé]m)/i.test(t)) return { intent: 'question', contacts: [] };
  if (/relat|resum|como (estamos|est[aá]|vai|foi|anda)|status|quente|resultado|n[uú]mero/i.test(t)) return { intent: 'report', contacts: [] };
  return { intent: 'help', contacts: [] };
}

export async function understand(db: Db, ownerId: string, text: string, last: LastOwnerContact | null = null, history?: string): Promise<OwnerIntent> {
  let rules = parseOwnerRules(text);
  // Sem telefone, logo depois de passar um contato: é complemento sobre ele.
  if (last && rules.intent === 'help' && text.trim().length > 15 && !/^(oi|ol[aá]|bom dia|boa tarde|boa noite|ajuda)\b/i.test(text.trim())) {
    rules = { intent: 'add_context', contacts: [], context: { company: null, note: text.trim().slice(0, 300) } };
  }
  if (!hasClaude()) return rules;
  const started = Date.now();
  try {
    const run = await runTask<OwnerIntent>('ownerCommand', { text: text.slice(0, 3000), history, last: last ? `${last.label} (há ${Math.max(1, Math.round((Date.now() - Date.parse(last.at)) / 60000))} min)` : undefined });
    await logRun(db, ownerId, 'ownerCommand', started, 'ok', run.usage);
    const out = run.output;
    // A IA nunca inventa telefone: só vale o que aparece na mensagem.
    const digitsIn = text.replace(/\D/g, '');
    out.contacts = out.contacts.filter((c) => !c.phone || digitsIn.includes(c.phone.replace(/\D/g, '').slice(-8)));
    if (out.intent === 'add_contacts' && !out.contacts.length && rules.contacts.length) return rules;
    // Contato sem telefone logo depois de outro: trata como complemento do último.
    if (out.intent === 'add_contacts' && last && out.contacts.length && out.contacts.every((c) => !c.phone && !c.email)) {
      const c = out.contacts[0];
      return { intent: 'add_context', contacts: [], context: { company: c.company ?? c.name, note: c.note ?? text.trim().slice(0, 300) } };
    }
    if (out.intent === 'add_context' && !last) return { intent: 'question', contacts: [], lookup: null };
    return out;
  } catch (err) {
    await logRun(db, ownerId, 'ownerCommand', started, 'error', {});
    console.error('ownerCommand', err instanceof Error ? err.message : String(err));
    return rules;
  }
}

// ---------- cadastrar e prospectar ----------

async function findCompanyByPhone(db: Db, ownerId: string, national: string): Promise<Row | undefined> {
  for (let from = 0; ; from += PAGE) {
    const { data } = await db.from('companies').select('id, phone, whatsapp').eq('owner_id', ownerId).order('id').range(from, from + PAGE - 1);
    const page = (data ?? []) as Row[];
    const hit = page.find((c) => samePhone(c.whatsapp, national) || samePhone(c.phone, national));
    if (hit || page.length < PAGE) return hit;
  }
}

/** Campanha para os contatos do dono: a "Prospecção" ativa; senão a ativa mais recente com WhatsApp. */
async function prospectingCampaign(db: Db, ownerId: string): Promise<Row | null> {
  const { data: camps } = await db.from('campaigns').select('id, name, cadence_id, created_at').eq('owner_id', ownerId).eq('status', 'ativa').order('created_at', { ascending: false });
  const list = (camps ?? []) as Row[];
  if (!list.length) return null;
  const { data: cads } = await db.from('cadences').select('id, steps').in('id', [...new Set(list.map((c) => c.cadence_id))]);
  const wa = new Set(((cads ?? []) as Row[]).filter((c) => ((c.steps ?? []) as Row[]).some((s) => s.type === 'send' && s.channel === 'whatsapp')).map((c) => c.id));
  return list.find((c) => c.name === 'Prospecção' && wa.has(c.cadence_id)) ?? list.find((c) => wa.has(c.cadence_id)) ?? null;
}

export interface AddResult {
  label: string;
  status: 'novo' | 'existente' | 'em_prospeccao' | 'opt_out' | 'invalido';
  leadId?: string;
}

/** Quem passou o contato: você (padrão) ou um lead que indicou outra pessoa na conversa. */
export interface AddSource {
  origin: string;
  /** Texto da atividade, ex.: "Você passou este contato pelo WhatsApp". */
  via: string;
  /** Tipo gravado na atividade ("owner_contact" é o que permite complementar pelo seu WhatsApp). */
  kind: string;
  notePrefix: string;
  campaignVia: string;
}
const FROM_OWNER: AddSource = {
  origin: OWNER_ORIGIN,
  via: 'Você passou este contato pelo WhatsApp',
  kind: 'owner_contact',
  notePrefix: 'Informação do dono da empresa',
  campaignVia: 'você passou pelo WhatsApp',
};

export async function addContacts(db: Db, ownerId: string, contacts: OwnerContact[], now = new Date(), from: AddSource = FROM_OWNER): Promise<{ results: AddResult[]; campaign: Row | null; when: Date }> {
  const { data: p } = await db.from('profiles').select('send_window').eq('id', ownerId).maybeSingle();
  const window: SendWindow = (p?.send_window as SendWindow) ?? DEFAULT_SEND_WINDOW;
  const start = new Date(now.getTime() + OWNER_CONTACT_DELAY_MIN * 60_000);
  const when = nextWindowStart(start, window);
  const campaign = await prospectingCampaign(db, ownerId);
  const { data: supp } = await db.from('suppression_list').select('kind, value').eq('owner_id', ownerId);
  const results: AddResult[] = [];
  const at = now.toISOString();

  for (const c of contacts.slice(0, 20)) {
    const national = c.phone ? nationalDigits(c.phone.replace(/\D/g, '').length <= 11 ? `55${c.phone.replace(/\D/g, '')}` : c.phone) : null;
    const label = [c.name, c.company].filter(Boolean).join(' · ') || (national ? formatBr(national) : c.email ?? 'contato');
    if (!national) {
      results.push({ label, status: 'invalido' });
      continue;
    }
    if (((supp ?? []) as Row[]).some((s) => (s.kind === 'phone' && samePhone(s.value, national)) || (s.kind === 'email' && c.email && String(s.value).toLowerCase() === c.email.toLowerCase()))) {
      results.push({ label, status: 'opt_out' });
      continue;
    }
    let leadId: string | null = null;
    let created = false;
    const known = await findCompanyByPhone(db, ownerId, national);
    if (known) {
      const { data: l } = await db.from('leads').select('id').eq('owner_id', ownerId).eq('company_id', known.id).maybeSingle();
      leadId = l?.id ?? null;
    }
    if (!leadId) {
      const city = c.city ?? 'A identificar';
      const src = { provider: 'owner_whatsapp', fetchedAt: at };
      const companyId =
        known?.id ??
        (
          await db
            .from('companies')
            .insert({
              owner_id: ownerId,
              legal_name: c.company ?? c.name ?? `Contato ${formatBr(national)}`,
              segment: 'A identificar',
              city,
              state: ufFromPhone(national) ?? 'SP',
              whatsapp: formatBr(national),
              phone: formatBr(national),
              whatsapp_status: national.length === 11 ? 'provavel' : 'desconhecido',
              field_provenance: { whatsapp: src, phone: src, ...(c.company ? { legalName: src } : {}), ...(c.city ? { city: src } : {}) },
              dedupe_key: `tel:${national}:${city.toLowerCase()}`,
              created_by: null,
            })
            .select('id')
            .single()
        ).data?.id;
      if (!companyId) {
        results.push({ label, status: 'invalido' });
        continue;
      }
      const { data: lead, error } = await db
        .from('leads')
        .insert({ owner_id: ownerId, company_id: companyId, origin: from.origin, stage: 'novo', created_by: null, ...(c.name ? { contact_name: c.name } : {}), ...(c.role ? { contact_role: c.role } : {}), ...(c.email ? { email: c.email } : {}) })
        .select('id')
        .single();
      if (error || !lead) {
        results.push({ label, status: 'invalido' });
        continue;
      }
      leadId = lead.id as string;
      created = true;
    }
    await db.from('lead_activities').insert({
      owner_id: ownerId,
      lead_id: leadId,
      type: created ? 'discovered' : 'lead_updated',
      description: `${from.via}${c.note ? `: ${c.note}` : ''}.`,
      payload: { kind: from.kind, note: c.note, label },
      actor_id: null,
    });
    // O que você contou vira observação do lead: o BEELIE usa na abordagem.
    if (c.note) await db.from('lead_notes').insert({ owner_id: ownerId, lead_id: leadId, body: `${from.notePrefix}: ${c.note}`, created_by: null });
    // Já está em alguma campanha em andamento?
    const { data: busy } = await db.from('enrollments').select('id').eq('lead_id', leadId).in('status', ['ativa', 'pausada', 'pendente']).limit(1);
    if (busy?.length) {
      results.push({ label, status: 'em_prospeccao', leadId });
      continue;
    }
    if (campaign) {
      const { error } = await db
        .from('enrollments')
        .upsert({ owner_id: ownerId, campaign_id: campaign.id, cadence_id: campaign.cadence_id, lead_id: leadId, step_index: 0, status: 'ativa', next_run_at: when.toISOString(), started_at: at }, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true });
      if (!error) {
        await db.from('leads').update({ stage: 'em_cadencia' }).eq('id', leadId).in('stage', ['novo', 'qualificado']);
        await db.from('lead_activities').insert({ owner_id: ownerId, lead_id: leadId, type: 'campaign_enrolled', description: `Entrou na campanha “${campaign.name}” (${from.campaignVia})`, payload: { campaignId: campaign.id, auto: true, owner: from.kind === 'owner_contact', referral: from.kind === 'referral' }, actor_id: null });
      }
    }
    results.push({ label, status: created ? 'novo' : 'existente', leadId });
  }
  return { results, campaign, when };
}

const hhmm = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dayLabel = (d: Date, now: Date) => {
  const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return fmt(d) === fmt(now) ? 'hoje' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
};

export function addReply(r: { results: AddResult[]; campaign: Row | null; when: Date }, now = new Date()): string {
  const by = (s: AddResult['status']) => r.results.filter((x) => x.status === s);
  const lines: string[] = [];
  const queued = [...by('novo'), ...by('existente')];
  if (queued.length) {
    const names = queued.map((x) => x.label).join(', ');
    if (r.campaign) {
      const soon = r.when.getTime() <= now.getTime() + (OWNER_CONTACT_DELAY_MIN + 1) * 60_000;
      const quando = soon ? `em uns ${OWNER_CONTACT_DELAY_MIN} minutos` : `${dayLabel(r.when, now)} às ${hhmm(r.when)}`;
      lines.push(
        `Feito! ${queued.length === 1 ? 'Cadastrei' : `Cadastrei ${queued.length} contatos:`} ${names}. A primeira mensagem sai ${quando}, na campanha “${r.campaign.name}”. Se quiser, me conte algo sobre ${queued.length === 1 ? 'ele' : 'eles'} antes (empresa, se já é cliente, como conheceu) que eu uso na abordagem.`,
      );
    } else {
      lines.push(`Cadastrei ${names}, mas não há campanha ativa com WhatsApp para prospectar. Ative a campanha “Prospecção” no Lead Hunter que eu começo.`);
    }
  }
  if (by('em_prospeccao').length) lines.push(`Já estão em prospecção: ${by('em_prospeccao').map((x) => x.label).join(', ')}.`);
  if (by('opt_out').length) lines.push(`Não vou chamar ${by('opt_out').map((x) => x.label).join(', ')}: pediu para não receber mensagens.`);
  if (by('invalido').length) lines.push(`Não consegui cadastrar ${by('invalido').map((x) => x.label).join(', ')}: preciso de um telefone com DDD.`);
  return lines.join('\n') || 'Não encontrei nenhum contato na mensagem. Me mande nome, empresa e telefone com DDD (ou o cartão do contato).';
}

// ---------- relatório ----------

async function count(q: Row): Promise<number> {
  const { count: n } = await q;
  return n ?? 0;
}

export async function buildReport(db: Db, ownerId: string, now = new Date()): Promise<string> {
  const since = startOfDayBRT(now).toISOString();
  const head = { count: 'exact', head: true };
  const [enrolled, sent, replies, openTasks, found] = await Promise.all([
    count(db.from('enrollments').select('id', head).eq('owner_id', ownerId).gte('created_at', since)),
    count(db.from('messages').select('id', head).eq('owner_id', ownerId).eq('channel', 'whatsapp').not('campaign_id', 'is', null).gte('sent_at', since)),
    count(db.from('inbound_messages').select('id', head).eq('owner_id', ownerId).gte('received_at', since)),
    count(db.from('tasks').select('id', head).eq('owner_id', ownerId).eq('status', 'aberta')),
    count(db.from('leads').select('id', head).eq('owner_id', ownerId).eq('origin', HUNTER_ORIGIN).gte('created_at', since)),
  ]);
  const { data: hot } = await db
    .from('inbound_messages')
    .select('lead_id, classification, summary, leads(contact_name, companies(legal_name, trade_name))')
    .eq('owner_id', ownerId)
    .in('classification', ['interessado', 'reuniao'])
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(20);
  const seen = new Set<string>();
  const hotLines: string[] = [];
  for (const h of (hot ?? []) as Row[]) {
    if (seen.has(h.lead_id)) continue;
    seen.add(h.lead_id);
    const c = h.leads?.companies;
    const name = c?.trade_name || c?.legal_name || 'Lead';
    const who = h.leads?.contact_name ? ` (${h.leads.contact_name})` : '';
    hotLines.push(`• ${name}${who}: ${h.classification === 'reuniao' ? 'quer conversar' : 'interessado'}${h.summary ? ` — ${String(h.summary).slice(0, 90)}` : ''}`);
    if (hotLines.length >= 5) break;
  }
  const date = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
  return [
    `📊 Resumo de ${date}`,
    `${enrolled} ${enrolled === 1 ? 'novo' : 'novos'} na prospecção · ${sent} ${sent === 1 ? 'mensagem enviada' : 'mensagens enviadas'} · ${replies} ${replies === 1 ? 'resposta recebida' : 'respostas recebidas'} · ${seen.size} em potencial`,
    found ? `🔎 Encontrei ${found} ${found === 1 ? 'empresa nova' : 'empresas novas'} na busca automática.` : '',
    hotLines.length ? `\n🔥 Em potencial:\n${hotLines.join('\n')}` : '',
    openTasks ? `\n📝 ${openTasks} ${openTasks === 1 ? 'tarefa aberta precisa' : 'tarefas abertas precisam'} de você (Lead Hunter → Tarefas).` : '\n✅ Nenhuma tarefa esperando você.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const HELP = [
  'Oi! Sou o BEELIE. Por aqui você pode:',
  '• Me passar contatos para prospectar: mande o cartão do contato, um print do cartão de visita ou escreva nome, empresa e telefone (ex.: "João, Metalúrgica Silva, 19 99999-0000, conheci na feira").',
  '• Pedir um resumo: "relatório" ou "como estamos?".',
  '• Perguntar o que quiser, por texto ou áudio: "quem respondeu hoje?", "e a Clínica Sorriso?", "quais tarefas tenho?", "o que você sugere?".',
  'Também te aviso aqui quando aparecer lead em potencial e mando o resumo do dia.',
].join('\n');

const PLACEHOLDER_NAME = /^Contato \+?55/;

/** Complemento sobre o último contato: vira observação (o BEELIE usa na abordagem) e, se veio, o nome da empresa. */
export async function addContext(db: Db, ownerId: string, last: LastOwnerContact, ctx: { company: string | null; note: string | null }, text: string): Promise<string> {
  const note = (ctx.note ?? text).trim().slice(0, 300);
  await db.from('lead_notes').insert({ owner_id: ownerId, lead_id: last.leadId, body: `Informação do dono da empresa: ${note}`, created_by: null });
  const { data: l } = await db.from('leads').select('id, contact_name, company_id').eq('id', last.leadId).maybeSingle();
  let label = last.label;
  if (ctx.company && l?.company_id) {
    const { data: c } = await db.from('companies').select('legal_name, trade_name').eq('id', l.company_id).maybeSingle();
    const legal = String(c?.legal_name ?? '');
    // O nome da empresa só substitui o provisório (nome da pessoa ou "Contato +55...").
    const provisional = PLACEHOLDER_NAME.test(legal) || (!!l.contact_name && legal.trim() === String(l.contact_name).trim()) || legal.trim() === last.label.trim();
    await db.from('companies').update({ trade_name: ctx.company, ...(provisional ? { legal_name: ctx.company } : {}) }).eq('id', l.company_id);
    label = `${l.contact_name ?? last.label} (${ctx.company})`;
  }
  await db.from('lead_activities').insert({ owner_id: ownerId, lead_id: last.leadId, type: 'lead_updated', description: `Você contou pelo WhatsApp: ${note}`, payload: { kind: 'owner_context' }, actor_id: null });
  const { count: sent } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('lead_id', last.leadId).not('sent_at', 'is', null);
  return sent
    ? `Anotado sobre ${label}: ${note}. A primeira mensagem já tinha saído; uso isso daqui pra frente na conversa.`
    : `Anotado sobre ${label}: ${note}. Vou usar isso na primeira mensagem.`;
}

/** Áudio seu que não deu para transcrever (o serviço manda só este aviso). */
export const AUDIO_FAILED = 'Não consegui ouvir esse áudio agora. Pode mandar de novo ou escrever?';

/** Mensagem do dono: entende o pedido e devolve a resposta. `history` = conversa recente com ele. */
export async function handleOwnerMessage(db: Db, ownerId: string, text: string, now = new Date(), history?: string): Promise<string> {
  if (/^\[Áudio recebido/i.test(text.trim())) return AUDIO_FAILED;
  const last = await lastOwnerContact(db, ownerId, now);
  const it = await understand(db, ownerId, text, last, history);
  if (it.intent === 'add_context' && last) return addContext(db, ownerId, last, it.context ?? { company: null, note: null }, text);
  if (it.intent === 'add_contacts') return addReply(await addContacts(db, ownerId, it.contacts, now), now);
  if (it.intent === 'report') return buildReport(db, ownerId, now);
  // Pergunta nunca recebe o menu de ajuda: mesmo se a IA classificar como "ajuda".
  const asked = it.intent === 'question' || (it.intent === 'other' && text.trim().length > 3) || (it.intent === 'help' && parseOwnerRules(text).intent === 'question');
  if (asked) {
    const r = await answerOwner(db, ownerId, text, it.lookup ?? null, now, history);
    if (r.answer) return r.answer;
    return `Não consegui montar a resposta agora${r.error ? ` (${r.error})` : ''}. Enquanto isso, o resumo de hoje:\n\n${await buildReport(db, ownerId, now)}`;
  }
  return HELP;
}

// ---------- responder perguntas ----------

const brDate = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const CLASS_LABEL: Record<string, string> = { interessado: 'interessado', reuniao: 'quer conversar', duvida: 'dúvida/informações', nao_interessado: 'não interessado', opt_out: 'pediu para parar', ausente: 'resposta automática', outro: 'respondeu' };

/** Resumo dos dados reais para a IA responder sem inventar. */
export async function ownerPanel(db: Db, ownerId: string, lookup: string | null, now = new Date()): Promise<string> {
  const head = { count: 'exact', head: true };
  const week = new Date(now.getTime() - 7 * 864e5).toISOString();
  const parts: string[] = [];
  parts.push(`Hoje (${now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' })}):\n${await buildReport(db, ownerId, now)}`);

  const [sent7, replies7, leadsTotal, fresh] = await Promise.all([
    count(db.from('messages').select('id', head).eq('owner_id', ownerId).not('sent_at', 'is', null).gte('sent_at', week)),
    count(db.from('inbound_messages').select('id', head).eq('owner_id', ownerId).gte('received_at', week)),
    count(db.from('leads').select('id', head).eq('owner_id', ownerId)),
    count(db.from('leads').select('id', head).eq('owner_id', ownerId).in('stage', ['novo', 'qualificado'])),
  ]);
  parts.push(`Últimos 7 dias: ${sent7} mensagens enviadas, ${replies7} respostas. Base: ${leadsTotal} leads, ${fresh} ainda não abordados.`);

  const { data: recent } = await db
    .from('inbound_messages')
    .select('classification, summary, received_at, leads(contact_name, stage, companies(legal_name, trade_name, city))')
    .eq('owner_id', ownerId)
    .gte('received_at', week)
    .order('received_at', { ascending: false })
    .limit(15);
  const lines = ((recent ?? []) as Row[]).map((r) => {
    const c = r.leads?.companies;
    const who = `${c?.trade_name || c?.legal_name || 'Lead'}${r.leads?.contact_name ? ` (${r.leads.contact_name})` : ''}${c?.city ? `, ${c.city}` : ''}`;
    return `• ${brDate(r.received_at)} ${who}: ${CLASS_LABEL[r.classification] ?? r.classification}${r.summary ? ` — ${String(r.summary).slice(0, 100)}` : ''}`;
  });
  if (lines.length) parts.push(`Respostas recentes (mais nova primeiro):\n${lines.join('\n')}`);

  const { data: tasks } = await db.from('tasks').select('title, due_at').eq('owner_id', ownerId).eq('status', 'aberta').order('due_at', { ascending: true }).limit(10);
  if ((tasks ?? []).length) parts.push(`Tarefas abertas:\n${((tasks ?? []) as Row[]).map((t) => `• ${t.title}`).join('\n')}`);

  const { data: camps } = await db.from('campaigns').select('name, status, daily_limit_whatsapp, auto_enroll').eq('owner_id', ownerId).order('created_at', { ascending: true });
  if ((camps ?? []).length)
    parts.push(`Campanhas:\n${((camps ?? []) as Row[]).map((c) => `• ${c.name}: ${c.status}${c.daily_limit_whatsapp ? `, até ${c.daily_limit_whatsapp} por dia` : ''}${c.auto_enroll ? ', entrada automática' : ''}`).join('\n')}`);

  const { data: hs } = await db
    .from('assistant_settings')
    .select('hunter_enabled, hunter_today, hunter_day')
    .eq('owner_id', ownerId)
    .maybeSingle()
    .then(
      (r: { data: Row | null }) => r,
      () => ({ data: null }),
    );
  if (hs) {
    const { data: srch } = await db.from('searches').select('raw_query, new_count, created_at').eq('owner_id', ownerId).like('raw_query', 'BEELIE:%').order('created_at', { ascending: false }).limit(3);
    const recentS = ((srch ?? []) as Row[]).map((x) => `${String(x.raw_query).replace(/^BEELIE:\s*/, '')} (${x.new_count} novas, ${brDate(x.created_at)})`).join('; ');
    parts.push(`Busca automática: ${hs.hunter_enabled ? 'ligada' : 'desligada'}${recentS ? `. Últimas: ${recentS}` : '. Nenhuma busca ainda'}.`);
  }

  if (lookup && lookup.trim().length >= 3) parts.push(await leadDetails(db, ownerId, lookup.trim()));
  return parts.join('\n\n').slice(0, 9000);
}

/** Detalhes de um lead citado na pergunta (até 2 empresas com o nome). */
async function leadDetails(db: Db, ownerId: string, q: string): Promise<string> {
  const like = `%${q.replace(/[%_,()"\\]/g, ' ').trim()}%`;
  const { data: byCo } = await db.from('companies').select('id, legal_name, trade_name, city, state, segment, whatsapp').eq('owner_id', ownerId).or(`legal_name.ilike."${like}",trade_name.ilike."${like}"`).limit(2);
  let companies = (byCo ?? []) as Row[];
  if (!companies.length) {
    const { data: byPerson } = await db.from('leads').select('company_id').eq('owner_id', ownerId).ilike('contact_name', like).limit(2);
    const ids = ((byPerson ?? []) as Row[]).map((x) => x.company_id);
    if (ids.length) companies = (((await db.from('companies').select('id, legal_name, trade_name, city, state, segment, whatsapp').in('id', ids)).data ?? []) as Row[]);
  }
  if (!companies.length) return `Busca por "${q}": nenhum lead com esse nome na base.`;
  const out: string[] = [];
  for (const c of companies) {
    const { data: lead } = await db.from('leads').select('id, stage, current_score, contact_name, contact_role, next_action, last_contact_at').eq('owner_id', ownerId).eq('company_id', c.id).maybeSingle();
    const head = `Lead "${c.trade_name || c.legal_name}" (${c.segment}, ${c.city}/${c.state})`;
    if (!lead) {
      out.push(`${head}: empresa sem lead.`);
      continue;
    }
    const [{ data: msgs }, { data: ins }] = await Promise.all([
      db.from('messages').select('final_content, generated_content, sent_at').eq('lead_id', lead.id).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(4),
      db.from('inbound_messages').select('body, received_at').eq('lead_id', lead.id).order('received_at', { ascending: false }).limit(4),
    ]);
    const convo = [
      ...((msgs ?? []) as Row[]).map((m) => ({ at: m.sent_at, t: `BEELIE: ${String(m.final_content || m.generated_content || '').slice(0, 220)}` })),
      ...((ins ?? []) as Row[]).map((m) => ({ at: m.received_at, t: `Lead: ${String(m.body ?? '').slice(0, 220)}` })),
    ]
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((x) => `  ${brDate(x.at)} ${x.t}`);
    out.push(
      [
        `${head}: etapa ${lead.stage}, score ${lead.current_score}${lead.contact_name ? `, contato ${lead.contact_name}${lead.contact_role ? ` (${lead.contact_role})` : ''}` : ''}${lead.next_action ? `, próxima ação: ${lead.next_action}` : ''}.`,
        convo.length ? `Conversa (mais antiga primeiro):\n${convo.join('\n')}` : 'Ainda sem conversa.',
      ].join('\n'),
    );
  }
  return out.join('\n\n');
}

/** Responde uma pergunta sua com os dados reais. Sem IA ou com falha, devolve o motivo (curto). */
export async function answerOwner(db: Db, ownerId: string, text: string, lookup: string | null, now = new Date(), history?: string): Promise<{ answer: string | null; error?: string }> {
  if (!hasClaude()) return { answer: null, error: 'IA não configurada no servidor' };
  const started = Date.now();
  let step = 'dados';
  try {
    const panel = await ownerPanel(db, ownerId, lookup, now);
    step = 'IA';
    const run = await runTask<string>('ownerAsk', { text: text.slice(0, 2000), panel, history });
    await logRun(db, ownerId, 'ownerAsk', started, 'ok', run.usage);
    const answer = String(run.output ?? '').trim().slice(0, 3000);
    return answer ? { answer } : { answer: null, error: 'IA respondeu vazio' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logRun(db, ownerId, 'ownerAsk', started, 'error', {});
    console.error('ownerAsk', step, msg);
    // Motivo curto, sem detalhes técnicos longos.
    return { answer: null, error: `falha ao ${step === 'IA' ? 'consultar a IA' : 'ler os dados'}: ${msg.replace(/\s+/g, ' ').slice(0, 140)}` };
  }
}

// ---------- avisos e relatório diário ----------

const ALERT_CATEGORIES: Record<string, string> = {
  orcamento: 'pediu orçamento',
  reuniao: 'quer uma conversa',
  interessado: 'demonstrou interesse',
};

/**
 * Texto do aviso de lead em potencial (ou null). Avisa uma vez por lead e assunto a cada 12 h.
 * Também avisa quando a conversa precisa de você (pedido para falar com uma pessoa, contato indicado).
 */
export async function leadAlert(db: Db, ownerId: string, leadId: string, info: { category?: string; summary?: string; taskTitle?: string | null }, now = new Date()): Promise<string | null> {
  const s = await ownerSettings(db, ownerId);
  if (!s.phone || !s.alerts) return null;
  const why = info.category && ALERT_CATEGORIES[info.category] ? ALERT_CATEGORIES[info.category] : info.taskTitle && /^(Falar com|Agendar reunião|Enviar orçamento)/i.test(info.taskTitle) ? info.taskTitle : null;
  if (!why) return null;
  const since = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const { count: already } = await db
    .from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('payload->>kind', 'owner_alert')
    .eq('payload->>why', why)
    .gte('created_at', since);
  if (already) return null;
  const { data: l } = await db.from('leads').select('contact_name, companies(legal_name, trade_name, city)').eq('id', leadId).maybeSingle();
  const c = l?.companies;
  const name = c?.trade_name || c?.legal_name || 'Um lead';
  const who = l?.contact_name ? ` (${l.contact_name})` : '';
  await db.from('lead_activities').insert({ owner_id: ownerId, lead_id: leadId, type: 'lead_updated', description: `Aviso enviado para o seu WhatsApp: ${why}.`, payload: { kind: 'owner_alert', why }, actor_id: null });
  return `🔥 ${name}${who}${c?.city ? `, ${c.city}` : ''} ${why}.${info.summary ? `\n“${info.summary.slice(0, 160)}”` : ''}\nVeja no Lead Hunter → Tarefas.`;
}

const svcUrl = () => (Deno.env.get('WHATSAPP_SERVICE_URL') ?? '').trim().replace(/\/+$/, '');
const svcSecret = () => (Deno.env.get('WHATSAPP_INBOUND_SECRET') ?? '').trim();

/** Manda uma mensagem para o WhatsApp do dono (o serviço confere o número salvo). */
export async function notifyOwner(ownerId: string, text: string): Promise<boolean> {
  if (!svcUrl() || !svcSecret()) return false;
  try {
    const res = await fetch(`${svcUrl()}/internal/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': svcSecret() },
      body: JSON.stringify({ ownerId, text: text.slice(0, 3500) }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Relatório diário: dias úteis, na hora escolhida, uma vez por dia. Chamado pelo cadence-runner. */
export async function sendDailyReports(db: Db, now = new Date()): Promise<number> {
  const local = new Date(now.getTime() - 3 * 3600_000);
  const hour = local.getUTCHours();
  const day = local.getUTCDay();
  if (day === 0 || day === 6) return 0;
  const today = local.toISOString().slice(0, 10);
  const { data, error } = await db
    .from('assistant_settings')
    .select('owner_id, owner_whatsapp, owner_report_hour, owner_report_sent_on')
    .not('owner_whatsapp', 'is', null)
    .eq('owner_report_hour', hour)
    .then(
      (r: { data: Row[] | null; error: unknown }) => r,
      (e: unknown) => ({ data: null, error: e }),
    );
  if (error || !data) return 0;
  let sent = 0;
  for (const s of data as Row[]) {
    if (s.owner_report_sent_on === today || !String(s.owner_whatsapp ?? '').trim()) continue;
    // Marca antes de enviar: o runner roda a cada 5 min e não pode mandar duas vezes.
    const { data: claimed } = await db.from('assistant_settings').update({ owner_report_sent_on: today }).eq('owner_id', s.owner_id).or(`owner_report_sent_on.is.null,owner_report_sent_on.neq.${today}`).select('owner_id');
    if (!claimed?.length) continue;
    if (await notifyOwner(s.owner_id, await buildReport(db, s.owner_id, now))) sent++;
  }
  return sent;
}

