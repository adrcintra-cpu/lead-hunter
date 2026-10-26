import { dataMode, supabase } from '@/lib/supabase';
import { normalize } from '@/core/utils';

export interface Session {
  userId: string;
  email: string;
  name?: string;
}

export type TeamRole = 'admin' | 'vendedor' | 'leitura';

/** Conta em uso e papel: quem é da equipe usa a conta do dono; o dono é admin. */
export interface TeamInfo {
  ownerId: string;
  role: TeamRole;
}

const KEY = 'lh-session';
/** "Manter conectado" desmarcado: a sessão vale só enquanto o navegador estiver aberto. Só marcadores, nenhum dado de login. */
const EPHEMERAL = 'lh-ephemeral';
const TAB_ALIVE = 'lh-tab-alive';

let teamCache: TeamInfo | null = null;

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
      // Sessão sem "manter conectado": o navegador foi fechado desde o login → sai.
      let expired = false;
      store(() => {
        expired = localStorage.getItem(EPHEMERAL) === '1' && sessionStorage.getItem(TAB_ALIVE) !== '1';
      });
      if (expired) {
        await supabase.auth.signOut().catch(() => undefined);
        store(() => localStorage.removeItem(EPHEMERAL));
        return null;
      }
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

  async signIn(email: string, password: string, remember = true): Promise<Session> {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Informe um e-mail válido.');
    if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
    if (dataMode === 'supabase' && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
      if (error || !data.user) throw new Error(error?.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error?.message ?? 'Não foi possível entrar.');
      store(() => {
        if (remember) localStorage.removeItem(EPHEMERAL);
        else localStorage.setItem(EPHEMERAL, '1');
        sessionStorage.setItem(TAB_ALIVE, '1');
      });
      return { userId: data.user.id, email: e, name: (data.user.user_metadata?.full_name as string) || undefined };
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
    teamCache = null;
    if (dataMode === 'supabase' && supabase) await supabase.auth.signOut();
    store(() => {
      localStorage.removeItem(KEY);
      localStorage.removeItem(EPHEMERAL);
    });
  },

  /** Link para criar uma senha nova (vale o e-mail cadastrado; não diz se o e-mail existe). */
  async resetPassword(email: string) {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Informe o e-mail para receber o link.');
    if (!(dataMode === 'supabase' && supabase)) throw new Error('Disponível só no modo real.');
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: `${window.location.origin}/definir-senha` });
    if (error && !/rate|limit/i.test(error.message)) throw new Error(error.message);
    if (error) throw new Error('Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.');
  },

  /** Define a senha (convite ou "esqueci a senha": quem chega pelo link já está com a sessão aberta). */
  async setPassword(password: string, name?: string) {
    if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    if (!(dataMode === 'supabase' && supabase)) throw new Error('Disponível só no modo real.');
    const { error } = await supabase.auth.updateUser({ password, ...(name ? { data: { full_name: name } } : {}) });
    if (error) throw new Error(error.message);
    store(() => sessionStorage.setItem(TAB_ALIVE, '1'));
  },

  /**
   * Conta e papel de quem está logado. Aceita o convite pendente para este e-mail (primeiro acesso).
   * Sem a migration da equipe: a própria conta, como admin.
   */
  async team(userId: string): Promise<TeamInfo> {
    if (teamCache) return teamCache;
    if (!(dataMode === 'supabase' && supabase)) return { ownerId: userId, role: 'admin' };
    await supabase.rpc('accept_invite').then(() => undefined, () => undefined);
    const [o, r] = await Promise.all([supabase.rpc('current_owner'), supabase.rpc('team_role')]);
    const ownerId = !o.error && typeof o.data === 'string' ? o.data : userId;
    const role = !r.error && (r.data === 'vendedor' || r.data === 'leitura') ? r.data : 'admin';
    teamCache = { ownerId, role };
    return teamCache;
  },

  /** Conta em uso já conhecida (depois do login). */
  ownerId(): string | null {
    return teamCache?.ownerId ?? null;
  },
};
