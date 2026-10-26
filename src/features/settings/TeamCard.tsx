import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, MailPlus, Trash2, Users } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/core/utils';
import { ConfirmDialog, ErrorBox, Spinner, cx } from '@/components/ui';
import type { TeamRole } from '@/services/auth';

export const ROLE_LABEL: Record<TeamRole, string> = { admin: 'Administrador', vendedor: 'Vendedor', leitura: 'Só leitura' };
const ROLE_HINT: Record<TeamRole, string> = {
  admin: 'Tudo, inclusive Configurações, WhatsApp e equipe',
  vendedor: 'Leads, buscas, campanhas, tarefas e mensagens',
  leitura: 'Só vê; não altera nada',
};

interface Member {
  user_id: string;
  role: TeamRole;
  name: string | null;
  email: string | null;
  created_at: string;
}
interface Invite {
  email: string;
  role: TeamRole;
  name: string | null;
  created_at: string;
}

/** Chama a função `team` (convites e acessos; só o admin). */
async function teamCall(body: Record<string, unknown>): Promise<{ ok?: boolean; existing?: boolean }> {
  if (!supabase) throw new Error('Disponível só no modo real.');
  const { data, error } = await supabase.functions.invoke('team', { body });
  if (error) {
    // Mensagem da função (ex.: "Só o administrador…"), quando houver.
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || (/not found|404/i.test(error.message) ? 'A função de equipe ainda não foi publicada no Supabase.' : error.message));
  }
  return data as { ok?: boolean; existing?: boolean };
}

/** Configurações → Equipe: quem acessa a conta, com que papel, e convites. */
export function TeamCard() {
  const { toast, session, team } = useApp();
  const isOwner = !team || team.ownerId === session?.userId;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'vendedor' as TeamRole });
  const [removing, setRemoving] = useState<Member | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [m, i] = await Promise.all([
      supabase.from('team_members').select('user_id, role, name, email, created_at').order('created_at'),
      supabase.from('team_invites').select('email, role, name, created_at').is('accepted_at', null).order('created_at', { ascending: false }),
    ]);
    if (m.error) {
      setError(/team_members|does not exist|schema cache/i.test(m.error.message) ? 'Falta aplicar a migration da equipe no banco (npx supabase db push).' : m.error.message);
      setMembers([]);
      return;
    }
    setMembers(((m.data ?? []) as Member[]).filter((x) => x.user_id !== session?.userId));
    setInvites((i.data ?? []) as Invite[]);
  }, [session?.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    void run('invite', async () => {
      const r = await teamCall({ action: 'invite', ...form });
      toast(r.existing ? `${form.email} já tem login: ao entrar, passa a ver a conta.` : `Convite enviado para ${form.email}.`, 'success');
      setForm({ name: '', email: '', role: form.role });
      await load();
    });
  }

  const link = typeof window !== 'undefined' ? `${window.location.origin}/login` : '';

  return (
    <section className="card px-5 py-5">
      <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><Users className="h-4 w-4" /> Equipe</h2>
      <p className="mt-1 text-[13px] text-ink-faint">
        Quem você convidar entra com o próprio e-mail e senha e vê os mesmos leads, campanhas e tarefas desta conta. Ninguém cria conta sozinho.
      </p>

      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

      <form onSubmit={invite} className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_1.3fr_160px_auto] sm:items-end">
        <div>
          <label htmlFor="tm-name" className="label">Nome</label>
          <input id="tm-name" className="input" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="tm-email" className="label">E-mail</label>
          <input id="tm-email" type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label htmlFor="tm-role" className="label">Papel</label>
          <select id="tm-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })}>
            {(Object.keys(ROLE_LABEL) as TeamRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-primary h-[42px]" disabled={!!busy || !form.email.trim()}>
          {busy === 'invite' ? <Spinner /> : <MailPlus className="h-4 w-4" />} Convidar
        </button>
      </form>
      <p className="mt-1.5 text-xs text-ink-faint">{ROLE_HINT[form.role]}. A pessoa recebe um e-mail com o link para criar a senha.</p>

      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">{session?.name || 'Você'}</div>
            <div className="truncate text-xs text-ink-faint">{session?.email}</div>
          </div>
          <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-bold text-accent-strong">{isOwner ? 'Dono · Administrador' : `Você · ${ROLE_LABEL[team!.role]}`}</span>
        </li>
        {members === null && <li className="flex items-center gap-2 px-4 py-3 text-sm text-ink-faint"><Spinner /> Carregando…</li>}
        {members?.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-bold">{m.name || m.email}</div>
              <div className="truncate text-xs text-ink-faint">{m.email} · desde {formatDate(m.created_at)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor={`tm-r-${m.user_id}`} className="sr-only">Papel</label>
              <select
                id={`tm-r-${m.user_id}`}
                className="input min-h-[34px] w-auto py-0 text-sm"
                value={m.role}
                disabled={!!busy}
                onChange={(e) => {
                  const role = e.target.value as TeamRole;
                  void run(`role:${m.user_id}`, async () => {
                    await teamCall({ action: 'role', userId: m.user_id, role });
                    toast(`${m.name || m.email} agora é ${ROLE_LABEL[role]}.`, 'success');
                    await load();
                  });
                }}
              >
                {(Object.keys(ROLE_LABEL) as TeamRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button type="button" className="btn-ghost min-h-[34px] px-2 text-bad" aria-label={`Remover ${m.name || m.email}`} onClick={() => setRemoving(m)} disabled={!!busy}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 bg-subtle px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{i.name || i.email}</div>
              <div className="truncate text-xs text-ink-faint">{i.email} · convidado em {formatDate(i.created_at)} · {ROLE_LABEL[i.role]}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-warn-soft px-2 py-1 text-xs font-bold text-warn">Aguardando</span>
              <button
                type="button"
                className="btn-ghost min-h-[32px] px-2 text-xs"
                disabled={!!busy}
                onClick={() =>
                  void run(`resend:${i.email}`, async () => {
                    await teamCall({ action: 'invite', email: i.email, name: i.name, role: i.role });
                    toast('Convite reenviado.', 'success');
                  })
                }
              >
                {busy === `resend:${i.email}` ? <Spinner /> : 'Reenviar'}
              </button>
              <button
                type="button"
                className="btn-ghost min-h-[32px] px-2 text-xs text-bad"
                disabled={!!busy}
                onClick={() =>
                  void run(`cancel:${i.email}`, async () => {
                    await teamCall({ action: 'cancel', email: i.email });
                    await load();
                  })
                }
              >
                Cancelar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className={cx('mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint')}>
        Endereço de acesso: <span className="font-mono text-ink-soft">{link}</span>
        <button type="button" className="btn-ghost min-h-[28px] px-2 text-xs" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Endereço copiado.'))}>
          <Copy className="h-3.5 w-3.5" /> Copiar
        </button>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remover ${removing.name || removing.email}`}
          confirmLabel="Remover acesso"
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            void run(`remove:${removing.user_id}`, async () => {
              await teamCall({ action: 'remove', userId: removing.user_id });
              toast('Acesso removido.', 'success');
              setRemoving(null);
              await load();
            })
          }
        >
          A pessoa deixa de ver esta conta e o login dela fica bloqueado. Nada do que ela fez é apagado. Dá para convidar de novo depois.
        </ConfirmDialog>
      )}
    </section>
  );
}
