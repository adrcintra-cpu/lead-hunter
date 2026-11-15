import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { auth } from '@/services/auth';
import { Spinner, Toasts } from '@/components/ui';
import { OxyhubLogo } from '@/components/OxyhubLogo';
import { ParticleSphere } from './ParticleSphere';
import { goToHubLogin, HUB_URL } from '@/lib/oxyhub';

/** Fundo claro do Oxyhub (quadriculado e luzes) com a esfera de partículas e o cartão de vidro (login, definir senha). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden text-ink">
      <ParticleSphere className="pointer-events-none absolute left-1/2 top-1/2 h-[min(110vh,1100px)] w-[min(110vh,1100px)] -translate-x-1/2 -translate-y-1/2 opacity-40 lg:left-[33%] lg:opacity-70" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 lg:justify-end lg:pr-[8vw]">
        <div className="glass w-full max-w-[440px] rounded-[24px] px-7 py-10 sm:px-10">
          <div className="mb-9 flex flex-col items-center gap-2">
            <OxyhubLogo className="h-[33px] w-auto" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Lead Hunter</span>
          </div>
          {children}
        </div>
      </div>
      <Toasts />
    </div>
  );
}

const field = 'input min-h-[46px] text-[15px]';

export function LoginPage() {
  const { signIn } = useApp();
  const [mode, setMode] = useState<'in' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  // Login único: com Supabase, o login acontece no Oxyhub, que devolve a pessoa aqui já logada
  const [toHub, setToHub] = useState(dataMode === 'supabase');
  useEffect(() => {
    if (dataMode === 'supabase') setToHub(goToHubLogin());
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'in') await signIn(email, password, remember);
      else {
        await auth.resetPassword(email);
        setInfo('Se esse e-mail for da equipe, chega em instantes um link para criar uma senha nova.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  if (toHub) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-3 py-6 text-center text-[14px] text-ink-soft">
          <Spinner />
          Abrindo o login do Oxyhub…
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate className="flex flex-col">
        {mode === 'reset' && (
          <p className="mb-5 text-[14px] leading-relaxed text-ink-soft">Informe seu e-mail. Enviamos um link para você criar uma senha nova.</p>
        )}
        <label htmlFor="email" className="label text-[14px]">E-mail</label>
        <input id="email" type="email" className={field} placeholder="Digite seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />

        {mode === 'in' && (
          <>
            <label htmlFor="password" className="label mt-5 text-[14px]">Senha</label>
            <div className="relative">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                className={`${field} pr-11`}
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:text-ink"
                aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
              >
                {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[14px]">
              <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
                <input type="checkbox" className="h-4 w-4 rounded accent-[#4700ff]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Manter conectado
              </label>
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setMode('reset'); setError(''); setInfo(''); }}>
                Esqueci a senha
              </button>
            </div>
          </>
        )}

        {error && <div role="alert" className="mt-5 rounded-xl bg-bad-soft px-4 py-3 text-[14px] font-medium text-bad">{error}</div>}
        {info && <div role="status" className="mt-5 rounded-xl bg-good-soft px-4 py-3 text-[14px] font-medium text-good">{info}</div>}

        <button
          type="submit"
          disabled={busy}
          className="mt-8 flex h-12 items-center justify-center gap-2 btn-primary glass-tint text-[15px] disabled:opacity-60"
        >
          {busy && <Spinner />}
          {mode === 'in' ? 'Entrar' : 'Enviar link'}
        </button>
        {mode === 'reset' && (
          <button type="button" className="mt-3 text-[14px] text-ink-soft hover:text-ink" onClick={() => { setMode('in'); setError(''); setInfo(''); }}>
            Voltar para o login
          </button>
        )}

        <p className="mt-9 flex items-start justify-center gap-1.5 text-center text-[12.5px] leading-relaxed text-ink-faint">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {dataMode === 'mock'
            ? 'Modo de teste: qualquer e-mail e senha com 6+ caracteres. Os dados ficam só neste navegador.'
            : 'Acesso restrito à equipe. Para entrar, peça um convite ao administrador da conta.'}
        </p>
        <p className="mt-3 text-center text-[13px]">
          <a href={`${HUB_URL}/abrir/lead`} className="font-semibold text-accent hover:underline">
            Entrar pelo Oxyhub (acesso único)
          </a>
        </p>
      </form>
    </AuthLayout>
  );
}
