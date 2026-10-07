import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from './crypto.js';
import { log, maskUser } from './log.js';

/**
 * Estado de autenticação do WhatsApp guardado no Supabase (tabela whatsapp_auth),
 * criptografado. Equivale ao useMultiFileAuthState da biblioteca, mas sem arquivos:
 * o serviço pode reiniciar (ou mudar de servidor) sem pedir QR de novo.
 *
 * Leitura: tudo do usuário é carregado uma vez para a memória.
 * Escrita: as mudanças são agrupadas e gravadas em lote (a biblioteca grava muitas chaves seguidas).
 */
export async function useDatabaseAuthState(db: SupabaseClient, userId: string) {
  const cache = new Map<string, unknown>();
  const { data, error } = await db.from('whatsapp_auth').select('key, value').eq('user_id', userId);
  if (error) throw new Error(`Falha ao carregar a sessão: ${error.message}`);
  for (const row of data ?? []) {
    try {
      cache.set(row.key as string, JSON.parse(decrypt(row.value as string), BufferJSON.reviver));
    } catch {
      log.warn({ user: maskUser(userId), key: row.key }, 'chave de sessão ilegível ignorada');
    }
  }

  const pendingWrite = new Map<string, unknown>();
  const pendingDelete = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let flushing: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = null;
    const writes = [...pendingWrite.entries()];
    const deletes = [...pendingDelete];
    pendingWrite.clear();
    pendingDelete.clear();
    flushing = flushing.then(async () => {
      if (writes.length) {
        const rows = writes.map(([key, value]) => ({
          user_id: userId,
          key,
          value: encrypt(JSON.stringify(value, BufferJSON.replacer)),
          updated_at: new Date().toISOString(),
        }));
        for (let i = 0; i < rows.length; i += 200) {
          const { error: e } = await db.from('whatsapp_auth').upsert(rows.slice(i, i + 200));
          if (e) log.error({ user: maskUser(userId), err: e.message }, 'falha ao gravar a sessão');
        }
      }
      // Em lotes: muitas chaves numa só lista estouram o tamanho da URL ("fetch failed").
      for (let i = 0; i < deletes.length; i += 100) {
        const { error: e } = await db.from('whatsapp_auth').delete().eq('user_id', userId).in('key', deletes.slice(i, i + 100));
        if (e) log.error({ user: maskUser(userId), err: e.message }, 'falha ao remover chaves da sessão');
      }
    });
  };

  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 300);
  };

  const write = (key: string, value: unknown) => {
    cache.set(key, value);
    pendingDelete.delete(key);
    pendingWrite.set(key, value);
    schedule();
  };

  const remove = (key: string) => {
    cache.delete(key);
    pendingWrite.delete(key);
    pendingDelete.add(key);
    schedule();
  };

  const creds: AuthenticationCreds = (cache.get('creds') as AuthenticationCreds | undefined) ?? initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = cache.get(`${type}-${id}`);
          if (value && type === 'app-state-sync-key') {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }
          if (value) out[id] = value as SignalDataTypeMap[T];
        }
        return out;
      },
      set: async (data) => {
        for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const entries = data[category] ?? {};
          for (const id of Object.keys(entries)) {
            const value = entries[id];
            const key = `${category}-${id}`;
            if (value) write(key, value);
            else remove(key);
          }
        }
      },
    },
  };

  return {
    state,
    /** Chamado pela biblioteca quando as credenciais mudam. */
    saveCreds: async () => {
      write('creds', state.creds);
    },
    /** Grava o que estiver pendente (antes de desligar). */
    flushNow: async () => {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      await flushing;
    },
    /** Indica se há uma sessão salva (já pareada). */
    hasSession: () => !!(cache.get('creds') as AuthenticationCreds | undefined)?.me,
  };
}

/** Apaga a sessão salva de um usuário (desconexão). */
export async function clearAuthState(db: SupabaseClient, userId: string) {
  const { error } = await db.from('whatsapp_auth').delete().eq('user_id', userId);
  if (error) throw new Error(`Falha ao remover a sessão: ${error.message}`);
}
