import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { ErrorBox, Spinner } from '@/components/ui';
import { instagramApi } from '@/services/instagram/instagramApi';

/** Volta do login do Facebook: entrega o código à função (uma vez só) e retorna para Contas conectadas. */
export function InstagramCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const [error, setError] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const code = params.get('code');
    const state = params.get('state');
    // Tira o código da barra de endereço (não fica no histórico do navegador).
    window.history.replaceState(null, '', '/instagram/conectado');
    if (params.get('error')) {
      setError(params.get('error_reason') === 'user_denied' ? 'A conexão foi cancelada na tela do Facebook.' : 'O Facebook não concluiu a conexão. Tente de novo.');
      return;
    }
    if (!code || !state) {
      setError('Link de conexão incompleto. Tente conectar de novo.');
      return;
    }
    instagramApi
      .finishConnect(code, state)
      .then((r) => {
        const names = r.accounts.map((a) => `@${a.username ?? '?'}`).join(', ');
        toast(`Instagram conectado: ${names}.${r.declined.length ? ' Algumas permissões não foram liberadas.' : ''}`, 'success');
        navigate('/instagram?aba=contas', { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [params, navigate, toast]);

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 py-10">
      {!error ? (
        <div className="card flex items-center gap-3 px-5 py-5 text-sm"><Spinner /> Concluindo a conexão com o Instagram…</div>
      ) : (
        <div className="card px-5 py-5">
          <h1 className="text-[15px] font-extrabold">Não foi possível conectar</h1>
          <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>
          <Link to="/instagram?aba=contas" className="btn-primary mt-4 inline-flex">Voltar para Contas conectadas</Link>
        </div>
      )}
    </div>
  );
}
