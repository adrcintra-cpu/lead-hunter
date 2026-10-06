// Beelie, o SDR conversacional da OXYCOM: memória da conversa, estágios, temperatura
// e enriquecimento do cadastro. Lógica pura, usada igual pelo app e pelo servidor.
//
// Princípios:
// - Só dado CONFIRMADO na conversa atualiza o cadastro; PROVÁVEL ajuda a conversa, mas não vira fato.
// - Correção humana tem prioridade: campo corrigido pelo usuário não é sobrescrito pela IA.
// - Quem foi indicado ("quem cuida é a Fernanda") nunca vira o nome de quem está falando.
// - Estágio só avança (exceto encerrar); respostas automáticas não mexem em nada.

export type BeelieStage = 'abertura' | 'identificacao' | 'engajamento' | 'descoberta' | 'oportunidade' | 'qualificacao' | 'reuniao' | 'encerrado';

export const BEELIE_STAGES: { id: BeelieStage; label: string; goal: string }[] = [
  { id: 'abertura', label: 'Abertura', goal: 'obter uma resposta (mensagem curta, contexto real, pergunta fácil)' },
  { id: 'identificacao', label: 'Identificação', goal: 'confirmar se fala com a pessoa certa e descobrir, com naturalidade, como chamá-la' },
  { id: 'engajamento', label: 'Engajamento', goal: 'explicar em uma frase por que o Beelie entrou em contato e abrir a descoberta com uma pergunta' },
  { id: 'descoberta', label: 'Descoberta', goal: 'entender o contexto da empresa e a possível necessidade (uma pergunta por vez)' },
  { id: 'oportunidade', label: 'Oportunidade', goal: 'conectar a necessidade encontrada a UMA solução da OXYCOM que faz sentido' },
  { id: 'qualificacao', label: 'Qualificação', goal: 'entender se há oportunidade real (prioridade, prazo, quem decide), sem interrogatório' },
  { id: 'reuniao', label: 'Reunião', goal: 'confirmar a conversa; o responsável combina o horário (nunca invente horários)' },
  { id: 'encerrado', label: 'Encerrado', goal: 'não insistir nem argumentar; respeitar o pedido do lead' },
];
const ORDER: BeelieStage[] = ['abertura', 'identificacao', 'engajamento', 'descoberta', 'oportunidade', 'qualificacao', 'reuniao'];
export const stageLabel = (s: BeelieStage) => BEELIE_STAGES.find((x) => x.id === s)?.label ?? s;

export type Temperature = 'frio' | 'morno' | 'quente';
export const TEMPERATURE_LABEL: Record<Temperature, string> = { frio: 'Frio', morno: 'Morno', quente: 'Quente' };
const HEAT: Temperature[] = ['frio', 'morno', 'quente'];

export const BEELIE_INTENTS = [
  'positivo',
  'neutro',
  'interessado',
  'pediu_explicacao',
  'respondeu_pergunta',
  'contato_errado',
  'indicou_outro_contato',
  'objecao',
  'sem_interesse',
  'nao_contatar',
  'preco',
  'reuniao',
  'resposta_automatica',
  'fora_do_escritorio',
] as const;
export type BeelieIntent = (typeof BEELIE_INTENTS)[number];
export const INTENT_LABEL: Record<BeelieIntent, string> = {
  positivo: 'Positivo',
  neutro: 'Neutro',
  interessado: 'Interessado',
  pediu_explicacao: 'Pediu explicação',
  respondeu_pergunta: 'Respondeu a pergunta',
  contato_errado: 'Contato errado',
  indicou_outro_contato: 'Indicou outro contato',
  objecao: 'Objeção',
  sem_interesse: 'Sem interesse',
  nao_contatar: 'Não contatar',
  preco: 'Preço',
  reuniao: 'Reunião',
  resposta_automatica: 'Resposta automática',
  fora_do_escritorio: 'Fora do escritório',
};

export const NEED_AREAS = {
  site: 'Site',
  conversao: 'Conversão',
  geracao_de_leads: 'Conversão / geração de leads',
  ux_ui: 'UX/UI',
  seo: 'SEO',
  google: 'Presença no Google',
  trafego_pago: 'Tráfego pago',
  crm: 'CRM',
  automacao: 'Automação',
  ia: 'Inteligência artificial',
  integracoes: 'Integrações',
  desenvolvimento: 'Desenvolvimento',
  marketing: 'Marketing',
  performance: 'Performance',
  posicionamento: 'Posicionamento',
} as const;
export type NeedArea = keyof typeof NEED_AREAS;

