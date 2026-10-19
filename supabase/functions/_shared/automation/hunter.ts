// Busca automática do BEELIE (no servidor, sem depender do app aberto).
// Quando a fila de leads novos com WhatsApp fica baixa, o BEELIE busca empresas no Google Places,
// alternando segmento e cidade pelo Brasil todo. Só empresas novas viram leads (sem duplicar as que
// você já tem) e o "feeder" coloca esses leads nas campanhas com entrada automática.
// Segmentos excluídos (ex.: agências de marketing) não são buscados e empresas com esses termos no
// nome são descartadas.

import { searchPlaces } from '../providers/googlePlaces.ts';
import { enrichWhatsapp, newBudget } from '../providers/waVerify.ts';
import type { RawCompany, SearchCriteria } from '../providers/types.ts';
import { SEGMENTS } from './segments.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const PAGE = 1000;
export const HUNTER_ORIGIN = 'Busca automática do BEELIE';
/** No máximo estas buscas por dia (cada uma consulta o Google Places). */
export const HUNTER_MAX_PER_DAY = 12;
/** Fila mínima de leads novos: o maior entre isto e 3 dias do limite diário das campanhas. */
const MIN_POOL = 30;
/** Excluídos por padrão: concorrentes da OXYCOM. */
export const DEFAULT_HUNTER_EXCLUDED = ['Agência de marketing', 'Agência de propaganda', 'Estúdio audiovisual', 'Produtora de vídeo'];

/** Maiores cidades do Brasil (capitais e polos regionais). A rotação passa por todas antes de repetir. */
export const BR_CITIES: [string, string][] = [
  ['São Paulo', 'SP'], ['Rio de Janeiro', 'RJ'], ['Brasília', 'DF'], ['Belo Horizonte', 'MG'], ['Curitiba', 'PR'], ['Porto Alegre', 'RS'],
  ['Salvador', 'BA'], ['Fortaleza', 'CE'], ['Recife', 'PE'], ['Goiânia', 'GO'], ['Campinas', 'SP'], ['Manaus', 'AM'],
  ['Belém', 'PA'], ['Florianópolis', 'SC'], ['Ribeirão Preto', 'SP'], ['São José dos Campos', 'SP'], ['Sorocaba', 'SP'], ['Uberlândia', 'MG'],
  ['Joinville', 'SC'], ['Londrina', 'PR'], ['Maringá', 'PR'], ['Santos', 'SP'], ['Jundiaí', 'SP'], ['Piracicaba', 'SP'],
  ['Limeira', 'SP'], ['Americana', 'SP'], ['São Luís', 'MA'], ['Maceió', 'AL'], ['Natal', 'RN'], ['João Pessoa', 'PB'],
  ['Teresina', 'PI'], ['Aracaju', 'SE'], ['Campo Grande', 'MS'], ['Cuiabá', 'MT'], ['Vitória', 'ES'], ['Vila Velha', 'ES'],
  ['Guarulhos', 'SP'], ['Osasco', 'SP'], ['Santo André', 'SP'], ['São Bernardo do Campo', 'SP'], ['Mogi das Cruzes', 'SP'], ['Bauru', 'SP'],
  ['São José do Rio Preto', 'SP'], ['Franca', 'SP'], ['Araraquara', 'SP'], ['São Carlos', 'SP'], ['Indaiatuba', 'SP'], ['Rio Claro', 'SP'],
  ['Sumaré', 'SP'], ['Hortolândia', 'SP'], ['Presidente Prudente', 'SP'], ['Marília', 'SP'], ['Niterói', 'RJ'], ['Campos dos Goytacazes', 'RJ'],
  ['Petrópolis', 'RJ'], ['Volta Redonda', 'RJ'], ['Juiz de Fora', 'MG'], ['Contagem', 'MG'], ['Betim', 'MG'], ['Montes Claros', 'MG'],
  ['Uberaba', 'MG'], ['Ipatinga', 'MG'], ['Governador Valadares', 'MG'], ['Divinópolis', 'MG'], ['Poços de Caldas', 'MG'], ['Ponta Grossa', 'PR'],
  ['Cascavel', 'PR'], ['Foz do Iguaçu', 'PR'], ['Blumenau', 'SC'], ['Itajaí', 'SC'], ['Chapecó', 'SC'], ['Criciúma', 'SC'],
  ['Balneário Camboriú', 'SC'], ['Caxias do Sul', 'RS'], ['Pelotas', 'RS'], ['Canoas', 'RS'], ['Santa Maria', 'RS'], ['Passo Fundo', 'RS'],
  ['Novo Hamburgo', 'RS'], ['Anápolis', 'GO'], ['Aparecida de Goiânia', 'GO'], ['Rio Verde', 'GO'], ['Dourados', 'MS'], ['Rondonópolis', 'MT'],
  ['Sinop', 'MT'], ['Feira de Santana', 'BA'], ['Vitória da Conquista', 'BA'], ['Camaçari', 'BA'], ['Juazeiro do Norte', 'CE'], ['Caruaru', 'PE'],
  ['Petrolina', 'PE'], ['Jaboatão dos Guararapes', 'PE'], ['Campina Grande', 'PB'], ['Mossoró', 'RN'], ['Imperatriz', 'MA'], ['Parnaíba', 'PI'],
  ['Arapiraca', 'AL'], ['Palmas', 'TO'], ['Porto Velho', 'RO'], ['Rio Branco', 'AC'], ['Macapá', 'AP'], ['Boa Vista', 'RR'],
  ['Santarém', 'PA'], ['Marabá', 'PA'], ['Serra', 'ES'], ['Cariacica', 'ES'],
];

