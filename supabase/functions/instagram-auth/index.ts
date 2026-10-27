// Edge Function `instagram-auth` — conectar e desconectar contas do Instagram (login oficial da Meta).
// Ações (POST, com o login do OxyHub):
//   status      qualquer pessoa da equipe: se a Meta já foi configurada e o endereço de retorno
//   start       admin: devolve o endereço da tela de login do Facebook
//   callback    admin: recebe o código do login, troca pelo acesso e guarda o token cifrado
//   disconnect  admin: apaga o token guardado
// Nunca recebe senha do Instagram. Tokens não saem do backend.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { signState, verifyState } from '../_shared/instagram/crypto.ts';
import { exchangeCode, loginUrl, metaConfig, MetaError } from '../_shared/instagram/graph.ts';
import { disconnect, logOp, noAccountReason, saveConnection } from '../_shared/instagram/accounts.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Endereço de retorno do login: o site de onde o pedido veio (https), ou SITE_URL. Precisa estar cadastrado no app da Meta. */
function redirectOf(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  const site = /^https:\/\/[a-z0-9.-]+$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin) ? origin : (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  return `${site}/instagram/conectado`;
}

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
  const cfg = metaConfig();
  const redirectUri = redirectOf(req);

  if (action === 'status') return json({ configured: !!cfg, tokenKey: !!Deno.env.get('INSTAGRAM_TOKEN_KEY'), redirectUri, scopes: cfg?.scopes ?? [] });

  if (isAdmin !== true) return json({ error: 'Só o administrador da conta pode conectar ou desconectar o Instagram.' }, 403);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  if (action === 'disconnect') {
    const ok = await disconnect(db, owner, me.user.id, String(b.accountId ?? ''));
    return ok ? json({ ok: true }) : json({ error: 'Conta não encontrada.' }, 404);
  }

  if (!cfg) return json({ error: 'A integração com a Meta ainda não foi configurada (faltam META_APP_ID e META_APP_SECRET).', code: 'nao_configurado' }, 409);
  if (!Deno.env.get('INSTAGRAM_TOKEN_KEY')) return json({ error: 'Falta a chave que protege os tokens (INSTAGRAM_TOKEN_KEY).', code: 'nao_configurado' }, 409);

  if (action === 'start') {
    const state = await signState({ owner, user: me.user.id }, cfg.appSecret);
    return json({ url: loginUrl(cfg, redirectUri, state) });
  }

  if (action === 'callback') {
    const st = await verifyState(String(b.state ?? ''), cfg.appSecret);
    if (!st || st.owner !== owner || st.user !== me.user.id) {
      await logOp(db, owner, me.user.id, 'conexao_recusada', 'bloqueado', { motivo: 'state inválido ou vencido' });
      return json({ error: 'Este link de conexão venceu ou não é seu. Clique em "Conectar conta" de novo.' }, 400);
    }
    const code = String(b.code ?? '');
    if (!code || code.length > 2000) return json({ error: 'Código de autorização ausente.' }, 400);
    try {
      const r = await exchangeCode(cfg, code, redirectUri);
      if (!r.accounts.length) {
        await logOp(db, owner, me.user.id, 'conexao_sem_conta', 'erro', { permissoes: r.scopes, recusadas: r.declined });
        return json({ error: noAccountReason(r) }, 422);
      }
      const saved = await saveConnection(db, owner, me.user.id, r);
      return json({ ok: true, accounts: saved, declined: r.declined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logOp(db, owner, me.user.id, 'conexao_falhou', 'erro', { erro: msg.slice(0, 300), codigo: e instanceof MetaError ? e.code : undefined });
      return json({ error: msg }, 502);
    }
  }

  return json({ error: 'Ação desconhecida.' }, 400);
});
