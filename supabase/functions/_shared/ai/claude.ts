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
      max_tokens: 1500,
      temperature: 0.2,
      system: task.system,
      tools: [{ name: 'responder', description: 'Devolve a resposta estruturada.', input_schema: task.schema }],
      tool_choice: { type: 'tool', name: 'responder' },
      messages: [{ role: 'user', content: task.user(input) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
  if (!block) throw new Error('Resposta sem saída estruturada');
  return { output: task.output(block.input) as T, usage: data.usage ?? {} };
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
