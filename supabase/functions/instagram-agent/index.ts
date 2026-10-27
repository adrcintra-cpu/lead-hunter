// Edge Function `instagram-agent` — ações do Inbox feitas pela equipe no OxyHub.
// Ações (POST, com o login do OxyHub):
//   send        { conversationId, text, suggestionId? }   vendedor/admin: envia no Direct (aprovação)
//   suggest     { conversationId }                        vendedor/admin: pede nova sugestão ao BEELIE
//   human       { conversationId, on }                    vendedor/admin: passa para humano / devolve ao BEELIE
//   lead        { conversationId }                        vendedor/admin: cria ou liga o lead no Lead Hunter
//   subscribe   {}                                        admin: inscreve a Página para receber mensagens
// Quem é "só leitura" não executa nada aqui. Tokens nunca saem do servidor.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { logRun, runTask } from '../_shared/ai/claude.ts';
import { openToken } from '../_shared/instagram/crypto.ts';
import { graph, metaConfig } from '../_shared/instagram/graph.ts';
import { sendText, setHuman, subscribePage, suggest, toLead, type Deps, type ReplyAnalysis } from '../_shared/instagram/inbox.ts';
import { logOp } from '../_shared/instagram/accounts.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Proteção simples contra cliques repetidos: a mesma ação na mesma conversa, uma por vez.
const busy = new Set<string>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: me } = await user.auth.getUser();
  if (!me.user) return json({ error: 'Faça login de novo.' }, 401);
  const [{ data: owner }, { data: canWrite }, { data: isAdmin }] = await Promise.all([user.rpc('current_owner'), user.rpc('can_write'), user.rpc('is_admin')]);
  if (!owner) return json({ error: 'Conta não encontrada.' }, 403);
  if (canWrite !== true) return json({ error: 'Seu acesso é só de leitura.' }, 403);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const cfg = metaConfig();
  if (!cfg) return json({ error: 'A integração com a Meta ainda não foi configurada.' }, 409);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const deps: Deps = {
    openToken: (s) => openToken(s),
    runTask: async (input) => {
      const r = await runTask<ReplyAnalysis>('instagramReply', input);
      return { output: r.output, usage: r.usage };
    },
    logRun: (ownerId, started, status, usage) => logRun(db, ownerId, 'instagram_reply', started, status, usage),
  };
  const action = String(b.action ?? '');
  const conversationId = String(b.conversationId ?? '');

  // Diagnóstico (admin): o que a Página tem inscrito e o que a Meta responde ao tentar inscrever.
  if (action === 'diagnose') {
    if (isAdmin !== true) return json({ error: 'Só o administrador.' }, 403);
    const { data: accs } = await db.from('instagram_accounts').select('id, page_id, ig_user_id, username').eq('owner_id', owner).eq('status', 'conectado');
    const out: Record<string, unknown>[] = [];
    for (const a of accs ?? []) {
      const { data: t } = await db.from('instagram_tokens').select('token_enc').eq('account_id', a.id).maybeSingle();
      if (!t?.token_enc || !a.page_id) continue;
      const token = await openToken(t.token_enc);
      const r: Record<string, unknown> = { conta: a.username };
      const g = async (path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') => {
        try {
          return await graph(cfg, path, { ...params, access_token: token }, { method });
        } catch (e) {
          return { erro: (e as Error).message };
        }
      };
      r.antes = await g(`${a.page_id}/subscribed_apps`, {});
      r.messages = await g(`${a.page_id}/subscribed_apps`, { subscribed_fields: 'messages' }, 'POST');
      r.depois = await g(`${a.page_id}/subscribed_apps`, {});
      r.conta_ig = await g(a.ig_user_id, { fields: 'id,username' });
      out.push(r);
    }
    await logOp(db, owner, me.user.id, 'diagnostico', 'ok', { resultado: out });
    return json({ ok: true, resultado: out });
  }

  if (action === 'subscribe') {
    if (isAdmin !== true) return json({ error: 'Só o administrador.' }, 403);
    const { data: accs } = await db.from('instagram_accounts').select('id, page_id, username').eq('owner_id', owner).eq('status', 'conectado');
    const out: { username: string | null; ok: boolean }[] = [];
    for (const a of accs ?? []) {
      const { data: t } = await db.from('instagram_tokens').select('token_enc').eq('account_id', a.id).maybeSingle();
      const fields = t?.token_enc && a.page_id ? await subscribePage(cfg, a.page_id, await openToken(t.token_enc)) : null;
      await logOp(db, owner, me.user.id, 'pagina_inscrita', fields ? 'ok' : 'erro', { conta: a.username, campos: fields });
      out.push({ username: a.username, ok: !!fields });
    }
    return json({ ok: out.every((x) => x.ok), accounts: out });
  }

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: 'Conversa inválida.' }, 400);
  const key = `${action}:${conversationId}`;
  if (busy.has(key)) return json({ error: 'Essa ação já está em andamento.' }, 409);
  busy.add(key);
  try {
    if (action === 'send') {
      const r = await sendText(db, cfg, owner, conversationId, String(b.text ?? ''), me.user.id, { suggestionId: typeof b.suggestionId === 'string' ? b.suggestionId : undefined }, deps);
      return r.ok ? json(r) : json(r, r.code === 'meta' ? 502 : 409);
    }
    if (action === 'suggest') {
      const r = await suggest(db, cfg, owner, conversationId, deps, new Date(), { force: true });
      return r.status === 'ignorada' ? json({ error: r.reason }, 409) : json(r);
    }
    if (action === 'human') {
      const ok = await setHuman(db, owner, conversationId, b.on === true, me.user.id);
      return ok ? json({ ok: true }) : json({ error: 'Conversa não encontrada.' }, 404);
    }
    if (action === 'lead') {
      const { data: conv } = await db.from('instagram_conversations').select('summary').eq('id', conversationId).eq('owner_id', owner).maybeSingle();
      const r = await toLead(db, owner, conversationId, me.user.id, conv?.summary ? { contact: { name: null, company: null, phone: null, email: null, city: null, state: null, segment: null }, summary: conv.summary } : null);
      return r.leadId ? json(r) : json({ error: 'Não foi possível criar o lead.' }, 500);
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    busy.delete(key);
  }
});
