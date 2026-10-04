import type { AnalysisItem, AnalysisSections, Company, ParsedCriteria, SearchCriteria } from '../../types';
import { normalize, sleep } from '../../utils';
import type { AIProvider } from '../types';
import { MOCK_CITIES } from './mockCompanies';

const SEGMENT_HINTS: [string, string][] = [
  ['maquinas agricolas', 'Máquinas agrícolas'],
  ['agronegocio', 'Agronegócio'],
  ['agro', 'Agronegócio'],
  ['industria', 'Indústria'],
  ['odontolog', 'Clínicas odontológicas'],
  ['clinica', 'Clínicas'],
  ['logistica', 'Logística'],
  ['transportadora', 'Logística'],
  ['tecnologia', 'Tecnologia'],
  ['software', 'Tecnologia'],
  ['maquinas', 'Máquinas'],
  ['servicos', 'Serviços B2B'],
  ['consultoria', 'Serviços B2B'],
];

/** Interpretação por regras — usada pelo MockAIProvider e como fallback. */
export function ruleBasedParse(text: string): ParsedCriteria {
  const t = normalize(text);
  const seg = SEGMENT_HINTS.find(([k]) => t.includes(k));
  const city = MOCK_CITIES.find((c) => t.includes(normalize(c))) ?? null;
  const interior = t.includes('interior');
  const sp = interior || t.includes('sao paulo') || t.includes('/sp') || !!city;
  const emp = /(?:mais de|acima de|pelo menos)\s*(\d+)\s*funcion/.exec(t) ?? /(\d+)\+?\s*funcion/.exec(t);
  const qty = /(\d+)\s*(?:empresas|leads|resultados)/.exec(t);
  const radius = /(\d+)\s*km/.exec(t);

  const criteria: SearchCriteria = {
    segment: seg ? seg[1] : '',
    city,
    state: sp ? 'SP' : null,
    regionLabel: city ? `${city}/SP` : interior ? 'Interior de São Paulo' : sp ? 'São Paulo' : '',
    radiusKm: city ? (radius ? Number(radius[1]) : 50) : null,
    requireWebsite: /\bsite\b|website/.test(t) ? 'sim' : 'indiferente',
    requirePhone: 'sim',
    whatsapp: /so com whatsapp|whatsapp obrigatorio|apenas com whatsapp/.test(t)
      ? 'obrigatorio'
      : t.includes('whatsapp')
        ? 'preferencial'
        : 'indiferente',
    quantity: qty ? Math.min(200, Number(qty[1])) : 50,
    minEmployees: emp ? Number(emp[1]) : null,
  };
  return {
    criteria,
    confidence: {
      segment: seg ? 0.9 : 0.2,
      city: city ? 0.95 : interior ? 0.7 : 0.3,
      regionLabel: criteria.regionLabel ? 0.9 : 0.2,
      minEmployees: emp ? 0.85 : undefined,
    },
  };
}

const fact = (text: string, evidenceField: AnalysisItem['evidenceField']): AnalysisItem => ({ text, kind: 'fact', evidenceField });
const inference = (text: string): AnalysisItem => ({ text, kind: 'inference' });
const unavailable = (text: string): AnalysisItem => ({ text, kind: 'unavailable' });

const PROFILE: Record<string, string> = {
  'Máquinas agrícolas': 'Possivelmente vende e presta assistência técnica a produtores rurais da região.',
  Máquinas: 'Possivelmente atua com equipamentos e reposição de peças para outras empresas.',
  Agronegócio: 'Possivelmente atende produtores de médio porte no interior paulista.',
  Indústria: 'Possivelmente fornece para outras indústrias da região (venda B2B).',
  Clínicas: 'Possivelmente atende pacientes particulares e convênios locais.',
  Logística: 'Possivelmente opera rotas regionais pelo interior de SP.',
  Tecnologia: 'Possivelmente presta serviços digitais para pequenas e médias empresas.',
  'Serviços B2B': 'Possivelmente atende empresas de pequeno e médio porte da região.',
};

const NEEDS: Record<string, string> = {
  'Máquinas agrícolas': 'Pode precisar gerar demanda na safra e manter contato com clientes na entressafra.',
  Máquinas: 'Pode precisar de previsibilidade comercial e reposição rápida para clientes.',
  Agronegócio: 'Pode precisar de canais diretos com produtores e acompanhamento pós-venda.',
  Indústria: 'Pode precisar abrir novos clientes B2B fora da carteira atual.',
  Clínicas: 'Pode precisar atrair pacientes e reduzir faltas em consultas.',
  Logística: 'Pode precisar de novos embarcadores e ocupação de rotas.',
  Tecnologia: 'Pode precisar de geração de demanda qualificada.',
  'Serviços B2B': 'Pode precisar de indicação e prospecção ativa de empresas.',
};

function channelsFound(c: Company): string[] {
  return [
    c.website && 'site',
    c.phone && 'telefone',
    c.whatsapp && `WhatsApp (${c.whatsappStatus === 'confirmado' ? 'confirmado' : 'não confirmado'})`,
    c.instagram && 'Instagram',
    c.linkedin && 'LinkedIn',
  ].filter(Boolean) as string[];
}

