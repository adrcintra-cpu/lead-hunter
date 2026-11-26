// Edge Function `site-chat` — chat do Beelie no site do Oxyhub (visitantes, sem login).
// Publicar sem verificação de JWT: supabase functions deploy site-chat --no-verify-jwt
//
// POST { action: 'message', sessionId, text, topic? }  → { reply, askContact }
// POST { action: 'contact', sessionId, name, whatsapp?, email?, company?, consent: true } → { ok, reply }
//
// Proteções: limite de mensagens por conversa, por visitante (IP com hash) e por dia; textos curtos;
// a IA só recebe a conversa como dado; nada é gravado como lead sem o visitante deixar o contato com consentimento.

import { adminClient, log } from '../_shared/automation/engine.ts';
import { hasClaude, logRun, runTask } from '../_shared/ai/claude.ts';
import { withDefaults } from '../_shared/ai/assistantDefaults.ts';
import { formatBr, nationalDigits, SITE_ORIGIN, ufFromPhone } from '../_shared/automation/unknownInbound.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const MAX_PER_CHAT = 30; // mensagens do visitante numa conversa
const MAX_PER_VISITOR_DAY = 80; // mensagens do mesmo IP em 24 h
const MAX_CHATS_PER_VISITOR_DAY = 10;
const MAX_PER_DAY = Number(Deno.env.get('SITE_CHAT_MAX_PER_DAY') ?? 1500); // todas as conversas, em 24 h
const MAX_TEXT = 600;

const ORIGINS = (Deno.env.get('SITE_CHAT_ORIGINS') ?? 'https://oxyhub-landing.vercel.app,https://oxyhub.com.br,https://www.oxyhub.com.br,https://oxyhub.ai,https://www.oxyhub.ai')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowed = (origin: string) => ORIGINS.includes(origin) || /^https:\/\/oxyhub-landing[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);

function cors(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowed(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (origin: string, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'content-type': 'application/json; charset=utf-8' } });

