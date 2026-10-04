import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { providers } from '@/core/providers/registry';
import { auth, type Session } from '@/services/auth';
import { LocalRepository } from '@/services/db/localRepository';
import { SupabaseRepository } from '@/services/db/supabaseRepository';
import { dataMode, supabase } from '@/lib/supabase';
import type { DbState } from '@/services/db/schema';
import { LeadHunterService } from '@/services/leadHunterService';

type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface AppContextValue {
  session: Session | null;
  loading: boolean;
  /** Erro ao carregar os dados do usuário (modo Supabase). */
  loadError: string;
  service: LeadHunterService | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  toast: (text: string, tone?: ToastTone) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [service, setService] = useState<LeadHunterService | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const toastRef = useRef<(text: string, tone?: ToastTone) => void>(() => {});

  useEffect(() => {
    auth.current().then((s) => {
      setSession(s);
      if (!s) setLoading(false);
    });
  }, []);

  // Monta o repositório do usuário: local (mock) ou Supabase (carrega os dados antes de abrir o app).
  useEffect(() => {
    if (!session) {
      setService(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        let repo;
        if (dataMode === 'supabase' && supabase) {
          const remote = new SupabaseRepository(supabase, { id: session.userId, email: session.email }, (msg) =>
            toastRef.current(`Não foi possível salvar no servidor. ${msg}`, 'error'),
          );
          await remote.load();
          repo = remote;
        } else {
          repo = new LocalRepository(`lh-db:${session.userId}`);
        }
        const svc = new LeadHunterService(repo, providers);
        svc.ensureProfile({ id: session.userId, email: session.email, name: session.name }, { seedExamples: dataMode === 'mock' });
        if (!cancelled) setService(svc);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Falha ao carregar seus dados.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, text, tone }]);
      setTimeout(() => dismissToast(id), 3800);
    },
    [dismissToast],
  );
  toastRef.current = toast;

  const value: AppContextValue = {
    session,
    loading,
    loadError,
    service,
    toasts,
    toast,
    dismissToast,
    signIn: async (email, password) => setSession(await auth.signIn(email, password)),
    signUp: async (email, password, name) => {
      const s = await auth.signUp(email, password, name);
      if (s) setSession(s);
      return !!s;
    },
    signOut: async () => {
      await auth.signOut();
      setSession(null);
    },
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp precisa estar dentro de AppProvider');
  return ctx;
}

/** Serviço garantido (rotas protegidas). */
export function useService(): LeadHunterService {
  const { service } = useApp();
  if (!service) throw new Error('Sem sessão ativa.');
  return service;
}

/** Snapshot reativo do banco local. */
export function useDb(): DbState {
  const repo = useService().repo;
  return useSyncExternalStore(
    (cb) => repo.subscribe(cb),
    () => repo.snapshot(),
  );
}
