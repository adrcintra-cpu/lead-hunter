// Edge Function `ai` — camada de IA no servidor (Claude API).
// A chave ANTHROPIC_API_KEY existe só aqui (supabase secrets set ANTHROPIC_API_KEY=...).
// O frontend chama: supabase.functions.invoke('ai', { body: { fn, input } }).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { TASKS, type TaskName } from '../_shared/ai/prompts.ts';
import { hasClaude, logRun, runTask, type ClaudeRun } from '../_shared/ai/claude.ts';

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
  if (!hasClaude()) return json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }, 500);

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
  if (!body.fn || !TASKS[body.fn]) return json({ error: `Função desconhecida: ${body.fn}` }, 400);

  const started = Date.now();
  let usage: ClaudeRun['usage'] = {};
  try {
    const run = await runTask(body.fn, body.input);
    usage = run.usage;
    await logRun(supabase, userData.user.id, body.fn, started, 'ok', usage);
    return json(run.output);
  } catch (err) {
    await logRun(supabase, userData.user.id, body.fn, started, 'error', usage);
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
