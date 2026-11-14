// Edge Function `hub` — integração com o Oxyhub (painel único dos sistemas Oxycom).
// Só ACRESCENTA: não altera tabelas, telas nem o login atual do Lead Hunter.
//
// O Oxyhub chama esta função do servidor dele, com o cabeçalho x-hub-secret, para:
//   { action: "pendencias", email }        → o que essa pessoa tem para fazer no Lead Hunter
//   { action: "acesso", email, para? }     → um link de acesso de uso único (a pessoa entra já logada)
//   { action: "eventos", email, from, to } → atividades com data para o OxyCalendar (somente leitura)
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


const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Início do dia (Brasília) em UTC. */
const dayStartUtc = (day: string) => `${day}T03:00:00.000Z`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const safeInner = (p: unknown) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null);

/** Eventos para o OxyCalendar: só o que tem data, horário ou prazo (nunca cada mensagem). */
async function eventos(owner: string, from: string, to: string) {
  const start = dayStartUtc(from);
  const end = dayStartUtc(addDays(to, 1));
  const now = new Date().toISOString();
  const [tasks, camps] = await Promise.all([
    admin
      .from('tasks')
      .select('id, lead_id, campaign_id, title, description, owner_name, due_at, status, source, action_url, created_at, done_at, leads(company_id, companies(legal_name, trade_name))')
      .eq('owner_id', owner)
      .not('due_at', 'is', null)
      .gte('due_at', start)
      .lt('due_at', end)
      .order('due_at')
      .limit(1000),
    admin
      .from('campaigns')
      .select('id, name, objective, owner_name, status, channel, scheduled_at, started_at, finished_at, updated_at')
      .eq('owner_id', owner)
      .limit(500),
  ]);
  if (tasks.error) throw tasks.error;
  if (camps.error) throw camps.error;

  const SOURCE_LABEL: Record<string, string> = { manual: 'Tarefa comercial', cadencia: 'Follow-up de cadência', resposta: 'Retorno ao lead' };
  const out: Record<string, unknown>[] = [];
  for (const t of tasks.data ?? []) {
    // deno-lint-ignore no-explicit-any
    const company = (t as any).leads?.companies;
    const open = t.status === 'aberta';
    out.push({
      source_record_id: t.id,
      kind: 'tarefa',
      kind_label: SOURCE_LABEL[t.source] ?? 'Tarefa comercial',
      title: t.title,
      description: t.description,
      start_at: t.due_at,
      end_at: null,
      all_day: false,
      client_id: t.lead_id,
      client_name: company ? company.trade_name || company.legal_name : null,
      responsible_user_id: owner,
      responsible_name: t.owner_name,
      status: open ? (t.due_at < now ? 'Vencida' : 'Pendente') : 'Concluída',
      status_tone: open ? (t.due_at < now ? 'changes' : 'awaiting') : 'approved',
      overdue: open && t.due_at < now,
      derived: false,
      source_path: safeInner(t.action_url) ?? (t.lead_id ? `/leads/${t.lead_id}` : '/tarefas'),
      updated_at: t.done_at ?? t.created_at,
    });
  }
  const CAMP: Record<string, [string, string]> = {
    rascunho: ['Rascunho', 'draft'],
    agendada: ['Agendada', 'awaiting'],
    ativa: ['Ativa', 'primary'],
    pausada: ['Pausada', 'draft'],
    finalizada: ['Finalizada', 'muted'],
  };
  for (const c of camps.data ?? []) {
    const [label, tone] = CAMP[c.status] ?? [c.status, 'primary'];
    const marks: [string, string, string | null][] = [
      ['campanha_inicio', c.status === 'agendada' ? 'Início programado da campanha' : 'Início da campanha', c.started_at ?? c.scheduled_at],
      ['campanha_fim', 'Fim da campanha', c.finished_at],
    ];
    for (const [kind, kindLabel, at] of marks) {
      if (!at || at < start || at >= end) continue;
      out.push({
        source_record_id: c.id,
        kind,
        kind_label: kindLabel,
        title: c.name,
        description: c.objective || null,
        start_at: at,
        end_at: null,
        all_day: false,
        client_id: null,
        client_name: null,
        responsible_user_id: owner,
        responsible_name: c.owner_name,
        status: label,
        status_tone: tone,
        overdue: false,
        derived: false,
        source_path: `/campanhas/${c.id}`,
        updated_at: c.updated_at,
      });
    }
  }
  return out;
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

  if (body.action === 'eventos') {
    // deno-lint-ignore no-explicit-any
    const { from, to } = body as any;
    if (!DAY_RE.test(String(from)) || !DAY_RE.test(String(to)) || to < from) return json({ error: 'Período inválido' }, 400);
    try {
      return json({ access: true, events: await eventos(owner, from, to) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Erro ao ler eventos' }, 500);
    }
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
