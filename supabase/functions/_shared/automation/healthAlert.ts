// Avisa o dono no WhatsApp quando a IA do BEELIE para (limite de gasto, crédito, chave inválida)
// e quando volta. O aviso não usa a IA: vai direto pelo serviço do WhatsApp.
// Controle de repetição: o próprio aviso fica registrado em ai_runs (fn = alerta_ia_*).

import { MODEL } from '../ai/claude.ts';
import { notifyOwner } from './ownerChat.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Fetch = typeof fetch;

export const ALERT_DOWN = 'alerta_ia_parada';
export const ALERT_UP = 'alerta_ia_voltou';
const WINDOW_MS = 30 * 60_000;
const REPEAT_MS = 12 * 3600_000;
const MIN_ERRORS = 3;

/** Pergunta mínima à Anthropic só para saber o motivo do erro (com a conta bloqueada, não é cobrada). */
export async function probeClaude(fetchImpl: Fetch = fetch): Promise<string | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return 'A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.';
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return null;
    return explainClaudeError(res.status, await res.text().catch(() => ''));
  } catch {
    return 'A IA não respondeu (falha de conexão).';
  }
}

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

async function lastAlert(db: Db, ownerId: string): Promise<Row | null> {
  const { data } = await db.from('ai_runs').select('fn, created_at').eq('owner_id', ownerId).in('fn', [ALERT_DOWN, ALERT_UP]).order('created_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

async function record(db: Db, ownerId: string, fn: string) {
  await db.from('ai_runs').insert({ owner_id: ownerId, fn, model: MODEL, prompt_version: 'alerta', latency_ms: 0, status: 'ok' });
}

/** Chamado pelo cadence-runner a cada rodada. Devolve quantos avisos foram enviados. */
export async function checkAiHealth(db: Db, now = new Date(), fetchImpl: Fetch = fetch): Promise<number> {
  const { data: owners } = await db.from('assistant_settings').select('owner_id, owner_whatsapp').not('owner_whatsapp', 'is', null);
  let sent = 0;
  let reason: string | null | undefined; // um teste por rodada, vale para todos os donos
  for (const o of (owners ?? []) as Row[]) {
    if (!String(o.owner_whatsapp ?? '').trim()) continue;
    const since = new Date(now.getTime() - WINDOW_MS).toISOString();
    const { data: runs } = await db.from('ai_runs').select('status, fn, created_at').eq('owner_id', o.owner_id).gte('created_at', since).order('created_at', { ascending: false }).limit(200);
    const real = ((runs ?? []) as Row[]).filter((r) => !String(r.fn).startsWith('alerta_ia'));
    const errors = real.filter((r) => r.status === 'error').length;
    const oks = real.filter((r) => r.status === 'ok').length;
    const last = await lastAlert(db, o.owner_id);

    if (errors >= MIN_ERRORS && oks === 0) {
      const recent = last?.fn === ALERT_DOWN && now.getTime() - new Date(last.created_at).getTime() < REPEAT_MS;
      if (recent) continue;
      if (reason === undefined) reason = await probeClaude(fetchImpl);
      if (reason === null) continue; // a IA respondeu agora: foi um soluço
      await record(db, o.owner_id, ALERT_DOWN);
      const text = `⚠️ A IA do BEELIE parou de funcionar.\n\n${reason}\n\nEnquanto isso ele não escreve mensagens novas, não responde leads e não manda e-mails. O que ficou parado sai sozinho quando a IA voltar.`;
      if (await notifyOwner(o.owner_id, text)) sent++;
    } else if (last?.fn === ALERT_DOWN && oks > 0 && real[0]?.status === 'ok') {
      await record(db, o.owner_id, ALERT_UP);
      if (await notifyOwner(o.owner_id, '✅ A IA do BEELIE voltou a funcionar. Ele já retomou as mensagens e respostas.')) sent++;
    }
  }
  return sent;
}
