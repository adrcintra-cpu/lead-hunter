import { dataMode, supabase } from '@/lib/supabase';
import { normalize } from '@/core/utils';

export interface Session {
  userId: string;
  email: string;
  name?: string;
}

const KEY = 'lh-session';

function store(fn: () => void) {
  try {
    fn();
  } catch {
    /* storage bloqueado: a sessão vale só nesta aba */
  }
}

/**
 * Autenticação. Em modo mock, qualquer e-mail/senha (6+ caracteres) entra e
 * cria um espaço isolado no navegador. Em modo supabase, usa o Supabase Auth.
 */
export const auth = {
  async current(): Promise<Session | null> {
    if (dataMode === 'supabase' && supabase) {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user;
      return u ? { userId: u.id, email: u.email ?? '', name: (u.user_metadata?.full_name as string) || undefined } : null;
    }
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },

  async signIn(email: string, password: string): Promise<Session> {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Informe um e-mail válido.');
    if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
    if (dataMode === 'supabase' && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error || !data.user) throw new Error(error?.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error?.message ?? 'Não foi possível entrar.');
      return { userId: data.user.id, email: e };
    }
    const session: Session = { userId: `local-${normalize(e).replace(/[^a-z0-9]/g, '-')}`, email: e };
    store(() => localStorage.setItem(KEY, JSON.stringify(session)));
    return session;
  },

  async signUp(email: string, password: string, name: string): Promise<Session | null> {
    if (dataMode === 'supabase' && supabase) {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name } } });
      if (error) throw new Error(error.message);
      return data.session && data.user ? { userId: data.user.id, email: email.trim(), name } : null;
    }
    const s = await this.signIn(email, password);
    const withName = { ...s, name };
    store(() => localStorage.setItem(KEY, JSON.stringify(withName)));
    return withName;
  },

  async signOut() {
    if (dataMode === 'supabase' && supabase) await supabase.auth.signOut();
    store(() => localStorage.removeItem(KEY));
  },
};
