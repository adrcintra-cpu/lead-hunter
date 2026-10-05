/** Configuração lida das variáveis de ambiente. Falha cedo se faltar algo obrigatório. */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  encryptionKey: required('WA_ENCRYPTION_KEY'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Intervalo mínimo entre dois envios do mesmo usuário (segundos). */
  sendMinIntervalSeconds: Number(process.env.SEND_MIN_INTERVAL_SECONDS ?? 8),
  /** Máximo de envios por usuário por dia. */
  sendDailyLimit: Number(process.env.SEND_DAILY_LIMIT ?? 60),
  /**
   * Respostas recebidas: segredo compartilhado com a Edge Function whatsapp-qr-inbound.
   * Sem ele, as respostas não são encaminhadas (o envio continua funcionando).
   */
  inboundSecret: (process.env.WHATSAPP_INBOUND_SECRET ?? '').trim(),
  inboundUrl: (process.env.INBOUND_FUNCTION_URL ?? '').trim(),
  /** Áudio com voz da IA (opcional): chave da OpenAI e modelo de voz. */
  openaiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
  ttsModel: (process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts').trim(),
  /** Modelo que transcreve os áudios recebidos dos leads. */
  sttModel: (process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe').trim(),
  /** Espera mínima antes da resposta automática (segundos). */
  autoMinDelaySeconds: Number(process.env.AUTO_REPLY_MIN_DELAY_SECONDS ?? 5),
};

if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
  throw new Error('WA_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes). Gere com: npm run gen-key');
}
