import { useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { auth } from '@/services/auth';
import { Spinner, Toasts } from '@/components/ui';
import { OxyhubLogo } from '@/components/OxyhubLogo';
import { ParticleSphere } from './ParticleSphere';

/** Fundo escuro com a esfera de partículas e o cartão à direita (login, definir senha). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a1020] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,#16244a_0%,#0a1020_60%)]" aria-hidden />
      <ParticleSphere className="pointer-events-none absolute left-1/2 top-1/2 h-[min(110vh,1100px)] w-[min(110vh,1100px)] -translate-x-1/2 -translate-y-1/2 opacity-25 lg:left-[33%] lg:opacity-60" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 lg:justify-end lg:pr-[8vw]">
        <div className="w-full max-w-[440px] rounded-[28px] border border-white/10 bg-[#121a2e]/85 px-7 py-10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-md sm:px-10">
          <div className="mb-9 flex flex-col items-center gap-2">
            <OxyhubLogo className="h-9 w-auto" wordClassName="fill-white" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.2em] text-white/50">Lead Hunter</span>
          </div>
          {children}
        </div>
      </div>
      <Toasts />
    </div>
  );
}

const field =
  'w-full rounded-xl border border-white/20 bg-transparent px-3.5 py-3 text-[15px] text-white placeholder:text-white/40 outline-none transition-colors focus:border-[#6b8bff] focus:ring-2 focus:ring-[#6b8bff]/30';

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

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate className="flex flex-col">
        {mode === 'reset' && (
          <p className="mb-5 text-[14px] leading-relaxed text-white/70">Informe seu e-mail. Enviamos um link para você criar uma senha nova.</p>
        )}
        <label htmlFor="email" className="mb-1.5 text-[13px] text-white/60">E-mail</label>
        <input id="email" type="email" className={field} placeholder="Digite seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />

        {mode === 'in' && (
          <>
            <label htmlFor="password" className="mb-1.5 mt-5 text-[13px] text-white/60">Senha</label>
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
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/50 hover:text-white"
                aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
              >
                {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[14px]">
              <label className="flex cursor-pointer items-center gap-2 text-white/85">
                <input type="checkbox" className="h-4 w-4 rounded accent-[#4f6bff]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Manter conectado
              </label>
              <button type="button" className="text-[#7c95ff] hover:underline" onClick={() => { setMode('reset'); setError(''); setInfo(''); }}>
                Esqueci a senha
              </button>
            </div>
          </>
        )}

        {error && <div role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-200">{error}</div>}
        {info && <div role="status" className="mt-5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-[14px] text-emerald-200">{info}</div>}

        <button
          type="submit"
          disabled={busy}
          className="mt-8 flex h-12 items-center justify-center gap-2 rounded-full bg-[#1d3a8a] text-[14px] font-bold uppercase tracking-[0.18em] text-[#c9d6ff] transition-colors hover:bg-[#2546a6] disabled:opacity-60"
        >
          {busy && <Spinner />}
          {mode === 'in' ? 'Entrar' : 'Enviar link'}
        </button>
        {mode === 'reset' && (
          <button type="button" className="mt-3 text-[14px] text-white/60 hover:text-white" onClick={() => { setMode('in'); setError(''); setInfo(''); }}>
            Voltar para o login
          </button>
        )}

        <p className="mt-9 flex items-start justify-center gap-1.5 text-center text-[12.5px] leading-relaxed text-white/45">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {dataMode === 'mock'
            ? 'Modo de teste: qualquer e-mail e senha com 6+ caracteres. Os dados ficam só neste navegador.'
            : 'Acesso restrito à equipe. Para entrar, peça um convite ao administrador da conta.'}
        </p>
      </form>
    </AuthLayout>
  );
}
