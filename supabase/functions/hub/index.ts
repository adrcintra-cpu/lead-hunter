// Edge Function `hub` — integração com o Oxyhub (painel único dos sistemas Oxycom).
// Só ACRESCENTA: não altera tabelas, telas nem o login atual do Lead Hunter.
//
// O Oxyhub chama esta função do servidor dele, com o cabeçalho x-hub-secret, para:
//   { action: "pendencias", email }        → o que essa pessoa tem para fazer no Lead Hunter
//   { action: "acesso", email, para? }     → um link de acesso de uso único (a pessoa entra já logada)
//
// Secrets (Supabase → Edge Functions → Secrets):
//   HUB_SECRET  o mesmo valor de LEAD_HUB_SECRET no Oxyhub (32+ caracteres)
//   SITE_URL    endereço do Lead Hunter (ex.: https://lead-hunter.vercel.app)
// Publicar com "Verify JWT" desligado: a proteção é o x-hub-secret.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const SECRET = Deno.env.get('HUB_SECRET') ?? '';
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function userByEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Fim do dia de hoje no horário de Brasília, em UTC. */
function endOfTodayBrasilia() {
  const now = new Date(Date.now() - 3 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23 + 3, 59, 59)).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (SECRET.length < 32 || !sameSecret(req.headers.get('x-hub-secret') ?? '', SECRET)) return json({ error: 'forbidden' }, 403);

  let body: { action?: string; email?: string; para?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);

  const user = await userByEmail(email);
  if (!user) return json({ access: false });

  // Conta em uso: a do dono, para quem é da equipe
  const { data: tm } = await admin.from('team_members').select('owner_id').eq('user_id', user.id).maybeSingle();
  const owner = tm?.owner_id ?? user.id;

  if (body.action === 'acesso') {
    if (!SITE) return json({ error: 'SITE_URL não configurado' }, 500);
    const para = typeof body.para === 'string' && body.para.startsWith('/') && !body.para.startsWith('//') ? body.para : '/';
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: SITE + para } });
    if (error || !data?.properties?.action_link) return json({ error: error?.message ?? 'Não foi possível gerar o acesso' }, 500);
    return json({ access: true, url: data.properties.action_link });
  }

  if (body.action === 'pendencias') {
    const [tarefas, respostas, quentes] = await Promise.all([
      admin.from('tasks').select('id', { count: 'exact', head: true }).eq('owner_id', owner).eq('status', 'aberta').lte('due_at', endOfTodayBrasilia()),
      admin.from('leads').select('id', { count: 'exact', head: true }).eq('owner_id', owner).eq('stage', 'respondeu'),
      admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', owner)
        .eq('score_tier', 'alta')
        .in('stage', ['novo', 'qualificado', 'contato_preparado']),
    ]);
    return json({
      access: true,
      items: [
        { key: 'tarefas', label: 'tarefas para hoje ou atrasadas', count: tarefas.count ?? 0, para: '/tarefas', tone: 'changes' },
        { key: 'respostas', label: 'leads responderam e aguardam retorno', count: respostas.count ?? 0, para: '/pipeline', tone: 'primary' },
        { key: 'quentes', label: 'leads quentes ainda sem contato', count: quentes.count ?? 0, para: '/leads', tone: 'awaiting' },
      ],
    });
  }

  return json({ error: 'Ação desconhecida' }, 400);
});
