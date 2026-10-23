import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Pencil, PlugZap, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { formatDateTime } from '@/core/utils';
import { ConfirmDialog, ErrorBox, Modal, Spinner, cx } from '@/components/ui';
import { waStatusStore, whatsappClient, whatsappQrAvailable, type WaNumber, type WaStatus, type WaStatusView } from '@/lib/whatsappClient';

const LABEL: Record<WaStatus, string> = {
  desconectado: 'Desconectado',
  aguardando_qr: 'Aguardando QR Code',
  conectando: 'Conectando',
  conectado: 'Ativo',
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
const WORKING: WaStatus[] = ['aguardando_qr', 'conectando', 'reconectando'];

const nameOf = (n: WaNumber) => n.label || (n.slot === 'principal' ? 'Número principal' : 'Número extra');

/**
 * Configurações → WhatsApp: seus números (QR code), cada um com o próprio limite diário.
 * A sessão fica no servidor, nunca no navegador. O lead fica sempre com o mesmo número.
 */
export function WhatsAppConnectionCard() {
  const { toast } = useApp();
  const [numbers, setNumbers] = useState<WaNumber[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [qrSlot, setQrSlot] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'disconnect' | 'remove'; n: WaNumber } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await whatsappClient.numbers();
      setNumbers(list);
      setError('');
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  // Atualiza sozinho: rápido enquanto algum número espera o QR ou conecta, lento quando estável.
  useEffect(() => {
    if (!whatsappQrAvailable) return;
    let alive = true;
    const tick = async () => {
      const list = await load();
      if (!alive) return;
      const fast = !!list?.some((n) => WORKING.includes(n.status)) || !!qrSlot;
      timer.current = setTimeout(tick, fast ? 2500 : 30_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, qrSlot]);

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

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
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

  const afterChange = async () => {
    await load();
    void waStatusStore.refresh();
  };

  async function connect(n: WaNumber) {
    const v = await run(`connect:${n.slot}`, () => whatsappClient.connect(n.slot));
    if (v) {
      await afterChange();
      if (v.status !== 'conectado') setQrSlot(n.slot);
    }
  }

  async function test(n: WaNumber) {
    const r = await run(`test:${n.slot}`, () => whatsappClient.test(n.slot));
    if (r) setTests((t) => ({ ...t, [n.slot]: r }));
  }

  async function disconnect(n: WaNumber) {
    const v = await run(`disconnect:${n.slot}`, () => whatsappClient.disconnect(n.slot));
    if (v) {
      await afterChange();
      toast(`${nameOf(n)} desconectado.`);
    }
  }

  async function remove(n: WaNumber) {
    const list = await run(`remove:${n.slot}`, () => whatsappClient.removeNumber(n.slot));
    if (list) {
      setNumbers(list);
      void waStatusStore.refresh();
      toast(`${nameOf(n)} removido.`);
    }
  }

  async function update(n: WaNumber, patch: { label?: string | null; dailyLimit?: number; active?: boolean }) {
    const list = await run(`update:${n.slot}`, () => whatsappClient.updateNumber(n.slot, patch));
    if (list) setNumbers(list);
  }

  async function add(label: string) {
    const v = await run('add', () => whatsappClient.addNumber(label));
    if (v?.slot) {
      setAdding(false);
      await load();
      setQrSlot(v.slot);
    }
  }

  const connectedCount = numbers?.filter((n) => n.status === 'conectado' && n.active).length ?? 0;
  const capacity = numbers?.filter((n) => n.active).reduce((t, n) => t + n.dailyLimit, 0) ?? 0;

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><MessageCircle className="h-4 w-4" /> Seus números de WhatsApp</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            {numbers
              ? `${connectedCount} de ${numbers.length} conectado${numbers.length > 1 ? 's' : ''} · até ${capacity} mensagens de prospecção por dia no total.`
              : 'Carregando…'}{' '}
            Cada lead conversa sempre pelo mesmo número.
          </p>
        </div>
        <button type="button" className="btn-outline min-h-[36px] px-3 text-sm" onClick={() => setAdding(true)} disabled={!!busy || !numbers}>
          <Plus className="h-4 w-4" /> Adicionar número
        </button>
      </div>

      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

      {!numbers ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-faint"><Spinner /> Verificando…</div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {numbers.map((n) => (
            <NumberRow
              key={n.slot}
              n={n}
              busy={busy}
              test={tests[n.slot]}
              onConnect={() => void connect(n)}
              onShowQr={() => setQrSlot(n.slot)}
              onTest={() => void test(n)}
              onDisconnect={() => setConfirm({ kind: 'disconnect', n })}
              onRemove={() => setConfirm({ kind: 'remove', n })}
              onUpdate={(patch) => void update(n, patch)}
            />
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        A sessão de cada número fica salva e criptografada no servidor, não no navegador. Envios são individuais, com intervalo entre mensagens e limite diário por número, e respeitam a lista de supressão.
        Usar o WhatsApp por fora da API oficial pode levar a bloqueio: cada número tem a própria reputação, e mais números não reduzem esse risco. Mantenha limites baixos (até 20 por número) e use números comerciais.
      </p>

      {qrSlot && <QrModal slot={qrSlot} name={numbers?.find((n) => n.slot === qrSlot) ? nameOf(numbers.find((n) => n.slot === qrSlot)!) : 'Novo número'} onDone={(ok) => { setQrSlot(null); void afterChange(); if (ok) toast('WhatsApp conectado.', 'success'); }} />}

      {adding && <AddModal busy={busy === 'add'} onClose={() => setAdding(false)} onAdd={(label) => void add(label)} />}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'remove' ? `Remover ${nameOf(confirm.n)}` : `Desconectar ${nameOf(confirm.n)}`}
          confirmLabel={confirm.kind === 'remove' ? 'Remover' : 'Desconectar'}
          onClose={() => setConfirm(null)}
          onConfirm={() => void (confirm.kind === 'remove' ? remove(confirm.n) : disconnect(confirm.n))}
        >
          {confirm.kind === 'remove'
            ? 'O número sai do Lead Hunter. Os leads que conversavam por ele passam a receber pelo número com mais folga.'
            : 'Os leads deste número esperam até você conectar de novo (não mudam de número).'}
        </ConfirmDialog>
      )}
    </section>
  );
}

