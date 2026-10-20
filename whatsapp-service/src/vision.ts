import { config } from './config.js';

/** Maior imagem lida (bytes). Acima disso, a imagem vira só um aviso. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Lê uma imagem enviada por um lead (print de contato, cartão de visita, foto de documento…)
 * e devolve, em texto, o que interessa para a conversa: textos visíveis e dados de contato.
 * Usa a OpenAI (OPENAI_API_KEY, só no servidor). Não inventa: o que não estiver legível fica de fora.
 */
export async function describeImage(image: Buffer, mimetype = 'image/jpeg', caption?: string): Promise<string> {
  if (!config.openaiKey) throw new Error('Leitura de imagem indisponível: configure OPENAI_API_KEY no Railway.');
  if (image.length > MAX_IMAGE_BYTES) throw new Error('Imagem grande demais para ler.');
  const type = (mimetype.split(';')[0] || 'image/jpeg').trim();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.visionModel,
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Você lê imagens enviadas por clientes no WhatsApp de uma empresa. Responda em português do Brasil, em até 4 linhas, só com o que está visível: ' +
            'nomes de pessoas e empresas, cargos, telefones (com DDD), e-mails, sites e textos importantes. Se for print de perfil ou cartão de contato, diga "Contato: <nome> — <telefone>". ' +
            'Se a imagem não tiver texto relevante, descreva em uma frase curta. Nunca invente nem complete dados que não estejam legíveis.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: caption ? `Legenda enviada junto: ${caption.slice(0, 300)}` : 'Leia a imagem.' },
            { type: 'image_url', image_url: { url: `data:${type};base64,${image.toString('base64')}`, detail: 'low' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Falha ao ler a imagem (${res.status}). ${detail}`);
  }
  const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  return (json.choices?.[0]?.message?.content ?? '').trim();
}

/** Motivo curto e legível de uma falha de leitura (para o aviso ao dono e o histórico). */
export function mediaFailReason(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/insufficient_quota|billing|credit|cr[eé]dito|\(429\)/i.test(m)) return 'sem crédito na OpenAI';
  if (/OPENAI_API_KEY|\(401\)|invalid_api_key/i.test(m)) return 'chave da OpenAI inválida ou ausente no Railway';
  if (/grande demais|mais de/i.test(m)) return 'arquivo grande demais';
  if (/sess[aã]o/i.test(m)) return 'WhatsApp desconectado';
  return 'falha na leitura';
}

/** Lê a imagem com o Claude, pela função do Supabase (a chave da IA fica lá). */
async function describeViaClaude(image: Buffer, mimetype: string, caption: string | undefined, ownerId: string): Promise<string> {
  const url = config.inboundUrl || `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/whatsapp-qr-inbound`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-inbound-secret': config.inboundSecret },
    body: JSON.stringify({ action: 'vision', ownerId, mimetype, caption: caption?.slice(0, 300), image: image.toString('base64') }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Falha ao ler a imagem com o Claude (${res.status}).`);
  const j = (await res.json().catch(() => ({}))) as { text?: string };
  return (j.text ?? '').trim();
}

/** Lê a imagem: OpenAI quando configurada; se falhar (ou sem chave), o Claude. */
export async function describeImageAny(image: Buffer, mimetype: string, caption: string | undefined, ownerId: string): Promise<string> {
  if (image.length > MAX_IMAGE_BYTES) throw new Error('Imagem grande demais para ler.');
  if (config.openaiKey) {
    try {
      const t = await describeImage(image, mimetype, caption);
      if (t) return t;
    } catch {
      /* tenta com o Claude */
    }
  }
  return describeViaClaude(image, mimetype, caption, ownerId);
}
