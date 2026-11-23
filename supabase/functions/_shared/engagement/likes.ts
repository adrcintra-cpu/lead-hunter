// Curtida automática — Like Media and Comments API da Meta (POST /{ig-user-id}/likes).
// Permissão: instagram_basic + instagram_manage_engagement. Não curte Stories nem contas privadas.
// Só curte (a API não comenta em posts de terceiros). Ritmo humano: 1 curtida por vez, intervalo
// mínimo entre curtidas, só em horário comercial e com limite diário configurável.

import { graph, metaConfig, MetaError } from '../instagram/graph.ts';
import { openToken } from '../instagram/crypto.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
type Row = Record<string, unknown>;

export const LIKE_SCOPE = 'instagram_manage_engagement';
const MIN_GAP_MIN = 9; // minutos mínimos entre duas curtidas
const HOURS = [8, 21]; // janela (horário de São Paulo)

const spNow = () => new Date(Date.now() - 3 * 3600_000);
const spDay = () => spNow().toISOString().slice(0, 10);
/** Início do dia de hoje em São Paulo, em UTC. */
const dayStartUtc = () => new Date(spDay() + 'T03:00:00Z').toISOString();
const addDays = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10);

/** Conta conectada + token para curtir (token de usuário quando houver; senão o da página). */
export async function likeAccess(db: Db, owner: string) {
  const cfg = metaConfig();
  if (!cfg) return { error: 'Meta não configurada no servidor.' } as const;
  const { data: settings } = await db.from('instagram_settings').select('account_id').eq('owner_id', owner).maybeSingle();
  let q = db.from('instagram_accounts').select('id, ig_user_id, scopes').eq('owner_id', owner).eq('status', 'conectado');
  if (settings?.account_id) q = q.eq('id', settings.account_id);
  const { data: acc } = await q.limit(1).maybeSingle();
  if (!acc) return { error: 'Nenhuma conta do Instagram conectada.' } as const;
  if (!((acc.scopes as string[] | null) ?? []).includes(LIKE_SCOPE))
    return { error: 'Falta a permissão de curtir (instagram_manage_engagement). Adicione no app da Meta e reconecte o Instagram.' } as const;
  const { data: tok } = await db.from('instagram_tokens').select('token_enc, user_token_enc').eq('account_id', acc.id).maybeSingle();
  const enc = tok?.user_token_enc || tok?.token_enc;
  if (!enc) return { error: 'Autorização do Instagram não encontrada. Reconecte a conta.' } as const;
  return { cfg, igId: String(acc.ig_user_id), token: await openToken(enc) } as const;
}

/** Curte um item da fila (post de lead/tema por media_id, ou comentário no próprio post por external_id). */
export async function likeItem(db: Db, owner: string, item: Row, actor: string | null = null): Promise<{ ok: true } | { ok: false; error: string; stop?: boolean }> {
  const target: Record<string, string> | null = item.kind === 'resposta' && item.external_id ? { comment_id: String(item.external_id) } : item.media_id ? { media_id: String(item.media_id) } : null;
  if (!target) return { ok: false, error: 'Este item não tem post para curtir.' };
  const acc = await likeAccess(db, owner);
  if ('error' in acc) return { ok: false, error: acc.error!, stop: true };
  try {
    await graph(acc.cfg, `${acc.igId}/likes`, { ...target, access_token: acc.token }, { method: 'POST' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'A Meta recusou a curtida.';
    const stop = e instanceof MetaError && (e.kind === 'token' || e.kind === 'limite');
    await db.from('engagement_queue').update({ like_error: msg.slice(0, 300) }).eq('id', item.id).eq('owner_id', owner);
    return { ok: false, error: msg, stop };
  }
  const now = new Date().toISOString();
  await db.from('engagement_queue').update({ liked_at: now, like_error: null }).eq('id', item.id).eq('owner_id', owner);
  await db.from('engagement_settings').update({ last_like_at: now }).eq('owner_id', owner);
  if (item.lead_id)
    await db.from('lead_activities').insert({ owner_id: owner, lead_id: item.lead_id, actor_id: actor, type: 'note_added', description: `Curtida no Instagram${actor ? '' : ' (automática)'}`, payload: { channel: 'instagram', url: item.target_url } }).then(() => null, () => null);
  return { ok: true };
}

/** Rodada do agendador (a cada 5 min): no máximo 1 curtida por conta, respeitando janela, intervalo e limite diário. */
export async function likeDue(db: Db): Promise<{ liked: number; skipped: number }> {
  const h = spNow().getUTCHours();
  if (h < HOURS[0] || h >= HOURS[1]) return { liked: 0, skipped: 0 };
  const { data: owners } = await db.from('engagement_settings').select('owner_id, daily_likes, last_like_at').eq('auto_like', true);
  let liked = 0;
  let skipped = 0;
  for (const s of owners ?? []) {
    const owner = String(s.owner_id);
    const last = s.last_like_at ? new Date(String(s.last_like_at)).getTime() : 0;
    // Intervalo mínimo + sorteio: as curtidas não caem em horários redondos
    if (Date.now() - last < MIN_GAP_MIN * 60_000 || Math.random() < 0.35) {
      skipped++;
      continue;
    }
    const { count } = await db.from('engagement_queue').select('id', { count: 'exact', head: true }).eq('owner_id', owner).gte('liked_at', dayStartUtc());
    if ((count ?? 0) >= Number(s.daily_likes ?? 20)) continue;
    const { data: items } = await db
      .from('engagement_queue')
      .select('id, kind, media_id, external_id, lead_id, target_url')
      .eq('owner_id', owner)
      .eq('channel', 'instagram')
      .is('liked_at', null)
      .is('like_error', null)
      .neq('status', 'descartada')
      .gte('for_date', addDays(spDay(), -3))
      .or('and(kind.eq.comentario,media_id.not.is.null),and(kind.eq.resposta,external_id.not.is.null)')
      .order('created_at', { ascending: true })
      .limit(20);
    // Comentários recebidos nos próprios posts primeiro; depois os posts da fila, em ordem aleatória
    const list = (items ?? []) as Row[];
    const own = list.filter((i) => i.kind === 'resposta');
    const rest = list.filter((i) => i.kind !== 'resposta').sort(() => Math.random() - 0.5);
    const item = own[0] ?? rest[0];
    if (!item) continue;
    const r = await likeItem(db, owner, item);
    if (r.ok) liked++;
    else if (r.stop) await db.from('engagement_settings').update({ last_like_at: new Date().toISOString() }).eq('owner_id', owner);
  }
  return { liked, skipped };
}
