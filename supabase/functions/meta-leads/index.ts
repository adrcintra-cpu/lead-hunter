// Edge Function `meta-leads` — Meta Leads (formulários de anúncio do Facebook/Instagram) no Engajamento social.
// Ações (POST, com o login do OxySDR):
//   status      equipe: configuração, Páginas conectadas, pendências da Meta
//   start       admin: endereço do login do Facebook (permissões de leads, separadas das do Instagram)
//   callback    admin: troca o código, guarda o token cifrado das Páginas e inscreve o campo "leadgen"
//   import      admin: importa os leads antigos de uma Página (repetir enquanto more=true)
//   resubscribe admin: inscreve de novo o "leadgen" de uma Página
//   disconnect  admin: apaga o acesso guardado de uma Página
// Tokens nunca saem do backend. Os leads novos chegam pelo webhook (instagram-webhook, object "page").

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { signState, verifyState } from '../_shared/instagram/crypto.ts';
import { loginUrl, metaConfig, MetaError } from '../_shared/instagram/graph.ts';
import { exchangeForPages, importHistory, leadsScopes, pageToken, savePages, subscribeLeadgen, syncLog } from '../_shared/meta/leads.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Mesmo endereço de retorno do Instagram (já cadastrado no app da Meta); o state diz que é Meta Leads. */
function redirectOf(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  const site = /^https:\/\/[a-z0-9.-]+$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin) ? origin : (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  return `${site}/instagram/conectado`;
}

