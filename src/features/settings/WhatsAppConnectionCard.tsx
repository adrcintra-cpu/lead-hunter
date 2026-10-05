import { useEffect, useRef, useState } from 'react';
import { MessageCircle, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { formatDateTime } from '@/core/utils';
import { ConfirmDialog, ErrorBox, Modal, Spinner, cx } from '@/components/ui';
import { waStatusStore, whatsappClient, whatsappQrAvailable, type WaStatus } from '@/lib/whatsappClient';
import { useWhatsAppConnection } from '@/services/whatsapp/useWhatsAppConnection';

const LABEL: Record<WaStatus, string> = {
  desconectado: 'Desconectado',
  aguardando_qr: 'Aguardando QR Code',
  conectando: 'Conectando',
  conectado: 'Conectado',
  reconectando: 'Reconectando',
  erro: 'Erro',
};

const TONE: Record<WaStatus, string> = {
  desconectado: 'bg-muted text-ink-soft',
  aguardando_qr: 'bg-warn-soft text-warn',
  conectando: 'bg-warn-soft text-warn',
  reconectando: 'bg-warn-soft text-warn',
  conectado: 'bg-good-soft text-good',
  erro: 'bg-bad-soft text-bad',
};

const DOT: Record<WaStatus, string> = {
  desconectado: 'bg-ink-faint',
  aguardando_qr: 'bg-warn animate-pulse',
  conectando: 'bg-warn animate-pulse',
  reconectando: 'bg-warn animate-pulse',
  conectado: 'bg-good',
  erro: 'bg-bad',
};

const STEPS = ['Abra o WhatsApp no celular.', 'Vá em Configurações.', 'Selecione Aparelhos conectados.', 'Toque em Conectar aparelho.', 'Escaneie o QR Code.'];

/** Configurações → WhatsApp: conectar o próprio WhatsApp por QR code (sessão no servidor, nunca no navegador). */
export function WhatsAppConnectionCard() {
  const { toast } = useApp();
  const conn = useWhatsAppConnection();
  const [busy, setBusy] = useState<'' | 'connect' | 'test' | 'disconnect'>('');
  const [qrOpen, setQrOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const prev = useRef<WaStatus | null>(null);

  const status: WaStatus = conn?.status ?? 'desconectado';

  // QR lido: fecha o modal e avisa.
  useEffect(() => {
    if (status === 'conectado' && prev.current && prev.current !== 'conectado' && qrOpen) {
      setQrOpen(false);
      toast('WhatsApp conectado.', 'success');
    }
    if (qrOpen && (status === 'desconectado' || status === 'erro') && prev.current && prev.current !== status) {
      setQrOpen(false);
    }
    prev.current = status;
  }, [status, qrOpen, toast]);

  if (!whatsappQrAvailable) {
    return (
      <section className="card px-5 py-5">
        <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><MessageCircle className="h-4 w-4" /> WhatsApp</h2>
        <p className="mt-1 text-[13px] text-ink-faint">
          Conectar o WhatsApp por QR code fica disponível no modo real, depois que o serviço de WhatsApp for publicado (variável VITE_WHATSAPP_SERVICE_URL). Enquanto isso, o envio continua pelo link wa.me.
        </p>
      </section>
    );
  }

  async function run<T>(kind: typeof busy, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy('');
    }
  }

  async function connect() {
    setTestResult(null);
    const v = await run('connect', whatsappClient.connect);
    if (v) {
      waStatusStore.set(v);
      if (v.status !== 'conectado') setQrOpen(true);
    }
  }

  async function test() {
    const r = await run('test', whatsappClient.test);
    if (r) {
      setTestResult(r);
      void waStatusStore.refresh();
    }
  }

  async function disconnect() {
    const v = await run('disconnect', whatsappClient.disconnect);
    if (v) {
      waStatusStore.set(v);
      setTestResult(null);
      toast('WhatsApp desconectado.');
    }
  }

  const connected = status === 'conectado';
  const working = status === 'aguardando_qr' || status === 'conectando' || status === 'reconectando';

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><MessageCircle className="h-4 w-4" /> {connected ? 'WhatsApp conectado' : 'Conectar WhatsApp'}</h2>
          {!connected && (
            <p className="mt-1 text-[13px] text-ink-faint">Conecte seu WhatsApp ao Lead Hunter para utilizar as automações de mensagens.</p>
          )}
        </div>
        <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold', TONE[status])} role="status" aria-live="polite">
          {conn ? <span className={cx('h-2 w-2 rounded-full', DOT[status])} aria-hidden /> : <Spinner className="h-3 w-3" />}
          {conn ? (connected ? 'Ativo' : LABEL[status]) : 'Verificando…'}
        </span>
      </div>

      {connected && conn && (
        <dl className="mt-4 grid gap-2 text-[13.5px] sm:grid-cols-3">
          <div className="rounded-lg border border-line px-3 py-2.5">
            <dt className="text-xs text-ink-faint">Número</dt>
            <dd className="font-mono font-semibold">{conn.phone ?? '—'}</dd>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <dt className="text-xs text-ink-faint">Status</dt>
            <dd className="font-semibold text-good">Ativo</dd>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <dt className="text-xs text-ink-faint">Última conexão</dt>
            <dd className="font-semibold">{conn.lastSeenAt ? formatDateTime(conn.lastSeenAt) : conn.connectedAt ? formatDateTime(conn.connectedAt) : '—'}</dd>
          </div>
        </dl>
      )}

      {status === 'reconectando' && <p className="mt-3 text-[13px] text-warn">Restabelecendo a sessão salva. Não é preciso ler o QR code de novo.</p>}
      {conn?.error && status !== 'conectado' && <div className="mt-3"><ErrorBox>{conn.error}</ErrorBox></div>}
      {error && error !== conn?.error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
      {testResult && (
        <p className={cx('mt-3 text-[13px] font-semibold', testResult.ok ? 'text-good' : 'text-bad')}>{testResult.message}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {connected ? (
          <>
            <button type="button" className="btn-primary" onClick={test} disabled={!!busy}>
              {busy === 'test' ? <Spinner /> : <PlugZap className="h-4 w-4" />} TESTAR CONEXÃO
            </button>
            <button type="button" className="btn-outline text-bad" onClick={() => setConfirm(true)} disabled={!!busy}>
              {busy === 'disconnect' ? <Spinner /> : <Unplug className="h-4 w-4" />} DESCONECTAR WHATSAPP
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={connect} disabled={!!busy || status === 'reconectando'}>
            {busy === 'connect' ? <Spinner /> : <MessageCircle className="h-4 w-4" />} {working && status === 'aguardando_qr' ? 'MOSTRAR QR CODE' : 'CONECTAR WHATSAPP'}
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        A sessão fica salva e criptografada no servidor, não no navegador. Envios são individuais, com intervalo mínimo e limite diário, e respeitam a lista de supressão. Usar o WhatsApp por fora da API oficial pode levar a bloqueio do número pelo WhatsApp: prefira um número comercial e evite volume alto.
      </p>

      {qrOpen && (
        <Modal title="Conectar WhatsApp" onClose={() => setQrOpen(false)}>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex h-[248px] w-[248px] shrink-0 items-center justify-center rounded-xl border border-line bg-white p-2">
              {status === 'aguardando_qr' && conn?.qr ? (
                <img src={conn.qr} alt="QR code para conectar o WhatsApp" className="h-full w-full" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-[13px] text-neutral-500">
                  <Spinner />
                  {status === 'conectando' ? 'Conectando…' : 'Gerando QR code…'}
                </div>
              )}
            </div>
            <div>
              <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px]">
                {STEPS.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-faint">
                <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" /> O QR code se renova sozinho quando expira. Esta janela fecha ao conectar.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog title="Desconectar WhatsApp" confirmLabel="Desconectar" onClose={() => setConfirm(false)} onConfirm={() => void disconnect()}>
          Tem certeza que deseja desconectar este WhatsApp?
        </ConfirmDialog>
      )}
    </section>
  );
}
