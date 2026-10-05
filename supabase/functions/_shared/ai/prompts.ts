// Prompts versionados da camada de IA. Cada tarefa define: system, mensagem do
// usuário, JSON Schema da saída (via tool use) e pós-processamento.

export const PROMPT_VERSION = 'v4';

const RULES = `Regras obrigatórias:
- Use SOMENTE os dados fornecidos. Nunca invente nome de pessoas, números, clientes, prêmios ou fatos.
- Diferencie sempre: "fact" (dado presente no input, com o campo de evidência), "inference" (sua hipótese) e "unavailable" (dado ausente).
- Escreva em português do Brasil, frases curtas e objetivas.`;

type Json = Record<string, unknown>;

interface Task {
  system: string;
  schema: Json;
  user: (input: unknown) => string;
  output: (raw: Json, input: unknown) => unknown;
}

const item = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    kind: { type: 'string', enum: ['fact', 'inference', 'unavailable'] },
    evidenceField: { type: 'string', description: 'Campo do input que comprova o fato. Obrigatório se kind = fact.' },
  },
  required: ['text', 'kind'],
};
const list = { type: 'array', items: item };

export const TASKS = {
  parseSearchQuery: {
    system: `Você converte pedidos de prospecção B2B em critérios de busca estruturados. ${RULES}
Se algo não foi dito, use o padrão: requirePhone "sim", requireWebsite "indiferente", whatsapp "indiferente", quantity 50, radiusKm 50 quando houver cidade.
Se o pedido citar WhatsApp sem dizer que é obrigatório, use "preferencial". Confiança de 0 a 1 por campo.`,
    schema: {
      type: 'object',
      properties: {
        criteria: {
          type: 'object',
          properties: {
            segment: { type: 'string' },
            city: { type: ['string', 'null'] },
            state: { type: ['string', 'null'], description: 'UF com 2 letras' },
            regionLabel: { type: 'string' },
            radiusKm: { type: ['number', 'null'] },
            requireWebsite: { type: 'string', enum: ['sim', 'indiferente'] },
            requirePhone: { type: 'string', enum: ['sim', 'indiferente'] },
            whatsapp: { type: 'string', enum: ['obrigatorio', 'preferencial', 'indiferente'] },
            quantity: { type: 'number' },
            minEmployees: { type: ['number', 'null'] },
          },
          required: ['segment', 'city', 'state', 'regionLabel', 'radiusKm', 'requireWebsite', 'requirePhone', 'whatsapp', 'quantity', 'minEmployees'],
        },
        // Confiança de 0 a 1 por campo (propriedades fixas: a saída estruturada não aceita mapas livres).
        confidence: {
          type: 'object',
          properties: {
            segment: { type: 'number' },
            city: { type: 'number' },
            state: { type: 'number' },
            radiusKm: { type: 'number' },
            requireWebsite: { type: 'number' },
            requirePhone: { type: 'number' },
            whatsapp: { type: 'number' },
            quantity: { type: 'number' },
            minEmployees: { type: 'number' },
          },
          required: ['segment', 'city', 'state', 'radiusKm', 'requireWebsite', 'requirePhone', 'whatsapp', 'quantity', 'minEmployees'],
        },
      },
      required: ['criteria', 'confidence'],
    },
    user: (input) => `Pedido: ${(input as { text: string }).text}`,
    output: (raw) => raw,
  },

  analyzeCompany: {
    system: `Você é um analista comercial B2B. Analise a empresa para prospecção. ${RULES}`,
    schema: {
      type: 'object',
      properties: { summary: list, profile: list, digitalPresence: list, opportunities: list, needs: list, arguments: list },
      required: ['summary', 'profile', 'digitalPresence', 'opportunities', 'needs', 'arguments'],
    },
    user: (input) => {
      const { company, icp } = input as { company: Json; icp: string };
      return `ICP do usuário: ${icp}\n\nDados encontrados da empresa (JSON):\n${JSON.stringify(stripInternal(company), null, 2)}`;
    },
    output: (raw) => raw,
  },

  summarizeCompany: {
    system: `Resuma a empresa em uma frase de até 25 palavras. ${RULES}`,
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    user: (input) => JSON.stringify(stripInternal((input as { company: Json }).company)),
    output: (raw) => raw.summary,
  },

  adjustScore: {
    system: `Você recebe um score base (0–100) calculado por regras e pode ajustá-lo entre -15 e +15, apenas com base nos dados fornecidos. ${RULES}`,
    schema: {
      type: 'object',
      properties: { adjustment: { type: 'integer', description: 'Entre -15 e 15.' }, reason: { type: 'string' } },
      required: ['adjustment', 'reason'],
    },
    user: (input) => {
      const { company, ruleScore, icp } = input as { company: Json; ruleScore: number; icp: string };
      return `ICP: ${icp}\nScore base: ${ruleScore}\nEmpresa: ${JSON.stringify(stripInternal(company))}`;
    },
    output: (raw) => ({ adjustment: Math.max(-15, Math.min(15, Math.round(Number(raw.adjustment) || 0))), reason: String(raw.reason ?? '') }),
  },

  generateApproach: {
    system: `Você escreve primeiras mensagens comerciais B2B curtas, naturais e profissionais. ${RULES}
- WhatsApp: até 3 frases, sem formatação, sem emojis em excesso, termina com uma pergunta simples.
- E-mail: comece com "Assunto: ...", até 90 palavras no corpo.
- LinkedIn: até 300 caracteres.
- Se faltar um dado do remetente, use um marcador entre colchetes, como [SEU NOME].
- Nunca prometa resultados nem cite informações que não estejam no input.`,
    schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    user: (input) => {
      const { company, channel, options } = input as { company: Json; channel: string; options: Json };
      const stage = { primeira: 'primeira mensagem', acompanhamento: 'acompanhamento (o lead não respondeu a mensagem anterior)', ultimo: 'último contato, educado, sem insistir' }[String(options.stage ?? 'primeira')] ?? 'primeira mensagem';
      return [
        `Canal: ${channel}`,
        `Momento da cadência: ${stage}`,
        `Variação: ${options.variant}`,
        `Remetente: ${options.senderName || '[SEU NOME]'}, empresa ${options.senderCompany || '[SUA EMPRESA]'}, oferta: ${options.offer || '[SEU SERVIÇO]'}`,
        options.contactName ? `Contato: ${options.contactName}${options.contactRole ? `, ${options.contactRole}` : ''} (use o primeiro nome)` : 'Contato: não informado (cumprimente a equipe da empresa)',
        options.instructions ? `Instruções do usuário: ${options.instructions}` : '',
        Array.isArray(options.notes) && options.notes.length ? `Observações do usuário sobre o lead (use só se ajudar; não invente além disso):\n- ${(options.notes as string[]).join('\n- ')}` : '',
        options.campaignName ? `Campanha: ${options.campaignName}` : '',
        Array.isArray(options.history) && options.history.length
          ? [
              `Mensagens já enviadas a este lead (mais antiga primeiro)${options.daysSinceLastContact != null ? `; último contato há ${options.daysSinceLastContact} dias` : ''}:`,
              ...(options.history as Json[]).map((h) => `[${h.channel}, ${h.date}] ${h.text}`),
              'Escreva uma continuação natural dessa conversa: não repita frases, argumentos nem a apresentação das mensagens anteriores; mencione de leve o contato anterior e traga um ângulo novo e curto.',
            ].join('\n')
          : '',
        `Empresa alvo (dados reais encontrados): ${JSON.stringify(stripInternal(company))}`,
        'Nunca use só "Olá {nome}, tudo bem?": cite pelo menos um dado real da empresa (segmento, cidade ou site).',
      ]
        .filter(Boolean)
        .join('\n');
    },
    output: (raw) => raw.message,
  },

  classifyReply: {
    system: `Você classifica respostas de leads a mensagens comerciais B2B. Textos que começam com "[Áudio transcrito]" são áudios do lead transcritos: classifique pelo conteúdo. ${RULES}
Categorias:
- interessado: demonstrou interesse sem pedir algo específico
- informacoes: pediu mais informações, material ou explicação
- orcamento: pediu preço, valores, cotação ou proposta
- reuniao: pediu reunião, ligação ou horário
- objecao: levantou uma objeção (preço, já tem fornecedor, sem verba) sem recusar de vez
- posteriormente: pediu para falar em outro momento
- nao_interessado: recusou
- sem_contato: pediu para não receber mais mensagens
- ausente: resposta automática de férias/ausência
- nao_identificado: não dá para saber
Na dúvida entre nao_interessado e sem_contato, prefira sem_contato se houver pedido para parar de receber.
suggestedAction: uma frase curta e prática do que o vendedor deve fazer agora.
followUpDays: só para "posteriormente", em quantos dias retomar (use o prazo citado; sem prazo, 30).`,
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['interessado', 'informacoes', 'orcamento', 'reuniao', 'objecao', 'posteriormente', 'nao_interessado', 'sem_contato', 'ausente', 'nao_identificado'] },
        confidence: { type: 'number' },
        summary: { type: 'string', description: 'Resumo em até 20 palavras.' },
        suggestedAction: { type: 'string', description: 'Próxima ação sugerida, uma frase.' },
        followUpDays: { type: 'integer' },
      },
      required: ['category', 'confidence', 'summary', 'suggestedAction'],
    },
    user: (input) => {
      const { text, context } = input as { text: string; context?: string };
      return [context ? `Contexto: ${context}` : '', `Resposta do lead:\n${text}`].filter(Boolean).join('\n\n');
    },
    output: (raw) => raw,
  },

  suggestReply: {
    system: `Você escreve a próxima resposta de uma conversa comercial B2B pelo WhatsApp ou e-mail, para o vendedor revisar e enviar.
Siga a PERSONA, use só a BASE DE CONHECIMENTO e os PLAYBOOKS fornecidos na mensagem. Eles definem tom, o que dizer e o que perguntar.
Regras que valem acima de tudo:
- Nunca invente preços, prazos, clientes, cases, números ou serviços que não estejam no input. Na dúvida, diga que um especialista confirma.
- Responda à ÚLTIMA mensagem do lead. Tom humano e natural, frases curtas, sem formatação.
- "[Áudio transcrito] ..." é um áudio do lead transcrito automaticamente: responda ao que ele falou (ignore pequenos erros de transcrição) e não comente que era áudio. "[Áudio recebido ...]" significa que não deu para entender o áudio: peça com gentileza que resuma por escrito.
- WhatsApp: até 3 frases. E-mail: até 80 palavras, sem linha de assunto.
- No máximo 1 pergunta por mensagem. Avance um passo por vez.
- Quando houver interesse ou oportunidade real: convide para uma conversa rápida (15 a 20 min) com o vendedor ou um especialista, oferecendo duas opções genéricas (ex.: amanhã de manhã ou à tarde), sem prometer horário exato.
- Se o lead aceitou ou sugeriu horário: confirme de forma simples e diga que o vendedor vai confirmar.
- Se perguntarem se é robô, IA ou se é uma pessoa: apresente-se com o nome do assistente, diga que é o assistente digital da empresa do vendedor e que o vendedor continua a conversa pessoalmente. Nunca afirme ser humano.
- Objeção: reconheça, responda com um argumento curto e deixe a porta aberta, sem insistir.
- Não interessado: agradeça e encerre com educação, sem nova pergunta. Pediu para falar depois: concorde e diga que retoma no prazo citado.
- Não repita a apresentação nem frases já enviadas. Nunca use colchetes nem marcadores como [SEU NOME].
intent:
- continuar: segue a conversa (entendendo o cenário ou respondendo dúvida)
- propor_conversa: a mensagem propõe a conversa com o vendedor/especialista
- confirmar_conversa: o lead aceitou; a mensagem confirma
- encerrar: lead recusou ou pediu para falar depois
- passar_para_vendedor: o pedido exige o vendedor (proposta, preço específico, negociação, reclamação)
note: uma frase para o vendedor sobre o que fazer agora (inclua o que já se sabe do cenário do lead, se houver).`,
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        intent: { type: 'string', enum: ['continuar', 'propor_conversa', 'confirmar_conversa', 'encerrar', 'passar_para_vendedor'] },
        note: { type: 'string' },
      },
      required: ['message', 'intent', 'note'],
    },
    user: (input) => {
      const i = input as {
        channel: string;
        category?: string;
        sender: { name?: string; company?: string; offer?: string };
        contact?: { name?: string; role?: string };
        company: Json;
        conversation: { from: 'vendedor' | 'lead'; date: string; text: string }[];
        assistant?: { name?: string; persona?: string; knowledge?: string; playbooks?: string };
      };
      const cut = (t: string | undefined, n: number) => (t ?? '').trim().slice(0, n);
      return [
        i.assistant?.persona ? `PERSONA (nome do assistente: ${i.assistant.name || 'assistente'}):\n${cut(i.assistant.persona, 8000)}` : '',
        i.assistant?.knowledge ? `BASE DE CONHECIMENTO (ignore seções marcadas para completar):\n${cut(i.assistant.knowledge, 12000)}` : '',
        i.assistant?.playbooks ? `PLAYBOOKS:\n${cut(i.assistant.playbooks, 6000)}` : '',
        '---',
        `Canal: ${i.channel}`,
        `Vendedor: ${i.sender.name || 'não informado (não se apresente pelo nome dele)'}${i.sender.company ? `, empresa ${i.sender.company}` : ''}`,
        i.sender.offer ? `Oferta (perfil do vendedor): ${i.sender.offer}` : '',
        i.contact?.name ? `Contato no lead: ${i.contact.name}${i.contact.role ? `, ${i.contact.role}` : ''} (use o primeiro nome)` : '',
        i.category ? `Classificação da última resposta: ${i.category}` : '',
        `Empresa do lead (dados reais): ${JSON.stringify(stripInternal(i.company))}`,
        'Conversa até agora (mais antiga primeiro):',
        ...i.conversation.map((m) => `[${m.from === 'vendedor' ? 'Vendedor' : 'Lead'}, ${m.date}] ${m.text}`),
        'Escreva a próxima mensagem do vendedor.',
      ]
        .filter(Boolean)
        .join('\n');
    },
    output: (raw) => ({ message: String(raw.message ?? '').trim(), intent: String(raw.intent ?? 'continuar'), note: String(raw.note ?? '') }),
  },

  summarizeResults: {
    system: `Você é um analista comercial. Leia os números de prospecção e escreva de 3 a 6 observações curtas e acionáveis em português do Brasil. ${RULES}
Use somente os números fornecidos; não invente percentuais nem causas. Quando não houver dados suficientes, diga isso.`,
    schema: { type: 'object', properties: { insights: { type: 'array', items: { type: 'string' } } }, required: ['insights'] },
    user: (input) => `Números:\n${JSON.stringify((input as { snapshot: Json }).snapshot, null, 2)}`,
    output: (raw) => raw.insights,
  },
} satisfies Record<string, Task>;

export type TaskName = keyof typeof TASKS;

/** Remove campos internos antes de mandar à IA. */
function stripInternal(c: Json): Json {
  const { id: _id, fieldProvenance: _p, dedupeKey: _d, createdAt: _c, updatedAt: _u, lat: _lat, lng: _lng, ...rest } = c ?? {};
  return rest;
}
