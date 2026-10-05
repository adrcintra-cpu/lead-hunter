import { config } from './config.js';

/** Vozes disponíveis (OpenAI). A padrão é feminina, combinando com a BEELIE. */
export const VOICES = ['nova', 'shimmer', 'coral', 'sage', 'alloy', 'ash', 'echo', 'onyx', 'fable', 'ballad', 'verse'] as const;

export const ttsAvailable = () => !!config.openaiKey;

/**
 * Texto → áudio de WhatsApp (Ogg/Opus, o formato da mensagem de voz).
 * Usa a API de voz da OpenAI; a chave fica só no servidor (OPENAI_API_KEY).
 */
export async function textToSpeech(text: string, voice?: string): Promise<Buffer> {
  if (!config.openaiKey) throw new Error('Áudio indisponível: configure OPENAI_API_KEY no Railway.');
  const v = VOICES.includes(voice as (typeof VOICES)[number]) ? voice : 'nova';
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ttsModel,
      voice: v,
      input: text.slice(0, 1500),
      response_format: 'opus',
      instructions: 'Fale em português do Brasil, com tom cordial, natural e profissional, ritmo de conversa de WhatsApp.',
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Falha ao gerar o áudio (${res.status}). ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
