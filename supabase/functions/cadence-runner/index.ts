// Edge Function `cadence-runner` — executa as etapas vencidas das cadências.
// Chamada pelo agendador (pg_cron, a cada 5 min) com o header Authorization: Bearer <CRON_SECRET>.
// Usa a service role (no servidor): processa as inscrições de todos os usuários, respeitando
// opt-out, opt-in de WhatsApp e a janela de envio de cada perfil.

import { adminClient, runDue } from '../_shared/automation/engine.ts';
import { timingSafeEqual } from '../_shared/channels/metaWhatsapp.ts';
import { closeSilentNavigations } from '../_shared/automation/menuNavDb.ts';
import { likeDue } from '../_shared/engagement/likes.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  const secret = Deno.env.get('CRON_SECRET');
  const auth = req.headers.get('Authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return new Response('Não autorizado', { status: 401 });
  try {
    const db = adminClient();
    const summary = await runDue(db);
    // Navegações em menu paradas há 24 h: encerra como "sem resposta" e passa para você.
    const silentNavs = await closeSilentNavigations(db).catch(() => 0);
    // Curtida automática no Instagram (só para quem ligou; 1 por vez, com intervalo e limite diário)
    const likes = await likeDue(db).catch(() => ({ liked: 0, skipped: 0 }));
    return Response.json({ ...summary, silentNavs, likes });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
});
