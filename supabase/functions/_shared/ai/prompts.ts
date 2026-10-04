// Prompts versionados da camada de IA. Cada tarefa define: system, mensagem do
// usuário, JSON Schema da saída (via tool use) e pós-processamento.

export const PROMPT_VERSION = 'v1';

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
        confidence: { type: 'object', additionalProperties: { type: 'number' } },
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
      properties: { adjustment: { type: 'integer', minimum: -15, maximum: 15 }, reason: { type: 'string' } },
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
        `Empresa alvo (dados reais encontrados): ${JSON.stringify(stripInternal(company))}`,
        'Nunca use só "Olá {nome}, tudo bem?": cite pelo menos um dado real da empresa (segmento, cidade ou site).',
      ]
        .filter(Boolean)
        .join('\n');
    },
    output: (raw) => raw.message,
  },

  classifyReply: {
    system: `Você classifica respostas de leads a mensagens comerciais B2B. ${RULES}
Categorias: interessado (quer saber mais, pediu valores), reuniao (pediu reunião ou ligação), duvida (fez uma pergunta), nao_interessado (recusou), opt_out (pediu para não receber mais mensagens), ausente (resposta automática de férias/ausência), outro.
Na dúvida entre nao_interessado e opt_out, prefira opt_out se houver pedido para parar de receber.`,
    schema: {
      type: 'object',
      properties: {
        classification: { type: 'string', enum: ['interessado', 'reuniao', 'duvida', 'nao_interessado', 'opt_out', 'ausente', 'outro'] },
        confidence: { type: 'number' },
        summary: { type: 'string', description: 'Resumo em até 20 palavras.' },
      },
      required: ['classification', 'confidence', 'summary'],
    },
    user: (input) => `Resposta do lead:\n${(input as { text: string }).text}`,
    output: (raw) => raw,
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