function NumberRow(props: {
  n: WaNumber;
  busy: string;
  test?: { ok: boolean; message: string };
  onConnect: () => void;
  onShowQr: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onUpdate: (patch: { label?: string | null; dailyLimit?: number; active?: boolean }) => void;
}) {
  const { n, busy } = props;
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(n.label ?? '');
  const [limit, setLimit] = useState(String(n.dailyLimit));
  useEffect(() => setLimit(String(n.dailyLimit)), [n.dailyLimit]);
  const connected = n.status === 'conectado';
  const mine = (k: string) => busy === `${k}:${n.slot}`;

  return (
    <li className={cx('rounded-xl border border-line p-4', !n.active && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                props.onUpdate({ label: label.trim() || null });
                setEditing(false);
              }}
            >
              <label htmlFor={`wa-label-${n.slot}`} className="sr-only">Nome do número</label>
              <input id={`wa-label-${n.slot}`} className="input min-h-[34px] w-[200px] py-0 text-sm" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
              <button type="submit" className="btn-outline min-h-[34px] px-2.5 text-xs">Salvar</button>
            </form>
          ) : (
            <button type="button" className="group flex items-center gap-1.5 text-left text-sm font-bold" onClick={() => setEditing(true)}>
              {nameOf(n)} <Pencil className="h-3.5 w-3.5 text-ink-faint group-hover:text-accent" aria-label="Renomear" />
            </button>
          )}
          <div className="mt-0.5 font-mono text-[13px] text-ink-soft">{n.phone ?? '—'}</div>
        </div>
        <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold', TONE[n.status])} role="status" aria-live="polite">
          <span className={cx('h-2 w-2 rounded-full', DOT[n.status])} aria-hidden /> {LABEL[n.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <div className="flex items-center gap-1.5">
          <label htmlFor={`wa-limit-${n.slot}`} className="text-ink-faint">Limite por dia</label>
          <input
            id={`wa-limit-${n.slot}`}
            type="number"
            min={1}
            max={200}
            className="input min-h-[32px] w-[72px] py-0 text-sm"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            onBlur={() => {
              const v = Math.max(1, Math.min(200, Math.round(Number(limit) || n.dailyLimit)));
              setLimit(String(v));
              if (v !== n.dailyLimit) props.onUpdate({ dailyLimit: v });
            }}
          />
        </div>
        <span className="text-ink-faint">Hoje: <b className="text-ink">{n.sentToday}</b> enviadas</span>
        {n.lastSeenAt && connected && <span className="text-ink-faint">Ativo em {formatDateTime(n.lastSeenAt)}</span>}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={n.active} onChange={(e) => props.onUpdate({ active: e.target.checked })} />
          Usar na prospecção
        </label>
      </div>

      {n.status === 'reconectando' && <p className="mt-2 text-[13px] text-warn">Restabelecendo a sessão salva. Não é preciso ler o QR code de novo.</p>}
      {n.error && !connected && <div className="mt-2"><ErrorBox>{n.error}</ErrorBox></div>}
      {props.test && <p className={cx('mt-2 text-[13px] font-semibold', props.test.ok ? 'text-good' : 'text-bad')}>{props.test.message}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {connected ? (
          <>
            <button type="button" className="btn-outline min-h-[34px] px-3 text-xs" onClick={props.onTest} disabled={!!busy}>
              {mine('test') ? <Spinner /> : <PlugZap className="h-3.5 w-3.5" />} Testar
            </button>
            <button type="button" className="btn-outline min-h-[34px] px-3 text-xs text-bad" onClick={props.onDisconnect} disabled={!!busy}>
              {mine('disconnect') ? <Spinner /> : <Unplug className="h-3.5 w-3.5" />} Desconectar
            </button>
          </>
        ) : n.status === 'aguardando_qr' ? (
          <button type="button" className="btn-primary min-h-[34px] px-3 text-xs" onClick={props.onShowQr}>Mostrar QR Code</button>
        ) : (
          <button type="button" className="btn-primary min-h-[34px] px-3 text-xs" onClick={props.onConnect} disabled={!!busy || n.status === 'reconectando'}>
            {mine('connect') ? <Spinner /> : <MessageCircle className="h-3.5 w-3.5" />} Conectar
          </button>
        )}
        {n.slot !== 'principal' && (
          <button type="button" className="btn-ghost min-h-[34px] px-3 text-xs text-bad" onClick={props.onRemove} disabled={!!busy}>
            {mine('remove') ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />} Remover
          </button>
        )}
      </div>
    </li>
  );
}

/** QR do número escolhido: atualiza sozinho e fecha ao conectar. */
function QrModal({ slot, name, onDone }: { slot: string; name: string; onDone: (connected: boolean) => void }) {
  const [v, setV] = useState<WaStatusView | null>(null);
  const prev = useRef<WaStatus | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await whatsappClient.status(slot);
        if (!alive) return;
        setV(s);
        if (s.status === 'conectado') return done.current(true);
        if ((s.status === 'desconectado' || s.status === 'erro') && prev.current && prev.current !== s.status) return done.current(false);
        prev.current = s.status;
      } catch {
        /* tenta de novo */
      }
      if (alive) t = setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slot]);

  return (
    <Modal title={`Conectar WhatsApp — ${name}`} onClose={() => onDone(false)}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex h-[248px] w-[248px] shrink-0 items-center justify-center rounded-xl border border-line bg-white p-2">
          {v?.status === 'aguardando_qr' && v.qr ? (
            <img src={v.qr} alt="QR code para conectar o WhatsApp" className="h-full w-full" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[13px] text-neutral-500">
              <Spinner />
              {v?.status === 'conectando' ? 'Conectando…' : 'Gerando QR code…'}
            </div>
          )}
        </div>
        <div>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px]">
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="mt-3 text-xs text-ink-faint">Use o celular do número que você quer conectar.</p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-faint">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" /> O QR code se renova sozinho quando expira. Esta janela fecha ao conectar.
          </p>
          {v?.error && <div className="mt-3"><ErrorBox>{v.error}</ErrorBox></div>}
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ busy, onClose, onAdd }: { busy: boolean; onClose: () => void; onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('');
  return (
    <Modal title="Adicionar número de WhatsApp" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(label.trim());
        }}
      >
        <label htmlFor="wa-new-label" className="label">Nome do número</label>
        <input id="wa-new-label" className="input" placeholder="Ex.: Comercial 2" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        <p className="mt-2 text-xs text-ink-faint">Em seguida aparece o QR code: leia com o celular desse número. Ele começa com limite de 20 mensagens de prospecção por dia.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <Plus className="h-4 w-4" />} Gerar QR code</button>
        </div>
      </form>
    </Modal>
  );
}
