import { useState, type FormEvent } from 'react';
import { useApp } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { ErrorBox, Spinner, ThemeSwitcher, Toasts } from '@/components/ui';
import { OxyhubLogo } from '@/components/OxyhubLogo';

export function LoginPage() {
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'in') await signIn(email, password);
      else {
        const ok = await signUp(email, password, name);
        if (!ok) setInfo('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col justify-between px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <OxyhubLogo className="h-7 w-auto" />
            <span className="border-l border-line pl-3 text-[13px] font-semibold text-ink-faint">Lead Hunter</span>
          </div>
          <ThemeSwitcher compact />
        </div>

        <form onSubmit={submit} className="mx-auto w-full max-w-sm py-12" noValidate>
          <h1 className="text-[28px] font-extrabold tracking-tight">{mode === 'in' ? 'Entrar' : 'Criar conta'}</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {dataMode === 'mock' ? 'Modo mock: use qualquer e-mail e uma senha com 6+ caracteres. Os dados ficam só neste navegador.' : 'Acesse sua conta do Lead Hunter.'}
          </p>
          <div className="mt-6 flex flex-col gap-4">
            {mode === 'up' && (
              <div>
                <label htmlFor="name" className="label">Nome</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            <div>
              <label htmlFor="email" className="label">E-mail</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <label htmlFor="password" className="label">Senha</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                required
              />
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            {info && <div className="rounded-lg bg-good-soft px-4 py-3 text-sm text-good">{info}</div>}
            <button type="submit" className="btn-primary h-11" disabled={busy}>
              {busy && <Spinner />}
              {mode === 'in' ? 'Entrar' : 'Criar conta'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? 'Não tem conta? Criar conta' : 'Já tem conta? Entrar'}
            </button>
          </div>
        </form>
        <p className="text-xs text-ink-faint">Respeitamos a LGPD: somente dados comerciais públicos, com opt-out.</p>
      </section>

      <section className="relative hidden overflow-hidden border-l border-line bg-subtle lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-accent">Copiloto de prospecção</div>
        <h2 className="mt-3 max-w-lg text-4xl font-extrabold leading-tight tracking-tight">
          Encontre, entenda e aborde as empresas certas.
        </h2>
        <ol className="mt-10 flex max-w-md flex-col gap-3">
          {['Encontrar', 'Entender', 'Qualificar', 'Priorizar', 'Abordar', 'Acompanhar'].map((s, i) => (
            <li key={s} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
              <span className="font-mono text-sm text-ink-faint">0{i + 1}</span>
              <span className="font-semibold">{s}</span>
            </li>
          ))}
        </ol>
      </section>
      <Toasts />
    </div>
  );
}
