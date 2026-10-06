// Número desconhecido escreveu no WhatsApp conectado (opção "Atender quem chama sem ser lead").
// Só vira lead quando a mensagem é claramente comercial; conversa pessoal não é gravada.

import { hasClaude, logRun, runTask } from '../ai/claude.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Origem dos leads que chegaram sozinhos pelo WhatsApp. */
export const INBOUND_ORIGIN = 'WhatsApp (chamou a empresa)';
/** Limite de leads criados assim por dia (proteção contra spam). */
export const MAX_INBOUND_LEADS_PER_DAY = 30;

const W = (re: string) => new RegExp(re.replace(/\\b/g, '(?<![\\p{L}\\p{N}])').replace(/\\e/g, '(?![\\p{L}\\p{N}])'), 'iu');

/**
 * Primeira peneira, sem IA: palavras de quem procura um serviço.
 * Sem nenhuma delas ("oi", "bom dia", conversa pessoal), a mensagem nem vai para a IA.
 */
const COMMERCIAL = W(
  [
    '\\bor[cç]amentos?\\e',
    '\\bpre[cç]os?\\e',
    '\\bvalor(?:es)?\\e',
    '\\bquanto (?:custa|cobra|sai|fica)',
    '\\bcota[cç][aã]o\\e',
    '\\bproposta\\e',
    '\\bcontratar\\e',
    '\\bcontrata[cç][aã]o\\e',
    '\\bservi[cç]os?\\e',
    '\\bplanos?\\e',
    '\\bpacotes?\\e',
    '\\bsites?\\e',
    '\\blanding',
    '\\bloja virtual\\e',
    '\\be-?commerce\\e',
    '\\bmarketing\\e',
    '\\btr[aá]fego\\e',
    '\\ban[uú]ncios?\\e',
    '\\bseo\\e',
    '\\bgoogle\\e',
    '\\bredes sociais\\e',
    '\\bsocial media\\e',
    '\\bidentidade visual\\e',
    '\\blogo(?:tipo|marca)?\\e',
    '\\bdivulga[cç][aã]o\\e',
    '\\bclientes?\\e',
    '\\bvendas?\\e',
    '\\bleads?\\e',
    '\\bgostaria de (?:saber|informa|entender|conhecer)',
    '\\bqueria (?:saber|informa|entender|conhecer|um|uma)',
    '\\bmais informa[cç][oõ]es\\e',
    '\\bvi (?:o|a|seu|sua|voc[eê]s|no|na)\\e',
    '\\bvim (?:pelo|pela|do|da)\\e',
    '\\bindica[cç][aã]o\\e',
    '\\bme indicaram\\e',
    '\\bvoc[eê]s (?:fazem|trabalham|atendem|t[eê]m)\\e',
  ].join('|'),
);

export function looksCommercial(text: string): boolean {
  return COMMERCIAL.test(text.replace(/^\[Áudio transcrito\]\s*/i, ''));
}

/** DDD → UF (para o cadastro mínimo, que exige estado). */
const DDD_UF: Record<string, string> = {
  ...Object.fromEntries(['11', '12', '13', '14', '15', '16', '17', '18', '19'].map((d) => [d, 'SP'])),
  ...Object.fromEntries(['21', '22', '24'].map((d) => [d, 'RJ'])),
  27: 'ES', 28: 'ES',
  ...Object.fromEntries(['31', '32', '33', '34', '35', '37', '38'].map((d) => [d, 'MG'])),
  ...Object.fromEntries(['41', '42', '43', '44', '45', '46'].map((d) => [d, 'PR'])),
  47: 'SC', 48: 'SC', 49: 'SC',
  ...Object.fromEntries(['51', '53', '54', '55'].map((d) => [d, 'RS'])),
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 87: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 88: 'CE', 86: 'PI', 89: 'PI',
  91: 'PA', 93: 'PA', 94: 'PA', 92: 'AM', 97: 'AM', 95: 'RR', 96: 'AP', 98: 'MA', 99: 'MA',
};

