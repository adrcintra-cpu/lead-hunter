import { dataMode, supabase } from './supabase';

/**
 * Cliente do serviço de WhatsApp por QR code (servidor separado, ver whatsapp-service/).
 * O site só conversa com esse serviço, usando o token de login do próprio usuário.
 * Nenhuma chave ou dado da sessão do WhatsApp passa pelo navegador (nem fica no localStorage).
 */

const baseUrl = ((import.meta.env.VITE_WHATSAPP_SERVICE_URL as string | undefined) ?? '').replace(/\/+$/, '');

/** O serviço só existe no modo real e quando o endereço foi configurado. */
export const whatsappQrAvailable = dataMode === 'supabase' && !!supabase && !!baseUrl;

export type WaStatus = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'reconectando' | 'erro';

export interface WaStatusView {
  status: WaStatus;
  qr: string | null;
  phone: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  error: string | null;
}

export type WaSendResult = { ok: true; id: string; to: string } | { ok: false; error: string };

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!whatsappQrAvailable || !supabase) throw new Error('Serviço de WhatsApp não configurado.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Faça login de novo para usar o WhatsApp.');
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Serviço de WhatsApp fora do ar. Tente de novo em instantes.');
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Erro ${res.status} no serviço de WhatsApp.`);
  return json as T;
}

export const whatsappClient = {
  status: () => call<WaStatusView>('/whatsapp/status'),
  connect: () => call<WaStatusView>('/whatsapp/connect', {}),
  test: () => call<{ ok: boolean; message: string }>('/whatsapp/test', {}),
  disconnect: () => call<WaStatusView>('/whatsapp/disconnect', {}),
  send: (phone: string, message: string) => call<WaSendResult>('/whatsapp/send', { phone, message }),
};

// ---------- status compartilhado entre as telas ----------
// Um único polling para o app inteiro: rápido enquanto aguarda o QR, lento quando estável.

type Listener = () => void;
const listeners = new Set<Listener>();
let current: WaStatusView | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(v: WaStatusView | null) {
  current = v;
  listeners.forEach((l) => l());
}

const FAST: WaStatus[] = ['aguardando_qr', 'conectando', 'reconectando'];

async function poll() {
  timer = null;
  if (!listeners.size) return;
  try {
    emit(await whatsappClient.status());
  } catch (e) {
    emit({ status: 'erro', qr: null, phone: current?.phone ?? null, connectedAt: current?.connectedAt ?? null, lastSeenAt: current?.lastSeenAt ?? null, error: e instanceof Error ? e.message : String(e) });
  }
  schedule();
}

function schedule() {
  if (timer || !listeners.size) return;
  const fast = current && FAST.includes(current.status);
  timer = setTimeout(poll, fast ? 2500 : 30_000);
}

export const waStatusStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    if (whatsappQrAvailable && listeners.size === 1) {
      if (timer) clearTimeout(timer);
      timer = null;
      void poll();
    }
    return () => {
      listeners.delete(l);
      if (!listeners.size && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  },
  get: () => current,
  /** Atualiza na hora (depois de conectar, testar ou desconectar) e reajusta o ritmo do polling. */
  set(v: WaStatusView) {
    emit(v);
    if (timer) clearTimeout(timer);
    timer = null;
    schedule();
  },
  refresh: () => {
    if (timer) clearTimeout(timer);
    return poll();
  },
};