const REQUIRED = ['leads_retrieval', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: me } = await user.auth.getUser();
  if (!me.user) return json({ error: 'Faça login de novo.' }, 401);
  const [{ data: owner }, { data: isAdmin }] = await Promise.all([user.rpc('current_owner'), user.rpc('is_admin')]);
  if (!owner) return json({ error: 'Conta não encontrada.' }, 403);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const action = String(b.action ?? 'status');
  const base = metaConfig();
  const cfg = base ? { ...base, scopes: leadsScopes() } : null;
  const redirectUri = redirectOf(req);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const webhookUrl = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/instagram-webhook`;

  if (action === 'status') {
    const { data: pages } = await db.from('meta_pages').select('id, page_id, page_name, instagram_username, status, scopes, subscribed, last_sync_at, last_error, connected_at').eq('owner_id', owner).order('connected_at');
    const granted = new Set((pages ?? []).flatMap((p) => (p.scopes ?? []) as string[]));
    const { data: lastHook } = await db.from('meta_sync_logs').select('created_at, status').eq('owner_id', owner).eq('action', 'webhook_lead').order('created_at', { ascending: false }).limit(1);
    return json({
      configured: !!cfg,
      tokenKey: !!Deno.env.get('INSTAGRAM_TOKEN_KEY'),
      verifyToken: !!Deno.env.get('INSTAGRAM_VERIFY_TOKEN'),
      redirectUri,
      webhookUrl,
      scopes: cfg?.scopes ?? leadsScopes(),
      missingScopes: (pages ?? []).length ? REQUIRED.filter((s) => !granted.has(s)) : [],
      lastWebhookAt: lastHook?.[0]?.created_at ?? null,
      pages: pages ?? [],
    });
  }

  if (isAdmin !== true) return json({ error: 'Só o administrador da conta pode conectar Páginas ou importar leads.' }, 403);

  if (action === 'disconnect') {
    const { data: p } = await db.from('meta_pages').select('id, page_name').eq('owner_id', owner).eq('id', String(b.pageRef ?? '')).maybeSingle();
    if (!p) return json({ error: 'Página não encontrada.' }, 404);
    await db.from('meta_page_tokens').delete().eq('page_ref', p.id);
    await db.from('meta_pages').update({ status: 'desconectado', subscribed: false }).eq('id', p.id);
    await syncLog(db, owner, 'pagina_desconectada', 'ok', { pagina: p.page_name, por: me.user.id });
    return json({ ok: true });
  }

  if (!cfg) return json({ error: 'A integração com a Meta ainda não foi configurada (faltam META_APP_ID e META_APP_SECRET).', code: 'nao_configurado' }, 409);
  if (!Deno.env.get('INSTAGRAM_TOKEN_KEY')) return json({ error: 'Falta a chave que protege os tokens (INSTAGRAM_TOKEN_KEY).', code: 'nao_configurado' }, 409);

  if (action === 'start') {
    const state = await signState({ owner, user: me.user.id, k: 'meta-leads' } as unknown as { owner: string; user: string }, cfg.appSecret);
    return json({ url: loginUrl(cfg, redirectUri, state) });
  }

  if (action === 'callback') {
    const st = await verifyState(String(b.state ?? ''), cfg.appSecret);
    if (!st || st.owner !== owner || st.user !== me.user.id) {
      await syncLog(db, owner, 'conexao_recusada', 'erro', { motivo: 'state inválido ou vencido' });
      return json({ error: 'Este link de conexão venceu ou não é seu. Clique em "Conectar Página" de novo.' }, 400);
    }
    const code = String(b.code ?? '');
    if (!code || code.length > 2000) return json({ error: 'Código de autorização ausente.' }, 400);
    try {
      const r = await exchangeForPages(cfg, code, redirectUri);
      if (!r.pages.length) {
        await syncLog(db, owner, 'conexao_sem_pagina', 'erro', { permissoes: r.scopes, recusadas: r.declined });
        return json({ error: 'Nenhuma Página do Facebook foi liberada nessa conexão. Conecte de novo e marque a Página que recebe os leads dos anúncios.' }, 422);
      }
      const saved = await savePages(db, owner, me.user.id, r.pages, r.scopes);
      const results: { page: string; subscribed: boolean; error?: string }[] = [];
      for (const p of r.pages) {
        const ref = saved.find((x) => x.page_id === p.pageId)!;
        try {
          const fields = await subscribeLeadgen(cfg, p.pageId, p.token);
          await db.from('meta_pages').update({ subscribed: true }).eq('id', ref.id);
          await syncLog(db, owner, 'pagina_inscrita', 'ok', { pagina: p.name, campos: fields });
          results.push({ page: p.name ?? p.pageId, subscribed: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.from('meta_pages').update({ subscribed: false, last_error: msg.slice(0, 300) }).eq('id', ref.id);
          await syncLog(db, owner, 'pagina_inscrita', 'erro', { pagina: p.name, erro: msg.slice(0, 300) });
          results.push({ page: p.name ?? p.pageId, subscribed: false, error: msg });
        }
      }
      return json({ ok: true, pages: results, declined: r.declined.filter((s) => REQUIRED.includes(s)) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await syncLog(db, owner, 'conexao_falhou', 'erro', { erro: msg.slice(0, 300), codigo: e instanceof MetaError ? e.code : undefined });
      return json({ error: msg }, 502);
    }
  }

  const { data: page } = await db.from('meta_pages').select('id, page_id, page_name, status').eq('owner_id', owner).eq('id', String(b.pageRef ?? '')).maybeSingle();
  if (!page || page.status === 'desconectado') return json({ error: 'Página não encontrada ou desconectada.' }, 404);

  if (action === 'resubscribe') {
    const token = await pageToken(db, page.id);
    if (!token) return json({ error: 'Sem acesso guardado para a Página. Conecte de novo.' }, 409);
    try {
      await subscribeLeadgen(cfg, page.page_id, token);
      await db.from('meta_pages').update({ subscribed: true, last_error: null, status: 'conectado' }).eq('id', page.id);
      await syncLog(db, owner, 'pagina_inscrita', 'ok', { pagina: page.page_name });
      return json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('meta_pages').update({ last_error: msg.slice(0, 300) }).eq('id', page.id);
      return json({ error: msg }, 502);
    }
  }

  if (action === 'import') {
    try {
      const r = await importHistory(db, cfg, owner, page);
      await syncLog(db, owner, 'importacao', r.erros ? 'erro' : 'ok', { pagina: page.page_name, ...r });
      return json({ ok: true, ...r });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('meta_pages').update({ last_error: msg.slice(0, 300), ...(e instanceof MetaError && e.kind === 'token' ? { status: 'erro' } : {}) }).eq('id', page.id);
      await syncLog(db, owner, 'importacao', 'erro', { pagina: page.page_name, erro: msg.slice(0, 300) });
      return json({ error: msg }, 502);
    }
  }

  return json({ error: 'Ação desconhecida.' }, 400);
});
