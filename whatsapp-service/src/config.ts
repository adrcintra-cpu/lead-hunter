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
};

if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
  throw new Error('WA_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes). Gere com: npm run gen-key');
}