export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');

// ---------- o que buscar ----------

/** Segmentos que o BEELIE busca: a lista toda menos os excluídos. */
export function huntSegments(excluded: string[]): string[] {
  const ex = excluded.map(norm).filter(Boolean);
  return SEGMENTS.flatMap((g) => g.items).filter((s) => {
    const k = norm(s);
    return !ex.some((e) => k === e || k.includes(e) || e.includes(k));
  });
}

/** Termos no nome que denunciam um segmento excluído (o Google mistura resultados). */
const NAME_FILTERS: { when: RegExp; re: RegExp }[] = [
  { when: /marketing|propaganda|publicidade|agencia/, re: /(marketing|propaganda|publicidade|publicit|ag[eê]ncia (digital|de comunica)|comunica[cç][aã]o visual|m[ií]dia digital)/i },
  { when: /audiovisual|video|produtora|filmagem/, re: /(audiovisual|[aá]udio ?visual|produtora|filmes|filmagem|est[uú]dio de (v[ií]deo|[aá]udio|grava[cç][aã]o))/i },
];
/** Órgãos e instituições públicas: não compram serviço por WhatsApp (licitação). */
const PUBLIC_RE = /(universidade (federal|estadual)|instituto federal|\bfatec\b|\betec\b|prefeitura|secretaria (municipal|estadual|de)|c[aâ]mara municipal|escola (estadual|municipal)|\bcolegio estadual|\bemef\b|\bemei\b|\bubs\b|tribunal|minist[eé]rio|governo do estado|\bdetran\b|\bsenai\b|\bsesi\b|\bsenac\b|\bsesc\b)/i;

export function excludedByName(name: string, excluded: string[]): boolean {
  if (PUBLIC_RE.test(norm(name))) return true;
  const n = norm(name);
  for (const e of excluded.map(norm).filter(Boolean)) {
    if (e.length >= 6 && n.includes(e)) return true;
    for (const f of NAME_FILTERS) if (f.when.test(e) && f.re.test(name)) return true;
  }
  return false;
}

/**
 * A busca número `k` da rotação: troca de cidade a cada busca e passa por todos os pares
 * (cidade, segmento) antes de repetir.
 */
export function pickTarget(k: number, segments: string[], cities: [string, string][] = BR_CITIES): { segment: string; city: string; state: string } {
  const C = cities.length;
  const S = Math.max(1, segments.length);
  const i = ((k % (C * S)) + C * S) % (C * S);
  const c = i % C;
  const q = Math.floor(i / C);
  const [city, state] = cities[c];
  return { segment: segments[(q + c) % S], city, state };
}

// ---------- identidade (mesma empresa?) ----------