/** Número nacional (DDD + número) a partir do que o WhatsApp informa (55 + DDD + número). */
export function nationalDigits(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

export function ufFromPhone(national: string): string | null {
  return DDD_UF[national.slice(0, 2)] ?? null;
}

export function formatBr(national: string): string {
  const ddd = national.slice(0, 2);
  const n = national.slice(2);
  return `+55 ${ddd} ${n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}` : `${n.slice(0, 4)}-${n.slice(4)}`}`;
}

/** DDD + últimos 8 dígitos: o mesmo número com ou sem 55, 0, máscara ou o 9 extra do celular. */
const phoneMatchKey = (raw?: string | null) => {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? `${d.slice(0, 2)}${d.slice(-8)}` : null;
};
const samePhone = (a?: string | null, b?: string | null) => {
  const x = phoneMatchKey(a);
  return !!x && x === phoneMatchKey(b);
};

export interface Screening {
  commercial: boolean;
  reason: string;
  companyName: string | null;
  contactName: string | null;
  city: string | null;
}

/** Triagem: peneira de palavras e, quando há Claude, confirmação pela IA. */
export async function screen(db: Db, ownerId: string, text: string): Promise<Screening> {
  const no = (reason: string): Screening => ({ commercial: false, reason, companyName: null, contactName: null, city: null });
  if (!looksCommercial(text)) return no('sem sinal comercial');
  if (!hasClaude()) return { commercial: true, reason: 'palavras de pedido comercial', companyName: null, contactName: null, city: null };
  const { data: p } = await db.from('profiles').select('company_name, offer').eq('id', ownerId).maybeSingle();
  const started = Date.now();
  try {
    const run = await runTask<Screening>('screenInbound', { text: text.slice(0, 2000), company: p?.company_name, offer: p?.offer });
    await logRun(db, ownerId, 'screenInbound', started, 'ok', run.usage);
    return run.output;
  } catch (err) {
    await logRun(db, ownerId, 'screenInbound', started, 'error', {});
    console.error('screenInbound', err instanceof Error ? err.message : String(err));
    return no('triagem indisponível');
  }
}

/** A opção está ligada? Sem a coluna (migration não aplicada), fica desligada. */
export async function answersUnknown(db: Db, ownerId: string): Promise<boolean> {
  const { data, error } = await db.from('assistant_settings').select('answer_unknown').eq('owner_id', ownerId).maybeSingle().then(
    (r: { data: Row | null; error: unknown }) => r,
    (e: unknown) => ({ data: null, error: e }),
  );
  return !error && data?.answer_unknown === true;
}

export type UnknownResult = { leadId: string; created: boolean } | { leadId: null; reason: string };

/**
 * Número que não é lead escreveu. Ordem: opção ligada → não está no opt-out → já existe empresa
 * com esse telefone (o serviço ainda não sabia) → triagem comercial → limite do dia → cria empresa e lead.
 */
export async function handleUnknown(db: Db, ownerId: string, from: string, text: string, pushName?: string): Promise<UnknownResult> {
  if (!(await answersUnknown(db, ownerId))) return { leadId: null, reason: 'opção desligada' };
  // O WhatsApp informa sempre DDI + número: só números do Brasil (55).
  const national = /^55\d{10,11}$/.test(from) ? nationalDigits(from) : null;
  if (!national) return { leadId: null, reason: 'número fora do Brasil ou inválido' };

  const { data: supp } = await db.from('suppression_list').select('value').eq('owner_id', ownerId).eq('kind', 'phone');
  if (((supp ?? []) as Row[]).some((s) => samePhone(s.value, national))) return { leadId: null, reason: 'opt-out' };

  // Empresa com esse número que o serviço ainda não conhecia (lead criado há pouco).
  const { data: comps } = await db.from('companies').select('id, phone, whatsapp').eq('owner_id', ownerId);
  const known = ((comps ?? []) as Row[]).find((c) => samePhone(c.whatsapp, national) || samePhone(c.phone, national));
  if (known) {
    const { data: l } = await db.from('leads').select('id').eq('owner_id', ownerId).eq('company_id', known.id).maybeSingle();
    if (l) return { leadId: l.id, created: false };
  }

  const s = await screen(db, ownerId, text);
  if (!s.commercial) return { leadId: null, reason: s.reason };

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).eq('origin', INBOUND_ORIGIN).gte('created_at', since);
  if ((count ?? 0) >= MAX_INBOUND_LEADS_PER_DAY) return { leadId: null, reason: 'limite diário de leads novos pelo WhatsApp' };

  const at = new Date().toISOString();
  const cleanName = (pushName ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  const legal = s.companyName ?? (cleanName ? `${cleanName} (WhatsApp)` : `Contato WhatsApp ${formatBr(national)}`);
  const city = s.city ?? 'A identificar';
  const src = { provider: 'whatsapp', fetchedAt: at };
  const { data: company, error: e1 } = await db
    .from('companies')
    .insert({
      owner_id: ownerId,
      legal_name: legal,
      segment: 'A identificar',
      city,
      state: ufFromPhone(national) ?? 'SP',
      whatsapp: formatBr(national),
      phone: formatBr(national),
      whatsapp_status: 'confirmado',
      field_provenance: { whatsapp: src, phone: src, ...(s.companyName ? { legalName: src } : {}), ...(s.city ? { city: src } : {}) },
      dedupe_key: `tel:${national}:${city.toLowerCase()}`,
      created_by: null,
    })
    .select('id')
    .single();
  if (e1 || !company) throw new Error(e1?.message ?? 'falha ao criar empresa');
  const { data: lead, error: e2 } = await db
    .from('leads')
    .insert({ owner_id: ownerId, company_id: company.id, origin: INBOUND_ORIGIN, stage: 'novo', created_by: null, ...(s.contactName ? { contact_name: s.contactName } : {}) })
    .select('id')
    .single();
  if (e2 || !lead) {
    await db.from('companies').delete().eq('id', company.id);
    throw new Error(e2?.message ?? 'falha ao criar lead');
  }
  await db.from('lead_activities').insert({
    owner_id: ownerId,
    lead_id: lead.id,
    type: 'discovered',
    description: `Chamou no WhatsApp por conta própria: o Beelie criou o lead (${s.reason}).`,
    payload: { kind: 'inbound_lead', reason: s.reason },
    actor_id: null,
  });
  return { leadId: lead.id, created: true };
}
