import type { AnalysisItem, AnalysisSections, Company, ParsedCriteria, SearchCriteria } from '../../types';
import { normalize, sleep } from '../../utils';
import type { AIProvider } from '../types';
import { MOCK_CITIES } from './mockCompanies';
import { analyzeReplyRules } from '../../../../supabase/functions/_shared/automation/replies.ts';

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
  promptVersion: 'v2',

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
    const me = o.senderName || 'Beelie';
    const myCo = o.senderCompany || 'Oxycom';
    const first = o.contactName ? o.contactName.split(' ')[0] : '';
    const hello = first ? `Olá, ${first}` : `Olá, equipe ${who}`;
    // Só cita o que existe: cargo, cidade, segmento e site vêm da base.
    const role = o.contactRole ? ` Como ${o.contactRole.toLowerCase()} da ${who}, imagino que isso passe por você.` : '';
    const site = c.website ? ` Dei uma olhada no site ${c.website}.` : '';
    const v = o.variant % 2;
    const stage = o.stage ?? 'primeira';

    // Follow-up com histórico: continua a conversa em vez de repetir a apresentação.
    if (o.history?.length && stage !== 'ultimo') {
      const n = o.history.length;
      const when = o.daysSinceLastContact != null ? (o.daysSinceLastContact <= 1 ? 'ontem' : `há ${o.daysSinceLastContact} dias`) : 'há alguns dias';
      const angles = [
        `Uma ideia prática: empresas de ${seg} costumam começar por um diagnóstico rápido, sem compromisso.`,
        `Se ajudar, posso mandar um exemplo curto de como isso funciona para empresas de ${seg} em ${c.city}.`,
        `Sei que a rotina é corrida, então resumo: ${offer} pode tirar trabalho manual da equipe da ${who}.`,
      ];
      const angle = angles[(n - 1 + v) % angles.length];
      if (channel === 'email') {
        return [`Assunto: Re: ${who} — uma ideia rápida`, '', `${hello},`, '', `Escrevi ${when} e imagino que a semana esteja cheia.`, angle, 'Se não for prioridade agora, me diga e eu retomo em outro momento.', '', 'Abraço,', me, myCo].join('\n');
      }
      return `${first ? `${first}, ` : ''}te escrevi ${when} e fiquei pensando numa coisa. ${angle} Faz sentido para vocês?`;
    }

    if (stage === 'acompanhamento') {
      if (channel === 'email') {
        return [`Assunto: Sobre ${offer} para a ${who}`, '', `${hello},`, '', `Mandei uma mensagem há alguns dias sobre ${offer} para empresas de ${seg} em ${c.city}.`, 'Faz sentido conversarmos 15 minutos? Se não for prioridade agora, é só me avisar.', '', 'Abraço,', me, myCo].join('\n');
      }
      return `${hello}, tudo bem? Retomando minha mensagem sobre ${offer} para empresas de ${seg} em ${c.city}. Faz sentido uma conversa rápida esta semana?`;
    }
    if (stage === 'ultimo') {
      if (channel === 'email') {
        return [`Assunto: Último contato — ${who}`, '', `${hello},`, '', `Não quero tomar seu tempo: este é meu último contato sobre ${offer}.`, 'Se em algum momento fizer sentido, é só responder este e-mail.', '', 'Abraço,', me, myCo].join('\n');
      }
      return `${hello}! Último contato da minha parte sobre ${offer}. Se em outro momento fizer sentido, fico à disposição. Obrigado!`;
    }

    if (channel === 'email') {
      return [
        `Assunto: ${who} + ${myCo}`,
        '',
        `${hello},`,
        '',
        `Vi que a ${who} atua com ${seg} na região de ${c.city}/${c.state}.${site}${role}`,
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
        ? `${hello}! Vi que a ${who} atua com ${seg} em ${c.city}. Trabalho com ${offer} para empresas do setor e gostaria de me conectar.`
        : `${hello}! Acompanho empresas de ${seg} no interior de SP e encontrei a ${who}. Trabalho com ${offer}; acho que temos assunto em comum.`;
    }
    // Primeiro contato do Beelie: curto, contexto real e uma pergunta fácil (sem pitch, sem pedir reunião).
    void role;
    void site;
    if (first) {
      return v === 0
        ? `Oi, ${first}! Tudo bem? Estou tentando entender uma coisa sobre a presença digital da ${who}. Você que cuida dessa parte por aí?`
        : `Oi, ${first}! Tudo bem? Vi que a ${who} atua com ${seg} em ${c.city} e fiquei com uma dúvida rápida. É você quem cuida do marketing por aí?`;
    }
    return v === 0
      ? `Oi! Tudo bem? Estou tentando falar com quem cuida da parte de marketing/comercial da ${who}. É você?`
      : `Oi! Tudo bem? Vi que a ${who} atua com ${seg} em ${c.city}. Você sabe me dizer quem cuida do marketing por aí?`;
  },

  async classifyReply(text) {
    await sleep(150);
    return analyzeReplyRules(text);
  },

  async summarizeResults(s) {
    await sleep(300);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const out: string[] = [];
    if (s.sent === 0) return ['Ainda não há envios. Crie uma campanha e ative uma cadência para começar a medir resultados.'];
    out.push(`Foram ${s.sent} mensagens enviadas e ${s.replies} respostas, uma taxa de resposta de ${pct(s.replies, s.sent)}%.`);
    if (s.interested || s.meetings) out.push(`${s.interested} leads demonstraram interesse e ${s.meetings} pediram reunião.`);
    const bestSeg = [...s.bySegment].filter((x) => x.sent >= 2).sort((a, b) => b.replies / b.sent - a.replies / a.sent)[0];
    if (bestSeg && bestSeg.replies > 0) out.push(`O segmento com melhor resposta é ${bestSeg.segment}: ${bestSeg.replies} de ${bestSeg.sent} (${pct(bestSeg.replies, bestSeg.sent)}%).`);
    const ch = [...s.byChannel].filter((x) => x.sent > 0).sort((a, b) => b.replies / b.sent - a.replies / a.sent);
    if (ch.length > 1) out.push(`${ch[0].channel} responde melhor que ${ch[ch.length - 1].channel} (${pct(ch[0].replies, ch[0].sent)}% contra ${pct(ch[ch.length - 1].replies, ch[ch.length - 1].sent)}%).`);
    if (s.failed) out.push(`${s.failed} envios falharam: confira os números e e-mails desses leads.`);
    if (s.optOuts) out.push(`${s.optOuts} contatos pediram para não receber mais mensagens e já estão na lista de supressão.`);
    if (s.openTasks) out.push(`Há ${s.openTasks} tarefas abertas aguardando atendimento humano.`);
    return out;
  },

  /** Sugestão de resposta por regras (modo de teste): mesmo objetivo da IA real, marcar uma conversa. */
  async suggestReply(i) {
    await sleep(150);
    const last = normalize(i.conversation[i.conversation.length - 1]?.text ?? '');
    const first = i.contact?.name?.split(' ')[0];
    const hi = first ? `${first}, ` : '';
    const me = i.sender.name ? i.sender.name.split(' ')[0] : 'o responsável';
    if (/\b(robo|bot|ia|inteligencia artificial|automatic)/.test(last) || last.includes('e uma pessoa') || last.includes('voce e real')) {
      const nm = i.assistant?.name ? i.assistant.name.charAt(0).toUpperCase() + i.assistant.name.slice(1).toLowerCase() : me;
      return { message: `${hi}sou o ${nm}, assistente digital${i.sender.company ? ` da ${i.sender.company}` : ''}. Um especialista do nosso time continua a conversa com você pessoalmente, tudo bem?`, intent: 'passar_para_vendedor', note: 'O lead perguntou se fala com uma pessoa: assuma a conversa.' };
    }
    // Roteiro do Beelie pela memória do lead (mesmo objetivo da IA real).
    const brief = i.brief ?? '';
    const stageOf = /Estágio atual da conversa: ([^.]+)\./.exec(brief)?.[1] ?? '';
    const sdr = i.assistant?.name ? i.assistant.name.charAt(0).toUpperCase() + i.assistant.name.slice(1).toLowerCase() : 'Beelie';
    const co = i.sender.company || 'Oxycom';
    const referred = /Indicou ([^.(,]+)/.exec(brief)?.[1]?.trim();
    if (!['nao_interessado', 'sem_contato', 'posteriormente', 'ausente'].includes(i.category ?? '')) {
      if (/Pessoa certa: NÃO/.test(brief)) {
        return referred
          ? { message: `Perfeito, obrigado! Você consegue me passar o contato da ${referred} ou prefere que eu fale com ela por outro canal?`, intent: 'continuar', note: `Indicou ${referred}: peça o contato.` }
          : { message: 'Sem problemas, obrigado! Você sabe me dizer quem cuida dessa parte por aí?', intent: 'continuar', note: 'Contato errado: descubra quem é o responsável.' };
      }
      if (/Nome de quem responde: DESCONHECIDO/.test(brief) && /Pessoa certa: sim/.test(brief)) {
        return { message: 'Perfeito! Com quem eu falo?', intent: 'continuar', note: 'Pessoa certa: descubra o nome.' };
      }
      if (stageOf === 'Engajamento') {
        const q = i.company.website ? 'hoje vocês usam o site mais como apresentação ou ele também gera oportunidades comerciais?' : 'hoje como vocês costumam conseguir novos clientes?';
        return { message: `Prazer${first ? `, ${first}` : ''}! Sou o ${sdr}, da ${co}. Queria entender uma coisa: ${q}`, intent: 'continuar', note: 'Engajamento: uma pergunta de descoberta.' };
      }
      if (stageOf === 'Descoberta' || stageOf === 'Oportunidade') {
        const need = /Necessidade identificada: ([^.]+)\./.exec(brief)?.[1];
        return {
          message: need ? `Entendi. Perguntei porque é justamente aí que normalmente encontramos espaço para melhorar (${need.toLowerCase()}). Hoje isso é uma prioridade para vocês?` : 'Entendi. E hoje o que mais incomoda vocês nessa parte?',
          intent: 'continuar',
          note: 'Conecte a necessidade a uma solução, sem listar serviços.',
        };
      }
      if (stageOf === 'Qualificação') {
        return { message: 'Faz sentido. Acho que consigo te mostrar algumas possibilidades específicas para isso. Quer que a gente marque uma conversa rápida?', intent: 'propor_conversa', note: 'Lead quente: proponha a conversa.' };
      }
      if (stageOf === 'Reunião') {
        return { message: `Combinado${first ? `, ${first}` : ''}! Vou alinhar o melhor horário com nosso especialista e te confirmo por aqui.`, intent: 'confirmar_conversa', note: 'Aceitou conversar: combine o horário.' };
      }
    }
    switch (i.category) {
      case 'nao_interessado':
        return { message: `${hi}tudo certo, obrigado pelo retorno! Se em algum momento fizer sentido, é só me chamar por aqui.`, intent: 'encerrar', note: 'Lead recusou: não insista.' };
      case 'posteriormente':
        return { message: `${hi}combinado! Retomo com você mais para frente. Obrigado pelo retorno.`, intent: 'encerrar', note: 'Agende o retorno na data combinada.' };
      case 'orcamento':
        return { message: `${hi}os valores dependem do que vocês precisam hoje. Que tal uma conversa rápida de 15 minutos para eu entender e te passar algo certeiro? Amanhã de manhã ou à tarde fica melhor?`, intent: 'propor_conversa', note: 'Pediu preço: prepare uma faixa de valores para a conversa.' };
      case 'reuniao':
        return { message: `${hi}ótimo! Vou confirmar o melhor horário com o ${me} e já te retorno por aqui.`, intent: 'confirmar_conversa', note: 'O lead aceitou conversar: confirme o horário.' };
      case 'objecao':
        return { message: `${hi}entendo totalmente. Muitas empresas chegam até nós justamente para complementar o que já fazem. Uma conversa rápida de 15 minutos ajudaria a ver se faz sentido, sem compromisso. Pode ser esta semana?`, intent: 'propor_conversa', note: 'Objeção: responda com calma, sem pressionar.' };
      default:
        return { message: `${hi}que bom que respondeu! Para eu entender melhor o momento de vocês, topa uma conversa rápida de 15 minutos? Amanhã de manhã ou à tarde fica bom?`, intent: 'propor_conversa', note: 'Lead engajado: proponha um horário.' };
    }
  },
};
