// Traduz o erro da Anthropic em um motivo claro e no que fazer.
export function explainClaudeError(status: number, body: string): string {
  const msg = (/"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? body).slice(0, 200);
  const until = /regain access on (\d{4})-(\d{2})-(\d{2})/i.exec(msg);
  if (/usage limits?/i.test(msg)) {
    return `A conta da Anthropic bateu o limite de gasto mensal${until ? ` (só libera sozinha em ${until[3]}/${until[2]})` : ''}. Para liberar: console.anthropic.com → Settings → Limits → aumente o "Spend limit".`;
  }
  if (/credit balance/i.test(msg)) return 'Acabou o crédito da Anthropic. Para liberar: console.anthropic.com → Billing → adicione crédito.';
  if (status === 401 || /api key/i.test(msg)) return 'A chave da Anthropic (ANTHROPIC_API_KEY) está inválida. Gere uma nova no console.anthropic.com e atualize no Supabase.';
  if (status === 429) return 'A Anthropic está limitando o número de pedidos (muitos ao mesmo tempo). Costuma passar sozinho.';
  if (status >= 500) return 'A Anthropic está instável no momento. Costuma voltar sozinho.';
  return `A IA recusou os pedidos (erro ${status}: ${msg}).`;
}
