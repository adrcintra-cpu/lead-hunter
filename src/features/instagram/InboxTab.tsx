import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, RefreshCw, Send, Sparkles, UserRound } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { EmptyState, ErrorBox, Skeleton, Spinner, cx } from '@/components/ui';
import {
  IG_CLASS_LABEL,
  byteLength,
  instagramApi,
  windowLeft,
  type IgConvStatus,
  type IgConversation,
  type IgMessage,
  type IgSettings,
} from '@/services/instagram/instagramApi';

const FILTERS: { id: 'abertas' | IgConvStatus | 'todas'; label: string }[] = [
  { id: 'abertas', label: 'Em aberto' },
  { id: 'humano', label: 'Com humano' },
  { id: 'encerrada', label: 'Encerradas' },
  { id: 'todas', label: 'Todas' },
];

const STATUS_BADGE: Record<IgConvStatus, { label: string; cls: string }> = {
  aberta: { label: 'BEELIE', cls: 'bg-accent-soft text-accent-strong' },
  humano: { label: 'Humano', cls: 'bg-warn-soft text-warn' },
  encerrada: { label: 'Encerrada', cls: 'bg-muted text-ink-faint' },
};

const POLL_MS = 20_000;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const who = (c: IgConversation) => c.name || (c.username ? `@${c.username}` : 'Contato do Instagram');