export const FACT_FIELDS = [
  'contact_name',
  'contact_role',
  'email',
  'phone',
  'website',
  'is_right_person',
  'area',
  'need',
  'problem',
  'interest',
  'timing',
  'best_time',
  'preferred_channel',
  'referred_name',
  'referred_role',
  'referred_contact',
  'objection',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];
export const FACT_LABEL: Record<FactField, string> = {
  contact_name: 'Nome',
  contact_role: 'Cargo',
  email: 'E-mail',
  phone: 'Telefone',
  website: 'Site',
  is_right_person: 'Responsável pela área',
  area: 'Área',
  need: 'Necessidade',
  problem: 'Problema',
  interest: 'Interesse',
  timing: 'Prazo',
  best_time: 'Melhor horário',
  preferred_channel: 'Canal preferido',
  referred_name: 'Responsável indicado',
  referred_role: 'Cargo do indicado',
  referred_contact: 'Contato do indicado',
  objection: 'Objeção',
};

export type Certainty = 'confirmado' | 'provavel';
export interface Extracted {
  field: FactField;
  value: string;
  certainty: Certainty;
}
/** O que a análise de UMA resposta encontrou (IA e/ou regras). */
export interface ConversationSignals {
  intent: BeelieIntent;
  extracted: Extracted[];
  needArea?: NeedArea | null;
  temperature?: Temperature | null;
  stage?: BeelieStage | null;
}

export interface Fact {
  value: string;
  status: Certainty;
  source: 'conversa' | 'humano' | 'cadastro';
  at: string;
}
export interface Learned {
  label: string;
  value: string;
  at: string;
  /** true = atualizou o cadastro; false = só anotado (provável ou cadastro protegido). */
  applied: boolean;
}
/** Memória do Beelie sobre o lead (coluna leads.beelie). */
export interface BeelieIntel {
  stage: BeelieStage;
  temperature: Temperature;
  lastIntent?: BeelieIntent;
  rightPerson?: boolean | null;
  needArea?: NeedArea;
  need?: string;
  facts: Partial<Record<FactField, Fact>>;
  objections: string[];
  learned: Learned[];
  /** Campos do cadastro corrigidos por uma pessoa: a IA não sobrescreve. */
  locked: LeadField[];
  updatedAt: string;
}
export type LeadField = 'contactName' | 'contactRole' | 'email';

export const emptyIntel = (at: string): BeelieIntel => ({ stage: 'abertura', temperature: 'frio', facts: {}, objections: [], learned: [], locked: [], updatedAt: at });

/** Aceita qualquer JSON salvo (versões antigas, campos faltando). */
export function readIntel(raw: unknown, at = new Date().toISOString()): BeelieIntel {
  const base = emptyIntel(at);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<BeelieIntel>;
  return {
    ...base,
    ...r,
    stage: BEELIE_STAGES.some((s) => s.id === r.stage) ? (r.stage as BeelieStage) : base.stage,
    temperature: HEAT.includes(r.temperature as Temperature) ? (r.temperature as Temperature) : base.temperature,
    facts: r.facts && typeof r.facts === 'object' ? r.facts : {},
    objections: Array.isArray(r.objections) ? r.objections : [],
    learned: Array.isArray(r.learned) ? r.learned : [],
    locked: Array.isArray(r.locked) ? r.locked : [],
  };
}

// ---------- validação de dados ----------

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Palavras que nunca são nome de pessoa (respostas curtas, cumprimentos, cargos). */
const NOT_NAME = new Set(
  'sim nao ok certo isso eu ele ela voce oi ola bom boa dia tarde noite tudo bem obrigado obrigada valeu aqui la empresa equipe pessoal time setor marketing comercial vendas financeiro rh diretor diretora gerente coordenador coordenadora analista dono dona socio socia proprietario proprietaria ceo cmo responsavel assistente atendimento contato quem que pois porque mas entao ali hoje agora ainda pode claro perfeito exato beleza blz show top legal combinado sou mesmo mesma a o de da do das dos e'.split(' '),
);
const ROLE_WORDS =
  /\b(diretor|diretora|gerente|coordenador|coordenadora|supervisor|supervisora|analista|assistente|socio|socia|dono|dona|proprietario|proprietaria|fundador|fundadora|ceo|cmo|cto|cfo|coo|head|lider|responsavel|executivo|executiva|consultor|consultora|especialista|presidente|vice|administrador|administradora|comprador|compradora|vendedor|vendedora|marketing|comercial)\b/;

