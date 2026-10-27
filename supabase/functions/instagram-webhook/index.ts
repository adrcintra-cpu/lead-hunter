// Edge Function `instagram-webhook` — a Meta avisa aqui quando chega mensagem no Direct.
// Publicar SEM verificação de JWT (quem chama é a Meta):
//   npx supabase functions deploy instagram-webhook --no-verify-jwt
// GET: verificação do webhook (hub.verify_token = INSTAGRAM_VERIFY_TOKEN).
// POST: confere a assinatura X-Hub-Signature-256 (META_APP_SECRET), responde 200 na hora
// e processa em segundo plano (grava a mensagem e, conforme o modo, o BEELIE sugere a resposta).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { logRun, runTask } from '../_shared/ai/claude.ts';
import { openToken } from '../_shared/instagram/crypto.ts';
import { metaConfig } from '../_shared/instagram/graph.ts';
import { ingest, parseEvents, suggest, verifyAnySignature, type Deps, type ReplyAnalysis } from '../_shared/instagram/inbox.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Espera alguns segundos: se a pessoa mandar várias mensagens seguidas, responde a última. */
const SETTLE_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const token = Deno.env.get('INSTAGRAM_VERIFY_TOKEN');
    const ok = !!token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token;
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Token inválido', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });

  const cfg = metaConfig();
  const raw = await req.text();
  // META_APP_SECRET (app) ou INSTAGRAM_APP_SECRET ("Chave secreta do app do Instagram", no caso de uso do Instagram).
  const secrets = [cfg?.appSecret, Deno.env.get('INSTAGRAM_APP_SECRET')].map((x) => x?.trim().replace(/^["']|["']$/g, ''));
  const header = req.headers.get('x-hub-signature-256');
  if (!cfg || !(await verifyAnySignature(raw, header, secrets))) {
    // Diagnóstico sem expor segredos: tamanho de cada chave e o começo das assinaturas.
    const peek = async (k?: string) => {
      if (!k) return null;
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
      return Array.from(mac.slice(0, 4), (x) => x.toString(16).padStart(2, '0')).join('');
    };
    console.warn('instagram-webhook: assinatura não confere', JSON.stringify({
      recebida: (header ?? '').slice(0, 15),
      tamanhos: secrets.map((k) => k?.length ?? 0),
      calculadas: await Promise.all(secrets.map(peek)),
      corpo: raw.length,
    }));
    return new Response('Assinatura inválida', { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('ok', { status: 200 });
  }
  const events = parseEvents(body);
  const b = body as { object?: string; entry?: { id?: string; messaging?: unknown[]; changes?: { field?: string }[] }[] };
  console.log('instagram-webhook: recebido', JSON.stringify({ object: b?.object, entries: (b?.entry ?? []).map((e) => ({ id: e.id, messaging: e.messaging?.length ?? 0, changes: (e.changes ?? []).map((c) => c.field) })), mensagens: events.length }));
  if (!events.length) return new Response('ok', { status: 200 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const deps: Deps = {
    openToken: (s) => openToken(s),
    runTask: async (input) => {
      const r = await runTask<ReplyAnalysis>('instagramReply', input);
      return { output: r.output, usage: r.usage };
    },
    logRun: (ownerId, started, status, usage) => logRun(db, ownerId, 'instagram_reply', started, status, usage),
  };

  const work = (async () => {
    const touched = new Map<string, { ownerId: string; at: number }>();
    for (const ev of events) {
      try {
        const r = await ingest(db, cfg, ev, deps);
        if (r?.inbound) touched.set(r.conversationId, { ownerId: r.ownerId, at: Date.now() });
      } catch (e) {
        console.error('instagram-webhook: falha ao gravar', (e as Error).message);
      }
    }
    if (!touched.size) return;
    await sleep(SETTLE_MS);
    for (const [conversationId, t] of touched) {
      try {
        // Chegou outra mensagem depois desta? Então a próxima chamada responde.
        const { data: last } = await db.from('instagram_messages').select('created_at').eq('conversation_id', conversationId).eq('direction', 'entrada').order('created_at', { ascending: false }).limit(1);
        const { data: pending } = await db.from('instagram_messages').select('id').eq('conversation_id', conversationId).eq('status', 'sugerida').gte('created_at', last?.[0]?.created_at ?? '1970-01-01').limit(1);
        if (pending?.length) continue;
        await suggest(db, cfg, t.ownerId, conversationId, deps);
      } catch (e) {
        console.error('instagram-webhook: falha ao sugerir', (e as Error).message);
      }
    }
  })();

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response('ok', { status: 200 });
});
