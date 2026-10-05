// Chamada única à Claude API (tool_use com saída estruturada).
// Usada pela função `ai` (chamada pelo app) e pelo runner/webhooks (servidor).
// A chave ANTHROPIC_API_KEY existe só no servidor.

import { PROMPT_VERSION, TASKS, type TaskName } from './prompts.ts';

export const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';

export interface ClaudeRun<T = unknown> {
  output: T;
  usage: { input_tokens?: number; output_tokens?: number };
}

export function hasClaude(): boolean {
  return !!Deno.env.get('ANTHROPIC_API_KEY');
}

/**
 * Saída estruturada (output_config.format): todo objeto precisa de additionalProperties: false,
 * e limites numéricos/de texto não são aceitos no schema — viram descrição.
 */
// deno-lint-ignore no-explicit-any
export function strictSchema(node: any): any {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  // deno-lint-ignore no-explicit-any
  const out: any = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format'].includes(k)) {
      notes.push(`${k}: ${v}`);
      continue;
    }
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v);
  }
  if (notes.length) out.description = [out.description, `(${notes.join(', ')})`].filter(Boolean).join(' ');
  const isObject = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object'));
  if (isObject) out.additionalProperties = false;
  return out;
}

export async function runTask<T = unknown>(fn: TaskName, input: unknown): Promise<ClaudeRun<T>> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor');
  const task = TASKS[fn];
  if (!task) throw new Error(`Função desconhecida: ${fn}`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: task.system,
      messages: [{ role: 'user', content: task.user(input) }],
      // Resposta em JSON garantida pelo schema da tarefa.
      output_config: { format: { type: 'json_schema', schema: strictSchema(task.schema) } },
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou a tarefa.');
  if (data.stop_reason === 'max_tokens') throw new Error('Resposta da IA cortada (limite de tokens).');
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Resposta da IA fora do formato esperado.');
  }
  // deno-lint-ignore no-explicit-any
  return { output: task.output(raw as any) as T, usage: data.usage ?? {} };
}

// Registro de auditoria em ai_runs (append-only). `db` é um cliente supabase-js.
// deno-lint-ignore no-explicit-any
export async function logRun(db: any, ownerId: string, fn: string, started: number, status: 'ok' | 'error', usage: ClaudeRun['usage']) {
  await db.from('ai_runs').insert({
    owner_id: ownerId,
    fn,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    latency_ms: Date.now() - started,
    status,
  });
}