const cap = (w: string) => (w.length <= 2 && /^(da|de|do|das|dos|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** Devolve o nome limpo ("ricardo" → "Ricardo") ou null se não parecer nome de pessoa. */
export function cleanPersonName(raw: string | undefined | null, companyName?: string): string | null {
  if (!raw) return null;
  const v = raw.replace(/[.!,;:]+$/g, '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 40) return null;
  if (/[\d@/\\?#()[\]{}<>"*_=+|]/.test(v)) return null;
  const words = v.split(' ');
  if (words.length > 4) return null;
  if (!words.every((w) => /^[\p{L}][\p{L}'’-]*$/u.test(w))) return null;
  const meaningful = words.filter((w) => !/^(da|de|do|das|dos|e)$/i.test(w));
  if (!meaningful.length || meaningful.some((w) => NOT_NAME.has(norm(w)) || w.length < 2)) return null;
  if (ROLE_WORDS.test(norm(v))) return null;
  if (companyName && norm(companyName).includes(norm(v))) return null;
  return words.map(cap).join(' ');
}

/** Cargo curto e plausível ("diretor comercial" → "Diretor Comercial"). */
export function cleanRole(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/[.!,;:]+$/g, '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 60 || /[?@\d]/.test(v) || v.split(' ').length > 6) return null;
  if (!ROLE_WORDS.test(norm(v))) return null;
  return v
    .split(' ')
    .map((w) => (/^(ceo|cmo|cto|cfo|coo|rh|ti)$/i.test(w) ? w.toUpperCase() : cap(w)))
    .join(' ');
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;

// ---------- análise por regras (modo de teste e reserva quando a IA falha) ----------

const NAME_AFTER = /(?:meu nome (?:[eé]|eh)|me chamo|pode me chamar de|aqui (?:[eé]|eh) (?:o|a)|quem fala (?:[eé]|eh) (?:o|a)|(?:^|[\s,.!])sou (?:o|a))\s+([\p{L}'’-]+(?:\s+(?:da|de|do|dos|das)\s+[\p{L}'’-]+|\s+[\p{L}'’-]+)?)/iu;
/** Tenta "Nome Sobrenome" e, se não parecer nome, só o primeiro nome. */
function pickName(raw: string | undefined, companyName?: string): string | null {
  if (!raw) return null;
  const words = raw.trim().split(/\s+/);
  const two = words.length >= 2 && !ROLE_WORDS.test(norm(words[words.length - 1])) ? cleanPersonName(words.join(' '), companyName) : null;
  return two ?? cleanPersonName(words[0], companyName);
}
const ASKED_NAME = /(como (posso|devo) te chamar|com quem (eu )?falo|qual (e |eh )?(o )?seu nome|quem (e |eh )?(que )?fala|seu nome)/;
const ASKED_RESPONSIBLE = /(e voce\b|voce (que )?(cuida|e responsavel|responde)|quem cuida|cuida (dessa|desta|da) (parte|area)|e com voce|falo com quem cuida)/;
const REFERRED = [
  /(?:quem (?:cuida|v[eê]|resolve|trata|responde)[^.?!]{0,40}?|(?:o|a) respons[aá]vel[^.?!]{0,30}?)\s(?:[eé]|eh)\s(?:o|a)\s+([\p{L}'’-]+(?:\s+[\p{L}'’-]+)?)/iu,
  /^(?:n[aã]o)[,.!\s]+(?:quem cuida\s+)?(?:[eé]|eh)\s+(?:o|a|com (?:o|a))\s+([\p{L}'’-]+)/iu,
  /\b(?:fal(?:a|e|ar) com|procur(?:a|e|ar)|chama|chame)\s+(?:o|a)\s+([\p{L}'’-]+)/iu,
];
const NEED_RULES: { area: NeedArea; re: RegExp }[] = [
  { area: 'geracao_de_leads', re: /(site|pagina)[^.?!]{0,40}(nao|pouco|quase nao|praticamente nao|nenhum)[^.?!]{0,25}(gera|traz|vem|converte|recebe|chega)[^.?!]{0,20}(contato|cliente|lead|venda|oportunidade|pedido)|(nao|pouco|poucos|quase nenhum)[^.?!]{0,20}(contatos?|clientes?|leads?)[^.?!]{0,20}(pelo|do|no) site/ },
  { area: 'conversao', re: /(visita|acesso|trafego)[^.?!]{0,30}(mas|porem)[^.?!]{0,30}(nao|pouco)[^.?!]{0,20}(converte|compra|vende|contato)/ },
  { area: 'seo', re: /(aparecer|aparece|aparecemos|achar|acham|encontrar|encontram)[^.?!]{0,30}google|\bseo\b|primeira pagina/ },
  { area: 'trafego_pago', re: /(anuncio|anunciar|anuncios|google ads|meta ads|facebook ads|instagram ads|trafego pago|impulsionar)/ },
  { area: 'crm', re: /(\bcrm\b|planilha[^.?!]{0,30}(cliente|venda|contato)|controle (de|dos) (cliente|lead|venda)|perdemos (lead|cliente|contato))/ },
  { area: 'automacao', re: /(automatizar|automacao|muito manual|tudo manual|processo manual|retrabalho)/ },
  { area: 'ia', re: /(inteligencia artificial|\bia\b|chatbot|chat ?gpt|agente de ia)/ },
  { area: 'integracoes', re: /(integrar|integracao|\berp\b|sistemas? (nao|que nao) (conversa|se fala))/ },
  { area: 'site', re: /(site (antigo|desatualizado|feio|lento|velho)|(novo|refazer|reformular|criar um?) site|nao temos site|sem site)/ },
  { area: 'ux_ui', re: /(\bux\b|\bui\b|usabilidade|dificil de usar|experiencia do usuario)/ },
  { area: 'posicionamento', re: /(posicionamento|branding|marca (fraca|desconhecida)|ninguem conhece)/ },
  { area: 'desenvolvimento', re: /(aplicativo|\bapp\b|sistema (proprio|sob medida|interno)|desenvolver um)/ },
  { area: 'marketing', re: /(marketing (fraco|parado|nao funciona)|nao temos marketing|sem marketing)/ },
];

/**
 * Regras para uma resposta, considerando a última mensagem enviada (o que foi perguntado).
 * Conservadoras: na dúvida, não extraem nada.
 */
export function analyzeSignalsRules(text: string, lastOutbound?: string, ctx: { companyName?: string; category?: string } = {}): ConversationSignals {
  const t = norm(text);
  const asked = norm(lastOutbound ?? '');
  const extracted: Extracted[] = [];
  const add = (field: FactField, value: string | null | undefined, certainty: Certainty = 'confirmado') => {
    if (value && !extracted.some((e) => e.field === field)) extracted.push({ field, value, certainty });
  };

  // Outro responsável (nunca é quem está falando).
  let referred: string | null = null;
  for (const re of REFERRED) {
    const m = re.exec(text);
    const name = m && pickName(m[1], ctx.companyName);
    if (name) {
      referred = name;
      break;
    }
  }
  if (referred) add('referred_name', referred);

  // Nome de quem fala: frase explícita, ou resposta curta logo depois de "como posso te chamar?".
  const nm = NAME_AFTER.exec(text);
  let name = nm ? pickName(nm[1], ctx.companyName) : null;
  if (!name && ASKED_NAME.test(asked)) {
    const short = text.replace(/^(e|eh|é|sou|aqui)\s+/i, '').replace(/[.!]+$/, '').trim();
    if (short.split(/\s+/).length <= 3) name = cleanPersonName(short, ctx.companyName);
  }
  if (name && name !== referred) add('contact_name', name);

  // Cargo: "sou o Carlos, diretor comercial" / "sou gerente de marketing".
  const roleM = /(?:sou (?:o |a )?[\p{L}]+,\s*|sou (?:o |a )?|trabalho como |cargo (?:e|eh|é) )((?:diretor|diretora|gerente|coordenador|coordenadora|supervisor|supervisora|analista|socio|socia|dono|dona|proprietario|proprietaria|fundador|fundadora|ceo|cmo|head|responsavel|presidente)[\p{L}\s]{0,30})/iu.exec(norm(text));
  if (roleM) add('contact_role', cleanRole(roleM[1].split(/[.,;!?]|\s+e\s+/)[0]));

  // Contatos citados: do indicado (se houve indicação) ou da própria pessoa.
  const email = EMAIL.exec(text)?.[0]?.toLowerCase();
  const phone = PHONE.exec(text)?.[0];
  if (referred) add('referred_contact', email ?? phone ?? null);
  else {
    if (email) add('email', email);
    if (phone) add('phone', phone.replace(/\D/g, ''));
  }

  // É a pessoa certa?
  const yes = /^(sim|sou eu|isso|exato|eu mesm[oa]|pode falar|e comigo|eh comigo|sou|correto|isso mesmo|positivo|claro|uhum|aham)\b/.test(t);
  const no = /^(nao|não)\b/.test(t) || /(nao sou eu|nao cuido|nao e comigo|nao eh comigo|nao e minha area|numero errado|engano|nao trabalho)/.test(t);
  if (ASKED_RESPONSIBLE.test(asked) || ASKED_NAME.test(asked)) {
    if (no || referred) add('is_right_person', 'nao');
    else if (yes || name) add('is_right_person', 'sim');
  } else if (referred && no) add('is_right_person', 'nao');

  // Necessidade.
  const needHit = NEED_RULES.find((r) => r.re.test(t));
  if (needHit) {
    add('problem', text.replace(/\s+/g, ' ').trim().slice(0, 160));
    add('need', NEED_AREAS[needHit.area]);
  }
  const timing = /(esse mes|este mes|proxim[ao] (semana|mes|trimestre)|urgente|o quanto antes|ate (o )?fim do ano|ainda (esse|este) ano|ano que vem)/.exec(t);
  if (timing) add('timing', timing[0]);

  // Intenção.
  const cat = ctx.category;
  let intent: BeelieIntent;
  if (cat === 'sem_contato') intent = 'nao_contatar';
  else if (cat === 'ausente') intent = /resposta automatica|mensagem automatica|auto-?reply/.test(t) ? 'resposta_automatica' : 'fora_do_escritorio';
  else if (/(resposta automatica|mensagem automatica|esta e uma mensagem automatica|nao responda (a )?este)/.test(t)) intent = 'resposta_automatica';
  else if (cat === 'nao_interessado') intent = 'sem_interesse';
  else if (referred) intent = 'indicou_outro_contato';
  else if (no && /(nao sou eu|nao cuido|nao e comigo|nao eh comigo|numero errado|engano|nao trabalho)/.test(t)) intent = 'contato_errado';
  else if (/(podemos conversar|podemos marcar|pode marcar|vamos marcar|marcamos|bora marcar|topo (sim|conversar)?|aceito|vamos conversar|pode agendar|agenda (pra|para)|bora conversar)/.test(t) || cat === 'reuniao') intent = 'reuniao';
  else if (cat === 'orcamento') intent = 'preco';
  else if (cat === 'objecao') intent = 'objecao';
  else if (/(como (voces|vcs|voce) (poderiam|podem|podia|pode) (me |nos )?ajudar|como funciona|o que (voces|vcs) fazem|me explica|explique|como seria)/.test(t) || cat === 'informacoes') intent = 'pediu_explicacao';
  else if (cat === 'interessado') intent = 'interessado';
  else if (extracted.some((e) => !['is_right_person'].includes(e.field))) intent = 'respondeu_pergunta';
  else if (yes) intent = 'positivo';
  else intent = 'neutro';

  if (intent === 'objecao') add('objection', text.replace(/\s+/g, ' ').trim().slice(0, 120));

  return { intent, extracted, needArea: needHit?.area ?? null };
}

/** Junta a análise da IA com a das regras: a IA manda, as regras completam e garantem segurança. */
export function combineSignals(ai: Partial<ConversationSignals> | null | undefined, rules: ConversationSignals): ConversationSignals {
  if (!ai) return rules;
  const valid = BEELIE_INTENTS.includes(ai.intent as BeelieIntent);
  let intent = valid ? (ai.intent as BeelieIntent) : rules.intent;
  // Pedido de não contato ou resposta automática detectados pelas regras sempre valem.
  if (['nao_contatar', 'resposta_automatica', 'fora_do_escritorio'].includes(rules.intent)) intent = rules.intent;
  const extracted: Extracted[] = [];
  for (const e of [...(Array.isArray(ai.extracted) ? ai.extracted : []), ...rules.extracted]) {
    if (!e || !FACT_FIELDS.includes(e.field) || typeof e.value !== 'string' || !e.value.trim()) continue;
    const prev = extracted.find((x) => x.field === e.field);
    if (!prev) extracted.push({ field: e.field, value: e.value.trim(), certainty: e.certainty === 'confirmado' ? 'confirmado' : 'provavel' });
    else if (prev.certainty === 'provavel' && e.certainty === 'confirmado') Object.assign(prev, { value: e.value.trim(), certainty: 'confirmado' });
  }
  return {
    intent,
    extracted,
    needArea: (ai.needArea && ai.needArea in NEED_AREAS ? ai.needArea : null) ?? rules.needArea ?? null,
    temperature: ai.temperature && HEAT.includes(ai.temperature) ? ai.temperature : null,
    stage: ai.stage && BEELIE_STAGES.some((s) => s.id === ai.stage) ? ai.stage : null,
  };
}

// ---------- aplicar ao lead ----------

export interface MergeResult {
  intel: BeelieIntel;
  /** Campos do cadastro a atualizar (só os confirmados e não protegidos). */
  patch: Partial<Record<LeadField, string>>;
  /** Novidades desta resposta (para o histórico "Cadastro atualizado pelo Beelie"). */
  learned: Learned[];
  /** Pessoa indicada como responsável (para registrar como outro contato). */
  referred?: { name: string; role?: string; contact?: string };
  /** Chegou agora ao estágio de reunião (criar tarefa para o responsável agendar). */
  meetingReached: boolean;
}

const stageIndex = (s: BeelieStage) => (s === 'encerrado' ? -1 : ORDER.indexOf(s));
const maxStage = (a: BeelieStage, b: BeelieStage) => (stageIndex(b) > stageIndex(a) ? b : a);
const hotter = (a: Temperature, b: Temperature) => (HEAT.indexOf(b) > HEAT.indexOf(a) ? b : a);

/**
 * Aplica o que foi encontrado numa resposta à memória do Beelie e ao cadastro.
 * `lead` traz os valores atuais do cadastro (o que está salvo hoje).
 */
export function mergeIntel(
  currentRaw: unknown,
  lead: { contactName?: string | null; contactRole?: string | null; email?: string | null },
  s: ConversationSignals,
  at: string,
  ctx: { companyName?: string } = {},
): MergeResult {
  const intel = readIntel(currentRaw, at);
  const prev = { stage: intel.stage, temperature: intel.temperature };
  const learned: Learned[] = [];
  const patch: Partial<Record<LeadField, string>> = {};
  const auto = s.intent === 'resposta_automatica' || s.intent === 'fora_do_escritorio';
  const get = (f: FactField) => s.extracted.find((e) => e.field === f);

  if (!auto) {
    // Pessoa indicada: registra à parte; nunca vira o nome de quem está falando.
    const refName = cleanPersonName(get('referred_name')?.value, ctx.companyName);
    if (refName) {
      setFact(intel, 'referred_name', refName, 'confirmado', at, learned);
      const rr = cleanRole(get('referred_role')?.value);
      if (rr) setFact(intel, 'referred_role', rr, get('referred_role')!.certainty, at, learned);
      const rc = get('referred_contact')?.value?.trim();
      if (rc && (EMAIL.test(rc) || /\d{8,}/.test(rc.replace(/\D/g, '')))) setFact(intel, 'referred_contact', rc.slice(0, 80), 'confirmado', at, learned);
    }

    // Cadastro: nome, cargo e e-mail de quem está falando.
    const fields: { f: FactField; key: LeadField; clean: (v: string) => string | null }[] = [
      { f: 'contact_name', key: 'contactName', clean: (v) => cleanPersonName(v, ctx.companyName) },
      { f: 'contact_role', key: 'contactRole', clean: cleanRole },
      { f: 'email', key: 'email', clean: (v) => (EMAIL.test(v) && EMAIL.exec(v)![0].length === v.trim().length ? v.trim().toLowerCase() : null) },
    ];
    for (const { f, key, clean } of fields) {
      const e = get(f);
      const value = e && clean(e.value);
      if (!value || (f === 'contact_name' && refName && value === refName)) continue;
      const current = (lead[key] ?? '').trim();
      const fact = intel.facts[f];
      const fromConversation = !!current && fact?.source === 'conversa' && fact.value === current;
      const canWrite = e!.certainty === 'confirmado' && !intel.locked.includes(key) && (!current || fromConversation);
      if (current && current.toLowerCase() === value.toLowerCase()) {
        if (!fact) intel.facts[f] = { value: current, status: 'confirmado', source: 'cadastro', at };
        continue;
      }
      if (canWrite) {
        patch[key] = value;
        intel.facts[f] = { value, status: 'confirmado', source: 'conversa', at };
        learned.push({ label: FACT_LABEL[f], value, at, applied: true });
      } else if (!fact || fact.source === 'conversa') {
        // Provável, campo corrigido por uma pessoa ou cadastro já preenchido: só anota.
        intel.facts[f] = { value, status: 'provavel', source: 'conversa', at };
        learned.push({ label: FACT_LABEL[f], value, at, applied: false });
      }
    }

    // Demais informações comerciais (memória da conversa, não mexem no cadastro).
    for (const f of ['phone', 'website', 'area', 'need', 'problem', 'interest', 'timing', 'best_time', 'preferred_channel'] as FactField[]) {
      const e = get(f);
      const value = e?.value?.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (value) setFact(intel, f, value, e!.certainty, at, learned);
    }
    const obj = get('objection')?.value?.trim();
    if (obj && !intel.objections.includes(obj)) intel.objections = [...intel.objections, obj.slice(0, 160)].slice(-5);

    // É a pessoa certa?
    const rp = get('is_right_person')?.value;
    if (refName || s.intent === 'indicou_outro_contato' || s.intent === 'contato_errado') intel.rightPerson = false;
    else if (rp && /^(sim|true|yes)$/i.test(rp)) intel.rightPerson = true;
    else if (rp && /^(nao|não|false|no)$/i.test(rp)) intel.rightPerson = false;
    else if (patch.contactName && intel.rightPerson == null) intel.rightPerson = true;
    if (intel.rightPerson != null) intel.facts.is_right_person = { value: intel.rightPerson ? 'sim' : 'não', status: 'confirmado', source: 'conversa', at };

    // Necessidade.
    if (s.needArea && s.needArea in NEED_AREAS) {
      if (intel.needArea !== s.needArea) learned.push({ label: 'Necessidade', value: NEED_AREAS[s.needArea], at, applied: false });
      intel.needArea = s.needArea;
      intel.need = intel.facts.need?.value ?? NEED_AREAS[s.needArea];
    } else if (intel.facts.need) intel.need = intel.facts.need.value;

    intel.stage = nextStage(intel, s, patch.contactName ?? lead.contactName);
    intel.temperature = nextTemperature(intel, s, prev.temperature);
    intel.lastIntent = s.intent;
  }

  intel.learned = [...learned, ...intel.learned].slice(0, 20);
  intel.updatedAt = at;
  const referred = intel.facts.referred_name && learned.some((l) => l.label === FACT_LABEL.referred_name)
    ? { name: intel.facts.referred_name.value, role: intel.facts.referred_role?.value, contact: intel.facts.referred_contact?.value }
    : undefined;
  return { intel, patch, learned, referred, meetingReached: intel.stage === 'reuniao' && prev.stage !== 'reuniao' };
}

function setFact(intel: BeelieIntel, f: FactField, value: string, certainty: Certainty, at: string, learned: Learned[]) {
  const cur = intel.facts[f];
  if (cur?.source === 'humano') return;
  if (cur && cur.value === value && (cur.status === 'confirmado' || certainty === 'provavel')) return;
  if (cur?.status === 'confirmado' && certainty === 'provavel') return; // não troca certeza por suposição
  intel.facts[f] = { value, status: certainty, source: 'conversa', at };
  learned.push({ label: FACT_LABEL[f], value, at, applied: false });
}

/** Estágio só avança (encerrar é a exceção); reunião exige aceite explícito. */
function nextStage(intel: BeelieIntel, s: ConversationSignals, knownName?: string | null): BeelieStage {
  const cur = intel.stage;
  if (s.intent === 'nao_contatar' || s.intent === 'sem_interesse') return 'encerrado';
  if (cur === 'encerrado' && !['interessado', 'pediu_explicacao', 'preco', 'reuniao'].includes(s.intent)) return cur;
  const base: BeelieStage = cur === 'encerrado' ? 'engajamento' : cur;
  const knowsWho = intel.rightPerson !== false && (!!knownName || !!intel.facts.contact_name);
  const discovery = s.extracted.some((e) => ['problem', 'need', 'area', 'interest', 'timing', 'website', 'preferred_channel', 'best_time'].includes(e.field));
  const hasNeed = !!(intel.needArea || intel.facts.need || intel.facts.problem);
  let target: BeelieStage = 'identificacao';
  if (intel.rightPerson === false) target = 'identificacao';
  else if (knowsWho) target = 'engajamento';
  if (discovery && knowsWho) target = maxStage(target, 'descoberta');
  if (hasNeed) target = maxStage(target, 'oportunidade');
  if (['interessado', 'pediu_explicacao', 'preco'].includes(s.intent)) target = maxStage(target, hasNeed ? 'qualificacao' : 'oportunidade');
  if (intel.facts.timing && hasNeed) target = maxStage(target, 'qualificacao');
  if (s.intent === 'reuniao') target = 'reuniao';
  // A IA pode sugerir avanço, mas nunca pular para reunião sem aceite.
  if (s.stage && s.stage !== 'encerrado' && s.stage !== 'reuniao') target = maxStage(target, s.stage);
  return maxStage(base, target);
}

/** Temperatura sobe com sinais claros; só esfria quando a pessoa recusa. */
function nextTemperature(intel: BeelieIntel, s: ConversationSignals, cur: Temperature): Temperature {
  if (s.intent === 'nao_contatar' || s.intent === 'sem_interesse') return 'frio';
  let t = cur;
  if (['pediu_explicacao', 'preco', 'reuniao', 'interessado'].includes(s.intent)) t = hotter(t, 'quente');
  else if (s.intent === 'respondeu_pergunta' || intel.needArea || intel.facts.problem) t = hotter(t, 'morno');
  if (s.temperature && s.intent !== 'objecao') t = hotter(t, s.temperature);
  return t;
}

/** Correção humana: o campo passa a ser protegido e a memória registra o valor correto. */
export function markHumanEdits(currentRaw: unknown, edits: Partial<Record<LeadField, string | undefined>>, at: string): BeelieIntel {
  const intel = readIntel(currentRaw, at);
  const map: Record<LeadField, FactField> = { contactName: 'contact_name', contactRole: 'contact_role', email: 'email' };
  for (const [key, value] of Object.entries(edits) as [LeadField, string | undefined][]) {
    if (value === undefined) continue;
    if (!intel.locked.includes(key)) intel.locked = [...intel.locked, key];
    const v = (value ?? '').trim();
    if (v) intel.facts[map[key]] = { value: v, status: 'confirmado', source: 'humano', at };
    else delete intel.facts[map[key]];
  }
  intel.updatedAt = at;
  return intel;
}

// ---------- memória para os prompts ----------

/** Resumo do que o Beelie já sabe, para a IA não repetir perguntas nem inventar dados. */
export function beelieBrief(raw: unknown, lead: { contactName?: string | null; contactRole?: string | null; email?: string | null }): string {
  const intel = readIntel(raw);
  const st = BEELIE_STAGES.find((x) => x.id === intel.stage)!;
  const lines: string[] = [];
  lines.push(`Estágio atual da conversa: ${st.label}. Objetivo agora: ${st.goal}.`);
  lines.push(`Temperatura do lead: ${TEMPERATURE_LABEL[intel.temperature]}.`);
  lines.push(
    lead.contactName
      ? `Nome de quem responde: ${lead.contactName}${lead.contactRole ? ` (${lead.contactRole})` : ''} — já sabemos, não pergunte de novo.`
      : 'Nome de quem responde: DESCONHECIDO. Se a pessoa confirmar que é a responsável, pergunte com naturalidade como pode chamá-la (ex.: "Perfeito! Com quem eu falo?"). Nunca como formulário.',
  );
  if (intel.rightPerson === true) lines.push('Pessoa certa: sim, cuida da área (não pergunte de novo).');
  else if (intel.rightPerson === false) {
    const r = intel.facts.referred_name?.value;
    lines.push(
      r
        ? `Pessoa certa: NÃO. Indicou ${r}${intel.facts.referred_role ? ` (${intel.facts.referred_role.value})` : ''}${intel.facts.referred_contact ? `, contato ${intel.facts.referred_contact.value}` : ''}. Não continue o pitch: agradeça e ${intel.facts.referred_contact ? 'diga que vai falar com essa pessoa' : `peça o contato de ${r} ou pergunte se prefere que fale com ela por outro canal`}.`
        : 'Pessoa certa: NÃO. Não continue o pitch: pergunte com educação quem cuida dessa parte.',
    );
  } else lines.push('Pessoa certa: ainda não confirmado.');
  if (intel.needArea || intel.need) lines.push(`Necessidade identificada: ${intel.need ?? NEED_AREAS[intel.needArea!]}. Foque SÓ nisso (não apresente outros serviços).`);
  const known = (Object.entries(intel.facts) as [FactField, Fact][])
    .filter(([f]) => !['contact_name', 'contact_role', 'is_right_person', 'referred_name', 'referred_role', 'referred_contact', 'need'].includes(f))
    .map(([f, v]) => `${FACT_LABEL[f]}: ${v.value}${v.status === 'provavel' ? ' (provável, não confirmado)' : ''}`);
  if (known.length) lines.push(`Já sabemos (não pergunte de novo):\n- ${known.join('\n- ')}`);
  if (intel.objections.length) lines.push(`Objeções já levantadas: ${intel.objections.join(' | ')}`);
  if (intel.stage === 'encerrado') lines.push('O lead recusou ou pediu para não ser contatado: não tente reverter.');
  return lines.join('\n');
}
