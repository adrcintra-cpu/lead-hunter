// Instagram Agent — gravação das contas conectadas (chamado pela função instagram-auth com service role).
// O token vai cifrado para instagram_tokens (tabela que o site não lê). Tudo fica registrado em instagram_logs.

import { sealToken } from './crypto.ts';
import type { ConnectResult } from './graph.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export async function logOp(db: Db, ownerId: string, actorId: string | null, action: string, status: 'ok' | 'erro' | 'bloqueado', detail?: Record<string, unknown>) {
  await db.from('instagram_logs').insert({ owner_id: ownerId, actor_id: actorId, action, status, detail: detail ?? null }).then(() => null, () => null);
}

/** Salva as contas encontradas no login. Devolve as contas gravadas (sem token). */
export async function saveConnection(db: Db, ownerId: string, actorId: string, r: ConnectResult, seal: (t: string) => Promise<string> = sealToken) {
  const saved: { id: string; username: string | null }[] = [];
  for (const a of r.accounts) {
    const { data: row, error } = await db
      .from('instagram_accounts')
      .upsert(
        {
          owner_id: ownerId,
          ig_user_id: a.igUserId,
          username: a.username,
          page_id: a.pageId,
          status: 'conectado',
          scopes: r.scopes,
          token_expires_at: r.expiresAt,
          last_error: null,
          connected_by: actorId,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id,ig_user_id' },
      )
      .select('id, username')
      .single();
    if (error || !row) throw new Error(`Não foi possível salvar a conta @${a.username ?? a.igUserId}.`);
    const { error: tErr } = await db.from('instagram_tokens').upsert({ account_id: row.id, token_enc: await seal(a.pageToken), updated_at: new Date().toISOString() }, { onConflict: 'account_id' });
    if (tErr) throw new Error('Não foi possível guardar a autorização com segurança.');
    saved.push(row);
  }
  // Primeira conta vira a selecionada nas configurações (o módulo continua desligado até você ligar).
  if (saved.length) {
    const { data: s } = await db.from('instagram_settings').select('owner_id, account_id').eq('owner_id', ownerId).maybeSingle();
    if (!s) await db.from('instagram_settings').insert({ owner_id: ownerId, account_id: saved[0].id });
    else if (!s.account_id) await db.from('instagram_settings').update({ account_id: saved[0].id }).eq('owner_id', ownerId);
  }
  await logOp(db, ownerId, actorId, 'conta_conectada', 'ok', { contas: saved.map((x) => x.username), permissoes: r.scopes, recusadas: r.declined });
  return saved;
}

/** Desconecta: apaga o token guardado e marca a conta como desconectada (o histórico fica). */
export async function disconnect(db: Db, ownerId: string, actorId: string, accountId: string) {
  const { data: acc } = await db.from('instagram_accounts').select('id, username').eq('owner_id', ownerId).eq('id', accountId).maybeSingle();
  if (!acc) return false;
  await db.from('instagram_tokens').delete().eq('account_id', accountId);
  await db.from('instagram_accounts').update({ status: 'desconectado', last_error: null }).eq('id', accountId).eq('owner_id', ownerId);
  await db.from('instagram_settings').update({ account_id: null }).eq('owner_id', ownerId).eq('account_id', accountId);
  await logOp(db, ownerId, actorId, 'conta_desconectada', 'ok', { conta: acc.username });
  return true;
}

/** Explica por que o login não trouxe nenhuma conta. */
export function noAccountReason(r: ConnectResult): string {
  if (r.declined.includes('pages_show_list') || r.declined.includes('instagram_basic')) {
    return 'Você não liberou o acesso às Páginas ou ao Instagram na tela do Facebook. Conecte de novo e marque a Página e a conta do Instagram.';
  }
  return 'Nenhuma conta profissional do Instagram ligada a uma Página do Facebook foi encontrada. No Instagram: Configurações → Tipo de conta → mude para Empresa e ligue à Página da Oxycom. Depois conecte de novo.';
}