/** IA simulada: determinística, nunca afirma algo sem campo de evidência. */
export const mockAIProvider: AIProvider = {
  id: 'mock_ai',
  model: 'mock-rules-v1',
  promptVersion: 'v1',

  async parseSearchQuery(text) {
    await sleep(450);
    return ruleBasedParse(text);
  },

  async analyzeCompany(c) {
    await sleep(500);
    const ch = channelsFound(c);
    const sections: AnalysisSections = {
      summary: [
        fact(`${c.tradeName ?? c.legalName} atua em ${c.segment.toLowerCase()} em ${c.city}/${c.state}.`, 'segment'),
        ch.length ? fact(`Canais encontrados: ${ch.join(', ')}.`, 'phone') : unavailable('Nenhum canal de contato encontrado.'),
      ],
      profile: [inference(PROFILE[c.segment] ?? 'Perfil não inferido com os dados disponíveis.')],
      digitalPresence: [
        c.website ? fact(`Site próprio encontrado: ${c.website}.`, 'website') : unavailable('Nenhum site encontrado nas fontes consultadas.'),
        c.instagram || c.linkedin
          ? fact(`Redes encontradas: ${[c.instagram, c.linkedin].filter(Boolean).join(' · ')}.`, c.instagram ? 'instagram' : 'linkedin')
          : unavailable('Nenhuma rede social encontrada.'),
        ...(c.website ? [inference('Qualidade do site ainda não analisada; ter domínio próprio sugere empresa estruturada.')] : []),
      ],
      opportunities: [
        c.whatsappStatus === 'confirmado'
          ? inference('WhatsApp comercial ativo sugere abertura para contato direto e rápido.')
          : c.website
            ? inference('Sem WhatsApp confirmado: e-mail ou LinkedIn tendem a funcionar melhor.')
            : inference('Presença digital limitada pode indicar interesse em serviços de marketing ou site.'),
        ...(c.employeesRange ? [fact(`Porte informado: ${c.employeesRange} funcionários.`, 'employeesRange')] : []),
      ],
      needs: [inference(NEEDS[c.segment] ?? 'Necessidades não inferidas com os dados disponíveis.')],
      arguments: [
        inference(`Mencionar a atuação em ${c.city} e o segmento de ${c.segment.toLowerCase()} — os contextos confirmados.`),
        ...(c.website ? [inference('Citar algo visto no site após conferir pessoalmente.')] : []),
      ],
    };
    return sections;
  },

  async summarizeCompany(c) {
    return `${c.segment} em ${c.city}/${c.state}${c.website ? ', com site próprio' : ''}.`;
  },

  async adjustScore(c, _ruleScore, icp) {
    await sleep(60);
    // O ajuste olha o que as regras não medem: afinidade de segmento e sinais de atividade.
    const related = /agro|maquin/.test(normalize(icp)) && /agro|maquin/.test(normalize(c.segment));
    const inIcp = normalize(icp).includes(normalize(c.segment));
    if (!inIcp && related) return { adjustment: 6, reason: 'segmento próximo do ICP (cadeia do agro)' };
    if (!c.website && !c.instagram && !c.linkedin) return { adjustment: -6, reason: 'nenhum sinal de atividade digital recente' };
    if (c.whatsappStatus === 'provavel') return { adjustment: -2, reason: 'WhatsApp não confirmado pode atrasar o primeiro contato' };
    return { adjustment: 0, reason: 'dados encontrados já refletidos na base de regras' };
  },

  async generateApproach(c, channel, o) {
    await sleep(400);
    const who = c.tradeName ?? c.legalName;
    const seg = c.segment.toLowerCase();
    const offer = o.offer || '[SEU SERVIÇO]';
    const me = o.senderName || '[SEU NOME]';
    const myCo = o.senderCompany || '[SUA EMPRESA]';
    const v = o.variant % 2;
    if (channel === 'email') {
      return [
        `Assunto: ${who} + ${myCo}`,
        '',
        `Olá, equipe ${who},`,
        '',
        `Encontrei vocês ao pesquisar empresas de ${seg} em ${c.city}/${c.state}${c.website ? ` e conheci o site ${c.website}` : ''}.`,
        `Trabalho na ${myCo} com ${offer} para empresas do setor.`,
        '',
        v === 0 ? 'Faria sentido uma conversa de 20 minutos nas próximas semanas?' : 'Posso enviar um material curto mostrando como funciona?',
        '',
        'Atenciosamente,',
        me,
      ].join('\n');
    }
    if (channel === 'linkedin') {
      return v === 0
        ? `Olá! Vi que a ${who} atua com ${seg} em ${c.city}. Trabalho com ${offer} para empresas do setor e gostaria de me conectar.`
        : `Olá! Acompanho empresas de ${seg} no interior de SP e encontrei a ${who}. Trabalho com ${offer}; acho que temos assunto em comum.`;
    }
    return v === 0
      ? `Olá, equipe ${who}! Aqui é ${me}, da ${myCo}. Vi que vocês atuam com ${seg} em ${c.city}. Trabalho com ${offer} para empresas do setor e queria entender se faz sentido uma conversa rápida. Posso enviar mais detalhes por aqui?`
      : `Oi, tudo bem? Sou ${me}, da ${myCo}. Encontrei a ${who} pesquisando empresas de ${seg} em ${c.city}. Ajudo negócios do setor com ${offer}. Topa uma conversa de 15 minutos esta semana?`;
  },
};