async function sha(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').trim().slice(0, n) : '');

/** Dono do Beelie que atende o site: SITE_CHAT_OWNER_ID ou quem atende números desconhecidos. */
async function ownerOf(db: Row): Promise<string | null> {
  const env = Deno.env.get('SITE_CHAT_OWNER_ID');
  if (env) return env;
  const { data } = await db.from('assistant_settings').select('owner_id').eq('answer_unknown', true).limit(1).maybeSingle();
  return data?.owner_id ?? null;
}

const TOPICS: Record<string, string> = {
  solucoes: 'conhecer as soluções',
  demonstracao: 'agendar uma demonstração',
  duvida: 'tirar uma dúvida',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json(origin, { error: 'Método não permitido' }, 405);
  if (origin && !allowed(origin)) return json(origin, { error: 'Origem não permitida' }, 403);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json(origin, { error: 'Pedido inválido' }, 400);
  }
  const sessionId = clean(body.sessionId, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(sessionId)) return json(origin, { error: 'Sessão inválida' }, 400);
  // Campo escondido do formulário: robôs preenchem, pessoas não.
  if (clean(body.website, 200)) return json(origin, { reply: 'Obrigado!', askContact: false });

  const db = adminClient();
  const ownerId = await ownerOf(db);
  if (!ownerId) return json(origin, { error: 'Atendimento indisponível' }, 503);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
  const ipHash = await sha(`${ip}:${ownerId}`);
  const since = new Date(Date.now() - 864e5).toISOString();

  const { data: existing } = await db.from('site_chats').select('*').eq('session_id', sessionId).maybeSingle();
  if (existing && existing.owner_id !== ownerId) return json(origin, { error: 'Sessão inválida' }, 400);
  let chat: Row | null = existing;

  if (body.action === 'contact') {
    if (!chat) return json(origin, { error: 'Converse com o Beelie antes de deixar o contato.' }, 400);
    if (body.consent !== true) return json(origin, { error: 'É preciso aceitar o contato da Oxycom.' }, 400);
    const name = clean(body.name, 80);
    const company = clean(body.company, 120);
    const email = clean(body.email, 254).toLowerCase();
    const national = nationalDigits(clean(body.whatsapp, 30));
    if (!name) return json(origin, { error: 'Informe seu nome.' }, 400);
    if (!national && !/^\S+@\S+\.\S+$/.test(email)) return json(origin, { error: 'Informe um WhatsApp com DDD ou um e-mail válido.' }, 400);
    if (chat.lead_id) return json(origin, { ok: true, reply: `Obrigado, ${name.split(' ')[0]}! Já estamos com o seu contato.` });

    const msgs = (chat.messages ?? []) as Row[];
    const lastSummary = [...msgs].reverse().find((m) => m.summary)?.summary as string | undefined;
    const wantsDemo = msgs.some((m) => m.wantsDemo) || chat.topic === 'demonstracao';
    const at = new Date().toISOString();
    const src = { provider: 'site', fetchedAt: at };
    const legal = company || `${name} (site)`;
    const { data: comp, error: e1 } = await db
      .from('companies')
      .insert({
        owner_id: ownerId,
        legal_name: legal,
        segment: 'A identificar',
        city: 'A identificar',
        state: (national && ufFromPhone(national)) || 'SP',
        ...(national ? { whatsapp: formatBr(national), phone: formatBr(national), whatsapp_status: 'provavel' } : {}),
        field_provenance: { legalName: src, ...(national ? { whatsapp: src, phone: src } : {}) },
        dedupe_key: national ? `site:tel:${national}:${Date.now()}` : `site:email:${email}:${Date.now()}`,
        created_by: null,
      })
      .select('id')
      .single();
    if (e1 || !comp) {
      console.error('site-chat company', e1?.message);
      return json(origin, { error: 'Não consegui registrar agora. Tente de novo em instantes.' }, 500);
    }
    const { data: lead, error: e2 } = await db
      .from('leads')
      .insert({
        owner_id: ownerId,
        company_id: comp.id,
        origin: SITE_ORIGIN,
        stage: 'interessado',
        contact_name: name,
        ...(email ? { email } : {}),
        tags: ['site', 'site-chat', ...(wantsDemo ? ['site-demonstracao'] : [])],
        created_by: null,
      })
      .select('id')
      .single();
    if (e2 || !lead) {
      await db.from('companies').delete().eq('id', comp.id);
      console.error('site-chat lead', e2?.message);
      return json(origin, { error: 'Não consegui registrar agora. Tente de novo em instantes.' }, 500);
    }
    const transcript = msgs.map((m) => `${m.from === 'visitante' ? name : 'Beelie'}: ${m.text}`).join('\n').slice(0, 6000);
    await log(db, ownerId, lead.id, 'discovered', `Conversou com o Beelie no chat do site do Oxyhub e deixou o contato${lastSummary ? `: ${lastSummary}` : '.'}`, {
      kind: 'site_chat',
      chatId: chat.id,
      transcript,
    });
    await db.from('tasks').insert({
      owner_id: ownerId,
      lead_id: lead.id,
      title: `${wantsDemo ? 'Agendar demonstração com' : 'Retornar contato de'} ${name}${company ? ` (${company})` : ''} — site`,
      description: [
        lastSummary ? `Resumo: ${lastSummary}` : '',
        national ? `WhatsApp: ${formatBr(national)}` : '',
        email ? `E-mail: ${email}` : '',
        'Conversa completa no histórico do lead.',
      ]
        .filter(Boolean)
        .join('\n'),
      source: 'resposta',
      due_at: new Date(Date.now() + 4 * 3600e3).toISOString(),
    });
    await db.from('site_chats').update({ lead_id: lead.id, updated_at: at }).eq('id', chat.id);
    return json(origin, {
      ok: true,
      reply: `Obrigado, ${name.split(' ')[0]}! Um especialista da Oxycom vai falar com você ${national ? 'pelo WhatsApp' : 'por e-mail'} em breve. Enquanto isso, posso tirar mais alguma dúvida?`,
    });
  }

  // Mensagem do visitante
  const text = clean(body.text, MAX_TEXT);
  if (!text) return json(origin, { error: 'Mensagem vazia' }, 400);
  if (!hasClaude()) return json(origin, { error: 'Atendimento indisponível' }, 503);

  const [{ count: dayTotal }, { data: mine }] = await Promise.all([
    db.from('site_chats').select('id', { count: 'exact', head: true }).gte('updated_at', since).gt('user_messages', 0),
    db.from('site_chats').select('id, user_messages').eq('ip_hash', ipHash).gte('created_at', since),
  ]);
  const mineRows = (mine ?? []) as Row[];
  const ipMessages = mineRows.reduce((a, r) => a + (r.user_messages ?? 0), 0);
  if ((chat?.user_messages ?? 0) >= MAX_PER_CHAT || ipMessages >= MAX_PER_VISITOR_DAY || (!chat && mineRows.length >= MAX_CHATS_PER_VISITOR_DAY)) {
    return json(origin, { reply: 'Por hoje chegamos ao limite de mensagens por aqui. Para continuar, fale com a gente pelo WhatsApp.', askContact: false, limited: true });
  }
  // Teto geral (conversas ativas × média): proteção de custo
  if ((dayTotal ?? 0) * 6 >= MAX_PER_DAY) {
    return json(origin, { reply: 'O chat está com muita procura agora. Fale com a gente pelo WhatsApp, por favor.', askContact: false, limited: true });
  }

  const topicKey = clean(body.topic, 20);
  if (!chat) {
    const { data: created, error } = await db
      .from('site_chats')
      .insert({ owner_id: ownerId, session_id: sessionId, ip_hash: ipHash, topic: TOPICS[topicKey] ? topicKey : null })
      .select('*')
      .single();
    if (error || !created) return json(origin, { error: 'Não consegui iniciar a conversa.' }, 500);
    chat = created;
  }
  const c = chat as Row;
  const history = ((c.messages ?? []) as Row[]).slice(-16);
  const conversation = [...history.map((m) => ({ from: m.from, text: m.text })), { from: 'visitante' as const, text }];

  const { data: cfg } = await db.from('assistant_settings').select('name, persona, knowledge, playbooks').eq('owner_id', ownerId).maybeSingle();
  const assistant = withDefaults(cfg);
  const started = Date.now();
  let out: { reply: string; askContact: boolean; wantsDemo: boolean; offTopic: boolean; summary: string };
  try {
    const run = await runTask<typeof out>('siteChat', {
      assistant,
      topic: c.topic ? TOPICS[c.topic] : undefined,
      contactGiven: !!c.lead_id,
      conversation,
    });
    await logRun(db, ownerId, 'siteChat', started, 'ok', run.usage);
    out = run.output;
  } catch (err) {
    await logRun(db, ownerId, 'siteChat', started, 'error', {});
    console.error('siteChat', err instanceof Error ? err.message : String(err));
    return json(origin, { reply: 'Tive um problema para responder agora. Pode tentar de novo ou falar pelo WhatsApp?', askContact: false });
  }
  if (!out.reply) out.reply = 'Pode me contar um pouco mais?';

  const at = new Date().toISOString();
  const messages = [
    ...((c.messages ?? []) as Row[]),
    { from: 'visitante', text, at },
    { from: 'beelie', text: out.reply, at, wantsDemo: out.wantsDemo, summary: out.summary },
  ].slice(-80);
  await db
    .from('site_chats')
    .update({ messages, user_messages: (c.user_messages ?? 0) + 1, updated_at: at })
    .eq('id', c.id);

  // Já virou lead: a conversa continua registrada no histórico dele.
  if (c.lead_id) await log(db, ownerId, c.lead_id, 'reply_received', `Chat do site: ${text.slice(0, 300)}`, { kind: 'site_chat', chatId: c.id });

  return json(origin, { reply: out.reply, askContact: out.askContact && !c.lead_id });
});
