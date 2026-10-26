import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { auth } from '@/services/auth';
import { Spinner } from '@/components/ui';
import { AuthLayout } from './LoginPage';

const field =
  'w-full rounded-xl border border-white/20 bg-transparent px-3.5 py-3 text-[15px] text-white placeholder:text-white/40 outline-none transition-colors focus:border-[#6b8bff] focus:ring-2 focus:ring-[#6b8bff]/30';

/** Chegou pelo link do convite ou do "Esqueci a senha": cria a senha (e o nome, no primeiro acesso). */
export function SetPasswordPage() {
  const { session, toast } = useApp();
  const navigate = useNavigate();
  const invite = typeof window !== 'undefined' && /convite=1|type=invite/.test(window.location.search + window.location.hash);
  const [name, setName] = useState(session?.name ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <AuthLayout>
        <h1 className="text-center text-xl font-bold">Link expirado ou inválido</h1>
        <p className="mt-3 text-center text-[14px] leading-relaxed text-white/70">
          Os links de convite e de senha nova valem por pouco tempo e só uma vez. Peça um convite novo ao administrador ou use “Esqueci a senha” na tela de login.
        </p>
        <button type="button" onClick={() => navigate('/login')} className="mt-8 h-12 w-full rounded-full bg-[#1d3a8a] text-[14px] font-bold uppercase tracking-[0.18em] text-[#c9d6ff] hover:bg-[#2546a6]">
          Ir para o login
        </button>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('As duas senhas não são iguais.');
    setBusy(true);
    try {
      await auth.setPassword(password, name.trim() || undefined);
      toast('Senha criada. Bem-vindo ao Lead Hunter!', 'success');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate className="flex flex-col">
        <h1 className="text-center text-xl font-bold">{invite ? 'Bem-vindo à equipe' : 'Crie uma senha nova'}</h1>
        <p className="mb-6 mt-2 text-center text-[14px] text-white/60">{session.email}</p>
        {invite && (
          <>
            <label htmlFor="sp-name" className="mb-1.5 text-[13px] text-white/60">Seu nome</label>
            <input id="sp-name" className={`${field} mb-5`} placeholder="Como você quer ser chamado" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </>
        )}
        <label htmlFor="sp-pass" className="mb-1.5 text-[13px] text-white/60">Senha (mínimo 8 caracteres)</label>
        <div className="relative">
          <input id="sp-pass" type={show ? 'text' : 'password'} className={`${field} pr-11`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/50 hover:text-white" aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <label htmlFor="sp-confirm" className="mb-1.5 mt-5 text-[13px] text-white/60">Repita a senha</label>
        <input id="sp-confirm" type={show ? 'text' : 'password'} className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        {error && <div role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-200">{error}</div>}
        <button type="submit" disabled={busy} className="mt-8 flex h-12 items-center justify-center gap-2 rounded-full bg-[#1d3a8a] text-[14px] font-bold uppercase tracking-[0.18em] text-[#c9d6ff] transition-colors hover:bg-[#2546a6] disabled:opacity-60">
          {busy && <Spinner />} Salvar senha
        </button>
      </form>
    </AuthLayout>
  );
}
