import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { auth, SESSION_LOST } from '@/services/auth';
import { Spinner } from '@/components/ui';
import { AuthLayout } from './LoginPage';

const field = 'input min-h-[46px] text-[15px]';

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
  const [resent, setResent] = useState(false);

  if (!session) {
    return (
      <AuthLayout>
        <h1 className="text-center text-[28px] font-light leading-tight tracking-[-0.015em]">Link expirado ou inválido</h1>
        <p className="mt-3 text-center text-[14px] leading-relaxed text-ink-soft">
          Os links de convite e de senha nova valem por pouco tempo e só uma vez. Peça um convite novo ao administrador ou use “Esqueci a senha” na tela de login.
        </p>
        <button type="button" onClick={() => navigate('/login')} className="mt-8 h-12 w-full btn-primary glass-tint text-[15px]">
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
      toast('Senha criada. Bem-vindo ao OxySDR!', 'success');
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
        <h1 className="text-center text-[28px] font-light leading-tight tracking-[-0.015em]">{invite ? 'Bem-vindo à equipe' : 'Crie uma senha nova'}</h1>
        <p className="mb-6 mt-2 text-center text-[14px] text-ink-soft">{session.email}</p>
        {invite && (
          <>
            <label htmlFor="sp-name" className="label text-[14px]">Seu nome</label>
            <input id="sp-name" className={`${field} mb-5`} placeholder="Como você quer ser chamado" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </>
        )}
        <label htmlFor="sp-pass" className="label text-[14px]">Senha (mínimo 8 caracteres)</label>
        <div className="relative">
          <input id="sp-pass" type={show ? 'text' : 'password'} className={`${field} pr-11`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:text-ink" aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <label htmlFor="sp-confirm" className="label mt-5 text-[14px]">Repita a senha</label>
        <input id="sp-confirm" type={show ? 'text' : 'password'} className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        {error && <div role="alert" className="mt-5 rounded-xl bg-bad-soft px-4 py-3 text-[14px] font-medium text-bad">{error}</div>}
        {error === SESSION_LOST && (
          <button
            type="button"
            disabled={busy || resent}
            onClick={async () => {
              setBusy(true);
              try {
                await auth.resetPassword(session.email);
                setResent(true);
                setError('');
                toast(`Link novo enviado para ${session.email}.`, 'success');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Não foi possível enviar o link.');
              } finally {
                setBusy(false);
              }
            }}
            className="btn-outline glass-btn mt-3 h-11 text-[15px] disabled:opacity-60"
          >
            Enviar link novo
          </button>
        )}
        {resent && <div role="status" className="mt-5 rounded-xl bg-good-soft px-4 py-3 text-[14px] font-medium text-good">Link novo enviado para {session.email}. Abra o e-mail e toque no link para criar a senha.</div>}
        <button type="submit" disabled={busy} className="mt-8 flex h-12 items-center justify-center gap-2 btn-primary glass-tint text-[15px] disabled:opacity-60">
          {busy && <Spinner />} Salvar senha
        </button>
      </form>
    </AuthLayout>
  );
}
