import { config } from './config.js';

/** Vozes disponíveis (OpenAI). A padrão é cedar: masculina e a mais natural (recomendada pela OpenAI). */
export const VOICES = ['cedar', 'verse', 'ash', 'echo', 'onyx', 'marin', 'nova', 'shimmer', 'coral', 'sage', 'alloy', 'fable', 'ballad'] as const;

/** Como falar: jovem, descontraído e humano (vale para qualquer voz). */
const SPEAKING_STYLE =
  'Fale em português do Brasil, com sotaque brasileiro neutro, como uma pessoa jovem (por volta de 28 anos) mandando um áudio de WhatsApp para um cliente: ' +
  'tom leve, simpático e confiante, com um sorriso na voz; ritmo de conversa, um pouco ágil, com entonação variada e pequenas pausas naturais entre as ideias. ' +
  'Nada de voz de locutor, de URA ou robótica; nada de ler pausadamente. Soe espontâneo, como quem está explicando algo a um conhecido.';

export const ttsAvailable = () => !!config.openaiKey;

/**
 * Texto → áudio de WhatsApp (Ogg/Opus, o formato da mensagem de voz).
 * Usa a API de voz da OpenAI; a chave fica só no servidor (OPENAI_API_KEY).
 */
export async function textToSpeech(text: string, voice?: string, format: 'opus' | 'mp3' = 'opus'): Promise<Buffer> {
  if (!config.openaiKey) throw new Error('Áudio indisponível: configure OPENAI_API_KEY no Railway.');
  const v = VOICES.includes(voice as (typeof VOICES)[number]) ? voice : 'cedar';
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ttsModel,
      voice: v,
      input: text.slice(0, 1500),
      response_format: format,
      instructions: SPEAKING_STYLE,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Falha ao gerar o áudio (${res.status}). ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Amostra de voz para ouvir antes de escolher (MP3: toca em qualquer navegador). Guardada em memória por voz e nome. */
const previews = new Map<string, Buffer>();
export async function voicePreview(voice: string, name: string): Promise<Buffer> {
  const v = VOICES.includes(voice as (typeof VOICES)[number]) ? voice : 'cedar';
  const who = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 30) || 'BEELIE';
  const key = `${v}|${who}`;
  const hit = previews.get(key);
  if (hit) return hit;
  const text = `Oi, tudo bem? Aqui é o ${who}, assistente da OXYCOM. Vi que vocês estão crescendo e pensei numa ideia rápida que pode ajudar a gerar mais clientes. Faz sentido a gente bater um papo de quinze minutinhos essa semana?`;
  const audio = await textToSpeech(text, v, 'mp3');
  previews.set(key, audio);
  if (previews.size > 60) previews.delete(previews.keys().next().value as string);
  return audio;
}

/** Áudios recebidos maiores que isso não são transcritos (o lead vê a resposta, você ouve no WhatsApp). */
export const MAX_TRANSCRIBE_SECONDS = 300;
const MAX_TRANSCRIBE_BYTES = 10 * 1024 * 1024;

/**
 * Áudio recebido → texto (pt-BR), para o BEELIE entender o que o lead disse.
 * Só é chamado para mensagens de leads; conversas pessoais nunca saem do serviço.
 */
export async function transcribe(audio: Buffer, mimetype = 'audio/ogg'): Promise<string> {
  if (!config.openaiKey) throw new Error('Transcrição indisponível: configure OPENAI_API_KEY no Railway.');
  if (audio.length > MAX_TRANSCRIBE_BYTES) throw new Error('Áudio grande demais para transcrever.');
  const type = mimetype.split(';')[0]!.trim() || 'audio/ogg';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type }), type.includes('mpeg') ? 'audio.mp3' : type.includes('mp4') ? 'audio.m4a' : 'audio.ogg');
  form.append('model', config.sttModel);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Falha ao transcrever o áudio (${res.status}). ${detail}`);
  }
  const json = (await res.json().catch(() => ({}))) as { text?: string };
  return (json.text ?? '').trim();
}
