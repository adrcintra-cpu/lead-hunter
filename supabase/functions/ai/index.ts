// Edge Function `ai` — camada de IA no servidor (Claude API).
// A chave ANTHROPIC_API_KEY existe só aqui (supabase secrets set ANTHROPIC_API_KEY=...).
// O frontend chama: supabase.functions.invoke('ai', { body: { fn, input } }).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PROMPT_VERSION, TASKS, type TaskName } from '../_shared/ai/prompts.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!API_KEY) return json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }, 500);

  // Cliente com o JWT do próprio usuário: a RLS continua valendo.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return json({ error: 'Não autenticado' }, 401);

  let body: { fn?: TaskName; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const task = body.fn ? TASKS[body.fn] : undefined;
  if (!task) return json({ error: `Função desconhecida: ${body.fn}` }, 400);

  const started = Date.now();
  let status: 'ok' | 'error' = 'ok';
  let usage: { input_tokens?: number; output_tokens?: number } = {};
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0.2,
        system: task.system,
        tools: [{ name: 'responder', description: 'Devolve a resposta estruturada.', input_schema: task.schema }],
        tool_choice: { type: 'tool', name: 'responder' },
        messages: [{ role: 'user', content: task.user(body.input) }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    usage = data.usage ?? {};
    const block = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
    if (!block) throw new Error('Resposta sem saída estruturada');
    return json(task.output(block.input, body.input));
  } catch (err) {
    status = 'error';
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  } finally {
    await supabase.from('ai_runs').insert({
      owner_id: userData.user.id,
      fn: body.fn,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      latency_ms: Date.now() - started,
      status,
    });
  }
});
