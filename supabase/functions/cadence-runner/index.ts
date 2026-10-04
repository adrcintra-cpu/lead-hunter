// Edge Function `cadence-runner` — executa as etapas vencidas das cadências.
// Chamada pelo agendador (pg_cron, a cada 5 min) com o header Authorization: Bearer <CRON_SECRET>.
// Usa a service role (no servidor): processa as inscrições de todos os usuários, respeitando
// opt-out, opt-in de WhatsApp e a janela de envio de cada perfil.

import { adminClient, runDue } from '../_shared/automation/engine.ts';
import { timingSafeEqual } from '../_shared/channels/metaWhatsapp.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const secret = Deno.env.get('CRON_SECRET');
  const auth = req.headers.get('Authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return new Response('Não autorizado', { status: 401 });
  try {
    const summary = await runDue(adminClient());
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
});
