// Edge Function `team` — convites da equipe (só o admin da conta).
// O convite é um e-mail do Supabase Auth com o link para a pessoa criar a senha.
// O cadastro aberto fica desligado (Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" desligado):
// só entra quem foi convidado. A chave de serviço existe só aqui, nunca no site.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['admin', 'vendedor', 'leitura'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Endereço do site para o link do e-mail: o de onde o pedido veio (https), ou SITE_URL. */
function siteOf(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  if (/^https:\/\/[a-z0-9.-]+$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  // Quem pede: cliente com o JWT do próprio usuário (a RLS e as funções da equipe valem).
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: me } = await user.auth.getUser();
  if (!me.user) return json({ error: 'Faça login de novo.' }, 401);
  const [{ data: owner }, { data: admin }] = await Promise.all([user.rpc('current_owner'), user.rpc('is_admin')]);
  if (!owner || admin !== true) return json({ error: 'Só o administrador da conta pode convidar.' }, 403);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const admin_ = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const action = String(b.action ?? 'invite');

  // Tirar alguém da equipe: sai da conta e o login fica bloqueado (nada é apagado; dá para convidar de novo).
  if (action === 'remove' || action === 'role') {
    const userId = String(b.userId ?? '');
    const { data: m } = await admin_.from('team_members').select('user_id, email').eq('owner_id', owner).eq('user_id', userId).maybeSingle();
    if (!m) return json({ error: 'Pessoa não encontrada na equipe.' }, 404);
    if (userId === me.user.id) return json({ error: 'Você não pode alterar o seu próprio acesso.' }, 400);
    if (action === 'role') {
      const role = ROLES.includes(String(b.role)) ? String(b.role) : null;
      if (!role) return json({ error: 'Papel inválido.' }, 400);
      const { error } = await admin_.from('team_members').update({ role }).eq('user_id', userId).eq('owner_id', owner);
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    await admin_.from('team_members').delete().eq('user_id', userId).eq('owner_id', owner);
    await admin_.from('team_invites').delete().eq('owner_id', owner).eq('email', m.email ?? '');
    await admin_.auth.admin.updateUserById(userId, { ban_duration: '876000h' }).catch(() => undefined);
    return json({ ok: true });
  }
  if (action === 'cancel') {
    const email = String(b.email ?? '').trim().toLowerCase();
    await admin_.from('team_invites').delete().eq('owner_id', owner).eq('email', email).is('accepted_at', null);
    return json({ ok: true });
  }

  const email = String(b.email ?? '').trim().toLowerCase();
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const role = ROLES.includes(String(b.role)) ? String(b.role) : 'vendedor';
  if (!EMAIL.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
  if (email === (me.user.email ?? '').toLowerCase()) return json({ error: 'Esse é o seu próprio e-mail.' }, 400);

  // Já é da equipe desta conta?
  const { data: member } = await admin_.from('team_members').select('user_id').eq('owner_id', owner).eq('email', email).maybeSingle();
  if (member) return json({ error: 'Essa pessoa já faz parte da equipe.' }, 409);

  const { error: invErr } = await admin_
    .from('team_invites')
    .upsert({ owner_id: owner, email, role, name: name || null, accepted_at: null, created_at: new Date().toISOString() }, { onConflict: 'owner_id,email' });
  if (invErr) return json({ error: `Não foi possível salvar o convite: ${invErr.message}` }, 500);

  // Convidado de novo depois de removido: o login volta a valer.
  const { data: existing } = await admin_.from('team_members').select('user_id').eq('email', email).maybeSingle();
  if (!existing) {
    const { data: list } = await admin_.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = list?.users?.find((x: { id: string; email?: string; banned_until?: string }) => (x.email ?? '').toLowerCase() === email);
    if (u?.banned_until) await admin_.auth.admin.updateUserById(u.id, { ban_duration: 'none' }).catch(() => undefined);
  }

  const site = siteOf(req);
  const { error } = await admin_.auth.admin.inviteUserByEmail(email, {
    redirectTo: site ? `${site}/definir-senha?convite=1` : undefined,
    data: name ? { full_name: name } : undefined,
  });
  if (error) {
    // Já tem login no Lead Hunter: não precisa de e-mail; ao entrar, o convite é aceito sozinho.
    if (/already|registered|exists/i.test(error.message)) return json({ ok: true, existing: true });
    if (/rate|limit/i.test(error.message)) return json({ error: 'Limite de e-mails do Supabase atingido. Tente de novo em alguns minutos (ou configure o envio pelo Resend no Supabase).' }, 429);
    return json({ error: `Convite salvo, mas o e-mail não saiu: ${error.message}` }, 502);
  }
  return json({ ok: true, existing: false });
});