function phoneKey(raw?: string | null): string | null {
  let d = digits(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? `${d.slice(0, 2)}${d.slice(-8)}` : null;
}
function domainKey(site?: string | null): string | null {
  const host = (site ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  return host && host.includes('.') ? host : null;
}
function keysOf(c: { phone?: string | null; whatsapp?: string | null; website?: string | null; legal_name?: string | null; trade_name?: string | null; legalName?: string; tradeName?: string; city?: string | null }): string[] {
  const out = new Set<string>();
  for (const p of [c.phone, c.whatsapp]) {
    const k = phoneKey(p);
    if (k) out.add(`tel:${k}`);
  }
  const w = domainKey(c.website);
  if (w) out.add(`web:${w}`);
  for (const n of [c.legal_name ?? c.legalName, c.trade_name ?? c.tradeName]) if (n) out.add(`nome:${norm(n)}:${norm(c.city)}`);
  return [...out];
}

/** Mesma chave de deduplicação do app (CNPJ → domínio → telefone + cidade → nome + cidade). */
export function dedupeKey(c: RawCompany): string {
  if (c.cnpj) return `cnpj:${digits(c.cnpj)}`;
  const web = domainKey(c.website);
  if (web) return `web:${web}`;
  if (c.phone) return `tel:${digits(c.phone)}:${norm(c.city)}`;
  return `nome:${norm(c.legalName)}:${norm(c.city)}`;
}

// ---------- score (mesmas regras do app, sem engajamento e sem contato) ----------

export function huntScore(c: RawCompany, profile: { icp_segments?: string[] | null; icp_regions?: string[] | null }) {
  const segs = profile.icp_segments ?? [];
  const regs = profile.icp_regions ?? [];
  const segOk = segs.some((s) => norm(s) === norm(c.segment));
  const regionOk = regs.some((r) => norm(r) === norm(c.city));
  const waPts = c.whatsappStatus === 'confirmado' ? 6 : c.whatsappStatus === 'provavel' ? 3 : 0;
  const rules = [
    { key: 'icp_segment', label: 'Segmento no ICP', max: 20, points: !segs.length ? 12 : segOk ? 20 : 6, evidence: !segs.length ? 'ICP sem segmentos definidos' : segOk ? `${c.segment} está no ICP` : `${c.segment} fora do ICP` },
    { key: 'icp_region', label: 'Localização', max: 15, points: !regs.length ? 9 : regionOk ? 15 : 4, evidence: !regs.length ? 'ICP sem regiões definidas' : regionOk ? `${c.city} está no ICP` : `${c.city} fora do ICP` },
    { key: 'size', label: 'Porte', max: 10, points: 3, evidence: 'porte não informado' },
    { key: 'contact', label: 'Contato e cargo', max: 10, points: 0, evidence: 'sem contato direto' },
    {
      key: 'channels',
      label: 'Canais de contato',
      max: 15,
      points: Math.min(15, (c.phone ? 5 : 0) + waPts + (c.instagram ? 2 : 0)),
      evidence: [c.phone && 'telefone', waPts && `WhatsApp ${c.whatsappStatus === 'confirmado' ? 'confirmado' : 'provável'}`, c.instagram && 'rede social'].filter(Boolean).join(', ') || 'nenhum canal encontrado',
    },
    { key: 'digital', label: 'Site e informações', max: 10, points: Math.min(10, (c.website ? 5 : 0) + (c.address ? 2 : 0)), evidence: [c.website && `site ${c.website}`, c.address && 'endereço'].filter(Boolean).join(', ') || 'poucas informações encontradas' },
    { key: 'engagement', label: 'Engajamento', max: 20, points: 6, evidence: 'ainda sem interação' },
  ];
  const total = rules.reduce((s, r) => s + r.points, 0);
  const tier = total >= 80 ? 'alta' : total >= 50 ? 'media' : 'baixa';
  return { total, tier, rules };
}

// ---------- quando buscar ----------

export interface HunterState {
  ownerId: string;
  excluded: string[];
  cursor: number;
  day: string | null;
  today: number;
}

const brDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Leads novos com WhatsApp ainda não prospectados (a fila do feeder). */
async function defaultPool(db: Db, ownerId: string): Promise<number> {
  const { count } = await db
    .from('leads')
    .select('id, companies!inner(whatsapp)', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .in('stage', ['novo', 'qualificado'])
    .not('companies.whatsapp', 'is', null);
  return count ?? 0;
}

async function allRows(q: () => Row, cols: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q().select(cols).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface HuntOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Tamanho da fila (para testes). */
  pool?: (ownerId: string) => Promise<number>;
}

export interface HuntSummary {
  searches: number;
  created: number;
  skipped?: string;
}

/** Uma rodada (chamada a cada execução do runner): no máximo uma busca por dono. */
export async function huntLeads(db: Db, now = new Date(), opts: HuntOptions = {}): Promise<HuntSummary> {
  const sum: HuntSummary = { searches: 0, created: 0 };
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  const apiKey = opts.apiKey ?? env?.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return { ...sum, skipped: 'sem GOOGLE_PLACES_API_KEY' };
  const { data, error } = await db
    .from('assistant_settings')
    .select('owner_id, hunter_enabled, hunter_excluded, hunter_cursor, hunter_day, hunter_today')
    .eq('hunter_enabled', true)
    .then(
      (r: { data: Row[] | null; error: unknown }) => r,
      (e: unknown) => ({ data: null, error: e }),
    );
  if (error || !data?.length) return sum; // migration não aplicada ou ninguém ligou
  const today = brDay(now);

  for (const s of data as Row[]) {
    const st: HunterState = {
      ownerId: s.owner_id,
      excluded: Array.isArray(s.hunter_excluded) ? s.hunter_excluded : DEFAULT_HUNTER_EXCLUDED,
      cursor: Number(s.hunter_cursor ?? 0),
      day: s.hunter_day ?? null,
      today: s.hunter_day === today ? Number(s.hunter_today ?? 0) : 0,
    };
    if (st.today >= HUNTER_MAX_PER_DAY) continue;
    // Só busca se alguma campanha recebe leads sozinha e a fila está abaixo do necessário.
    const { data: camps } = await db.from('campaigns').select('daily_limit_whatsapp').eq('owner_id', st.ownerId).eq('status', 'ativa').eq('auto_enroll', true);
    const perDay = ((camps ?? []) as Row[]).reduce((n, c) => n + Number(c.daily_limit_whatsapp ?? 0), 0);
    if (!perDay) continue;
    const pool = await (opts.pool ?? ((o: string) => defaultPool(db, o)))(st.ownerId);
    if (pool >= Math.max(MIN_POOL, perDay * 3)) continue;

    const segments = huntSegments(st.excluded);
    if (!segments.length) continue;
    // Reserva a vez (outro runner ao mesmo tempo não repete a mesma busca).
    const { data: claimed } = await db
      .from('assistant_settings')
      .update({ hunter_cursor: st.cursor + 1, hunter_day: today, hunter_today: st.today + 1 })
      .eq('owner_id', st.ownerId)
      .eq('hunter_cursor', st.cursor)
      .select('owner_id');
    if (!claimed?.length) continue;

    const target = pickTarget(st.cursor, segments);
    try {
      const created = await runOne(db, st, target, apiKey, opts.fetchImpl ?? fetch, now);
      sum.searches++;
      sum.created += created;
    } catch (err) {
      console.error('hunter', target, err instanceof Error ? err.message : String(err));
    }
  }
  return sum;
}

/** Roda uma busca e grava as empresas novas como leads. Devolve quantos leads foram criados. */
export async function runOne(db: Db, st: HunterState, target: { segment: string; city: string; state: string }, apiKey: string, fetchImpl: typeof fetch, now = new Date()): Promise<number> {
  const at = now.toISOString();
  const criteria: SearchCriteria = {
    segment: target.segment,
    city: target.city,
    state: target.state,
    regionLabel: `${target.city}/${target.state}`,
    radiusKm: 30,
    requireWebsite: 'indiferente',
    requirePhone: 'sim',
    whatsapp: 'obrigatorio',
    quantity: 20,
    minEmployees: null,
  };
  const rawQuery = `BEELIE: ${target.segment} em ${target.city}/${target.state}`;
  const { data: search } = await db
    .from('searches')
    .insert({ owner_id: st.ownerId, raw_query: rawQuery, parsed_criteria: criteria, confirmed_criteria: criteria, status: 'running', providers_used: ['google_places'], ignored_criteria: [] })
    .select('id')
    .single();
  const searchId: string | null = search?.id ?? null;

  let found: RawCompany[];
  const budget = newBudget(12, 40_000);
  try {
    found = (await searchPlaces(apiKey, criteria, fetchImpl, { enrich: (list) => enrichWhatsapp(list, st.ownerId, fetchImpl, budget) })).companies;
  } catch (err) {
    if (searchId) await db.from('searches').update({ status: 'error', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }).eq('id', searchId);
    throw err;
  }

  // O que já existe na sua base e quem pediu para não receber mensagens.
  const existing = await allRows(() => db.from('companies').eq('owner_id', st.ownerId), 'id, legal_name, trade_name, city, phone, whatsapp, website');
  const known = new Set<string>();
  for (const c of existing) for (const k of keysOf(c)) known.add(k);
  const supp = await allRows(() => db.from('suppression_list').eq('owner_id', st.ownerId).eq('kind', 'phone'), 'id, value');
  const blocked = new Set(supp.map((x) => phoneKey(x.value)).filter(Boolean));
  const { data: profile } = await db.from('profiles').select('icp_segments, icp_regions').eq('id', st.ownerId).maybeSingle();

  let created = 0;
  let dup = 0;
  let rank = 0;
  for (const raw of found) {
    if (excludedByName(raw.legalName, st.excluded)) continue;
    const keys = keysOf(raw);
    if (keys.some((k) => known.has(k))) {
      dup++;
      continue;
    }
    keys.forEach((k) => known.add(k));
    const wa = phoneKey(raw.whatsapp ?? raw.phone);
    if (wa && blocked.has(wa)) continue;

    const src = { provider: raw.provider, fetchedAt: at };
    const prov: Row = {};
    for (const f of ['tradeName', 'segment', 'city', 'state', 'address', 'website', 'phone', 'whatsapp', 'instagram'] as const) if (raw[f]) prov[f] = src;
    const { data: co, error: coErr } = await db
      .from('companies')
      .insert({
        owner_id: st.ownerId,
        legal_name: raw.legalName,
        trade_name: raw.tradeName ?? null,
        segment: raw.segment,
        city: raw.city || target.city,
        state: (raw.state || target.state).slice(0, 2).toUpperCase(),
        address: raw.address ?? null,
        lat: raw.lat ?? null,
        lng: raw.lng ?? null,
        website: domainKey(raw.website),
        phone: raw.phone ?? null,
        whatsapp: raw.whatsapp ?? null,
        whatsapp_status: raw.whatsapp ? raw.whatsappStatus ?? 'desconhecido' : 'desconhecido',
        instagram: raw.instagram ?? null,
        field_provenance: prov,
        dedupe_key: dedupeKey(raw),
        created_by: null,
      })
      .select('id')
      .single();
    if (coErr || !co?.id) continue; // já existe (mesma chave) ou dado inválido
    const score = huntScore(raw, profile ?? {});
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .insert({ owner_id: st.ownerId, company_id: co.id, stage: 'novo', current_score: score.total, score_tier: score.tier, first_search_id: searchId, origin: HUNTER_ORIGIN, discovered_at: at, last_activity_at: at, created_by: null })
      .select('id')
      .single();
    if (leadErr || !lead?.id) continue;
    created++;
    await db.from('lead_sources').insert({ owner_id: st.ownerId, company_id: co.id, search_id: searchId, provider: raw.provider, external_id: raw.externalId, fetched_at: at, expires_at: raw.expiresAt ?? null });
    await db.from('lead_scores').insert({
      owner_id: st.ownerId,
      lead_id: lead.id,
      score: score.total,
      tier: score.tier,
      rule_score: score.total,
      ai_adjustment: 0,
      breakdown: score.rules,
      justification: 'Pontuação pelas regras (busca automática).',
      model: 'regras',
      prompt_version: 'regras',
    });
    if (searchId) await db.from('search_results').insert({ owner_id: st.ownerId, search_id: searchId, company_id: co.id, lead_id: lead.id, rank: ++rank, provider: raw.provider, was_duplicate: false });
    await db.from('lead_activities').insert({ owner_id: st.ownerId, lead_id: lead.id, type: 'discovered', description: `Encontrada pelo BEELIE na busca automática “${target.segment} em ${target.city}/${target.state}”`, payload: { kind: 'hunter', searchId }, actor_id: null });
  }
  if (searchId) await db.from('searches').update({ status: 'done', result_count: rank, new_count: created, duplicates_removed: dup }).eq('id', searchId);
  return created;
}