/** Instagram Inbox: conversas do Direct, sugestão do BEELIE e envio aprovado pela equipe. */
export function InboxTab({ settings, canWrite, connected }: { settings: IgSettings; canWrite: boolean; connected: boolean }) {
  const [convs, setConvs] = useState<IgConversation[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('abertas');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadConvs = useCallback(async () => {
    try {
      setConvs(await instagramApi.conversations());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConvs((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    void loadConvs();
    const t = setInterval(() => {
      if (!document.hidden) void loadConvs();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [loadConvs]);

  const list = useMemo(
    () => (convs ?? []).filter((c) => (filter === 'todas' ? true : filter === 'abertas' ? c.status === 'aberta' : c.status === filter)),
    [convs, filter],
  );
  const current = (convs ?? []).find((c) => c.id === selected) ?? null;

  if (!settings.enabled) {
    return (
      <div className="card">
        <EmptyState icon={<Bot className="h-7 w-7" />} title="Módulo desligado">
          Ligue o Instagram Agent em Configurações para o Direct começar a chegar aqui. Desligado, nenhuma mensagem é lida.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      {!connected && <ErrorBox>Nenhuma conta do Instagram conectada. Conecte em Contas conectadas.</ErrorBox>}
      <div className="card grid min-h-[560px] overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
        {/* Lista */}
        <div className={cx('flex min-h-0 flex-col border-line md:border-r', selected && 'hidden md:flex')}>
          <div className="flex flex-wrap items-center gap-1 border-b border-line p-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx('min-h-[30px] rounded-md px-2.5 text-xs font-bold', filter === f.id ? 'bg-muted text-ink' : 'text-ink-faint hover:text-ink')}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="btn-ghost ml-auto min-h-[30px] px-2" aria-label="Atualizar conversas" onClick={() => void loadConvs()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {convs === null ? (
            <div className="flex flex-col gap-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : list.length === 0 ? (
            <p className="p-4 text-sm text-ink-faint">
              {convs.length === 0 ? 'Nenhuma mensagem ainda. Quando alguém escrever no Direct da conta conectada, a conversa aparece aqui.' : 'Nenhuma conversa neste filtro.'}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={cx('flex w-full flex-col gap-0.5 px-3.5 py-3 text-left hover:bg-subtle', selected === c.id && 'bg-subtle')}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{who(c)}</span>
                      <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold', STATUS_BADGE[c.status].cls)}>{STATUS_BADGE[c.status].label}</span>
                    </span>
                    <span className="truncate text-xs text-ink-faint">{c.summary || (c.username ? `@${c.username}` : '')}</span>
                    <span className="flex items-center gap-2 text-[11px] text-ink-faint">
                      {when(c.lastMessageAt)}
                      {c.classification && <span className="rounded bg-muted px-1.5">{IG_CLASS_LABEL[c.classification]}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Conversa */}
        <div className={cx('flex min-h-0 flex-col', !selected && 'hidden md:flex')}>
          {current ? (
            <Conversation key={current.id} conv={current} canWrite={canWrite} mode={settings.mode} onBack={() => setSelected(null)} onChanged={loadConvs} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-ink-faint">Escolha uma conversa.</div>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        Pelas regras do Instagram, o OxyHub só responde quem escreveu, até 24 h depois da última mensagem da pessoa. Nunca inicia conversa.
      </p>
    </div>
  );
}

function Conversation({ conv, canWrite, mode, onBack, onChanged }: { conv: IgConversation; canWrite: boolean; mode: IgSettings['mode']; onBack: () => void; onChanged: () => Promise<void> }) {
  const { toast } = useApp();
  const [msgs, setMsgs] = useState<IgMessage[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const touched = useRef(false);

  const load = useCallback(async () => {
    try {
      const m = await instagramApi.messages(conv.id);
      setMsgs(m);
      // A sugestão do BEELIE entra na caixa de texto (até alguém começar a editar).
      const sug = m.find((x) => x.status === 'sugerida');
      if (sug?.suggested && !touched.current) setText(sug.suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [conv.id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length]);

  const shown = (msgs ?? []).filter((m) => m.status !== 'sugerida' && m.body);
  const suggestion = (msgs ?? []).find((m) => m.status === 'sugerida') ?? null;
  const left = windowLeft(conv.lastInboundAt);
  const hours = Math.floor(left / 3600_000);
  const optOut = conv.classification === 'opt_out';
  const bytes = byteLength(text.trim());
  const canSend = canWrite && !optOut && left > 0 && !!text.trim() && bytes <= 1000 && !busy;

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

  const send = () =>
    run('send', async () => {
      const useSug = suggestion?.suggested ? suggestion.id : undefined;
      await instagramApi.send(conv.id, text.trim(), useSug);
      toast('Mensagem enviada no Direct.', 'success');
      touched.current = false;
      setText('');
      await Promise.all([load(), onChanged()]);
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" className="btn-ghost min-h-[32px] px-2 md:hidden" onClick={onBack} aria-label="Voltar para a lista">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{who(conv)}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
            {conv.username && (
              <a href={`https://www.instagram.com/${conv.username}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                @{conv.username} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {conv.classification && <span>{IG_CLASS_LABEL[conv.classification]}</span>}
          </div>
        </div>
        {conv.leadId ? (
          <Link to={`/leads/${conv.leadId}`} className="btn-ghost min-h-[32px] px-2 text-xs">
            <UserRound className="h-4 w-4" /> Abrir lead
          </Link>
        ) : (
          canWrite && (
            <button
              type="button"
              className="btn-ghost min-h-[32px] px-2 text-xs"
              disabled={!!busy}
              onClick={() =>
                run('lead', async () => {
                  const r = await instagramApi.toLead(conv.id);
                  toast(r.created ? 'Lead criado no Lead Hunter.' : 'Conversa ligada ao lead que já existia.', 'success');
                  await onChanged();
                })
              }
            >
              {busy === 'lead' ? <Spinner /> : <UserRound className="h-4 w-4" />} Criar lead
            </button>
          )
        )}
        {canWrite && !optOut && (
          <button
            type="button"
            className="btn-ghost min-h-[32px] px-2 text-xs"
            disabled={!!busy}
            onClick={() =>
              run('human', async () => {
                await instagramApi.human(conv.id, conv.status !== 'humano');
                toast(conv.status !== 'humano' ? 'Conversa com atendimento humano. O BEELIE para de sugerir.' : 'Conversa devolvida ao BEELIE.', 'success');
                await onChanged();
              })
            }
          >
            {busy === 'human' ? <Spinner /> : conv.status === 'humano' ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            {conv.status === 'humano' ? 'Devolver ao BEELIE' : 'Passar para humano'}
          </button>
        )}
      </div>

      {conv.summary && <div className="border-b border-line bg-subtle px-4 py-2 text-xs text-ink-soft"><span className="font-bold">Resumo do BEELIE:</span> {conv.summary}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {msgs === null ? (
          <Skeleton className="h-20 w-2/3" />
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((m) => (
              <li key={m.id} className={cx('flex', m.direction === 'saida' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cx(
                    'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                    m.direction === 'saida' ? 'bg-accent text-white' : 'bg-muted text-ink',
                    m.status === 'falhou' && 'border border-bad bg-bad-soft text-bad',
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={cx('mt-1 text-[10.5px]', m.direction === 'saida' && m.status !== 'falhou' ? 'text-white/70' : 'text-ink-faint')}>
                    {when(m.createdAt)}
                    {m.direction === 'saida' && (m.status === 'falhou' ? ` · não enviada: ${m.failureReason ?? ''}` : m.status === 'aprovada' ? ' · enviando…' : m.auto ? ' · BEELIE (automático)' : '')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-4 py-3">
        {error && <div className="mb-2"><ErrorBox>{error}</ErrorBox></div>}
        {optOut ? (
          <p className="text-sm text-ink-faint">Esta pessoa pediu para não receber mensagens. O OxyHub não envia mais nada para ela.</p>
        ) : left <= 0 ? (
          <p className="text-sm text-ink-faint">Janela de 24 h fechada. Pelas regras do Instagram, só dá para responder quando a pessoa escrever de novo.</p>
        ) : !canWrite ? (
          <p className="text-sm text-ink-faint">Seu acesso é só de leitura.</p>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
              <span>
                {suggestion ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-accent-strong"><Sparkles className="h-3.5 w-3.5" /> Sugestão do BEELIE: revise e envie</span>
                ) : conv.status === 'humano' ? (
                  'Atendimento humano: escreva a resposta.'
                ) : mode === 'observador' ? (
                  'Modo Observador: peça uma sugestão ou escreva.'
                ) : (
                  'Escreva a resposta ou peça uma sugestão.'
                )}
              </span>
              <span>Janela: {hours >= 1 ? `${hours} h restantes` : 'menos de 1 h'}</span>
            </div>
            <label htmlFor={`ig-reply-${conv.id}`} className="sr-only">Resposta</label>
            <textarea
              id={`ig-reply-${conv.id}`}
              rows={3}
              className="input py-2.5 text-sm"
              value={text}
              placeholder="Escreva a resposta…"
              onChange={(e) => {
                touched.current = true;
                setText(e.target.value);
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cx('text-xs', bytes > 1000 ? 'text-bad' : 'text-ink-faint')}>{bytes}/1000</span>
              <button
                type="button"
                className="btn-ghost ml-auto min-h-[36px] px-3 text-sm"
                disabled={!!busy}
                onClick={() =>
                  run('suggest', async () => {
                    touched.current = false;
                    await instagramApi.suggest(conv.id);
                    await Promise.all([load(), onChanged()]);
                  })
                }
              >
                {busy === 'suggest' ? <Spinner /> : <Sparkles className="h-4 w-4" />} {suggestion ? 'Gerar outra' : 'Gerar sugestão'}
              </button>
              <button type="button" className="btn-primary min-h-[36px]" disabled={!canSend} onClick={send}>
                {busy === 'send' ? <Spinner /> : <Send className="h-4 w-4" />} Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
