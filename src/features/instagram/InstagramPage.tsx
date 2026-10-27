import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Circle, Link2, Unplug } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { formatDate } from '@/core/utils';
import { ConfirmDialog, EmptyState, ErrorBox, PageHeader, Skeleton, Spinner, cx } from '@/components/ui';
import {
  IG_DEFAULTS,
  IG_SCOPE_LABEL,
  daysLeft,
  effectiveStatus,
  instagramApi,
  type IgAccount,
  type IgMode,
  type IgSettings,
  type IgStatus,
} from '@/services/instagram/instagramApi';

const TABS = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'contas', label: 'Contas conectadas' },
  { id: 'config', label: 'Configurações' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const MODE_INFO: Record<IgMode, { label: string; hint: string }> = {
  observador: { label: 'Observador', hint: 'Só identifica oportunidades e sugere ações. Nada é enviado.' },
  assistido: { label: 'Assistido', hint: 'O BEELIE escreve as sugestões e você aprova cada uma antes de sair.' },
  automatico: { label: 'Automático', hint: 'Só para o que a API oficial permite (Direct e respostas nos seus posts). Comentários em perfis de terceiros são sempre manuais.' },
};

/** Instagram Agent: visão geral, contas conectadas e configurações. */
export function InstagramPage() {
  const { team, session } = useApp();
  const isAdmin = !team || team.role === 'admin';
  const ownerId = team?.ownerId ?? session?.userId ?? '';
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'visao') as Tab;
  const [status, setStatus] = useState<IgStatus | null>(null);
  const [accounts, setAccounts] = useState<IgAccount[] | null>(null);
  const [settings, setSettings] = useState<IgSettings | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [st, acc, cfg] = await Promise.allSettled([instagramApi.status(), instagramApi.accounts(), instagramApi.settings()]);
    setStatus(st.status === 'fulfilled' ? st.value : null);
    setAccounts(acc.status === 'fulfilled' ? acc.value : []);
    setSettings(cfg.status === 'fulfilled' ? cfg.value : { ...IG_DEFAULTS });
    const firstErr = [st, acc, cfg].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstErr) setError(firstErr.reason instanceof Error ? firstErr.reason.message : String(firstErr.reason));
  }, []);

  useEffect(() => {
    if (dataMode === 'supabase') void load();
  }, [load]);

  if (dataMode !== 'supabase') {
    return (
      <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
        <PageHeader title="Instagram Agent" />
        <div className="card"><EmptyState title="Disponível só no modo real">O Instagram Agent usa o login oficial da Meta e precisa do Supabase.</EmptyState></div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <PageHeader title="Instagram Agent" subtitle="Atendimento no Direct, oportunidades e interações no Instagram, com o BEELIE e só pelos recursos oficiais da Meta." />

      <div role="tablist" aria-label="Partes do Instagram Agent" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'visao' ? {} : { aba: t.id }, { replace: true })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-bold', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {tab === 'visao' && <Overview status={status} accounts={accounts} settings={settings} goTo={(t) => setParams({ aba: t }, { replace: true })} />}
      {tab === 'contas' && <Accounts status={status} accounts={accounts} isAdmin={isAdmin} reload={load} />}
      {tab === 'config' && settings && accounts && (
        <GeneralSettings settings={settings} accounts={accounts} isAdmin={isAdmin} ownerId={ownerId} onSaved={setSettings} />
      )}
    </div>
  );
}

function Overview({ status, accounts, settings, goTo }: { status: IgStatus | null; accounts: IgAccount[] | null; settings: IgSettings | null; goTo: (t: Tab) => void }) {
  const [m, setM] = useState<Awaited<ReturnType<typeof instagramApi.metrics>> | null>(null);
  useEffect(() => {
    if (settings) void instagramApi.metrics(settings.minScore).then(setM, () => setM(null));
  }, [settings]);
  const connected = (accounts ?? []).some((a) => effectiveStatus(a) === 'conectado');
  const steps = [
    { done: !!status?.configured && !!status?.tokenKey, label: 'Integração com a Meta configurada', hint: 'App no Meta for Developers e secrets no Supabase.', tab: 'contas' as Tab },
    { done: connected, label: 'Conta do Instagram conectada', hint: 'Pelo login oficial do Facebook. A senha nunca passa pelo OxyHub.', tab: 'contas' as Tab },
    { done: !!settings?.enabled, label: 'Módulo ligado', hint: 'Em Configurações. Desligado, nada roda.', tab: 'config' as Tab },
  ];
  const cards: [string, number | undefined][] = [
    ['Perfis analisados', m?.perfis],
    ['Oportunidades identificadas', m?.oportunidades],
    ['Comentários sugeridos', m?.sugeridos],
    ['Comentários aprovados', m?.aprovados],
    ['Mensagens recebidas', m?.recebidas],
    ['Atendimentos', m?.atendimentos],
    ['Leads qualificados', m?.qualificados],
    ['Reuniões', m?.reunioes],
  ];
  return (
    <>
      <section className="card px-5 py-5">
        <h2 className="text-[15px] font-extrabold">Para começar</h2>
        <ol className="mt-3 flex flex-col gap-2.5">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2.5">
              {s.done ? <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-good" aria-hidden /> : <Circle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-faint" aria-hidden />}
              <div className="min-w-0">
                <div className="text-sm font-bold">
                  {s.label} <span className="sr-only">{s.done ? '(feito)' : '(pendente)'}</span>
                </div>
                <div className="text-xs text-ink-faint">{s.hint}</div>
              </div>
              {!s.done && (
                <button type="button" className="btn-ghost ml-auto min-h-[30px] shrink-0 px-2 text-xs" onClick={() => goTo(s.tab)}>
                  Abrir
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, n]) => (
          <div key={label} className="card px-4 py-3.5">
            <div className="text-xs text-ink-faint">{label}</div>
            {n === undefined ? <Skeleton className="mt-1.5 h-7 w-12" /> : <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{n}</div>}
          </div>
        ))}
      </section>
      <p className="-mt-2 text-xs text-ink-faint">Números reais do módulo. Ficam em zero até a conta estar conectada e o Inbox e o Radar entrarem em funcionamento.</p>
    </>
  );
}

function Accounts({ status, accounts, isAdmin, reload }: { status: IgStatus | null; accounts: IgAccount[] | null; isAdmin: boolean; reload: () => Promise<void> }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<IgAccount | null>(null);
  const ready = !!status?.configured && !!status?.tokenKey;
  const visible = (accounts ?? []).filter((a) => a.status !== 'desconectado');

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const { url } = await instagramApi.startConnect();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  }

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold">Contas conectadas</h2>
          <p className="mt-1 max-w-xl text-[13px] text-ink-faint">
            Conta profissional do Instagram ligada a uma Página do Facebook. A conexão é feita no site do Facebook: o OxyHub nunca pede nem guarda a sua senha, e a autorização fica protegida no servidor.
          </p>
        </div>
        {isAdmin && ready && (
          <button type="button" className="btn-primary" onClick={connect} disabled={!!busy}>
            {busy === 'connect' ? <Spinner /> : <Link2 className="h-4 w-4" />} {visible.length ? 'Conectar outra conta' : 'Conectar conta'}
          </button>
        )}
      </div>

      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

      {status === null && accounts === null && <Skeleton className="mt-4 h-16 w-full" />}

      {status && !ready && (
        <div className="mt-4 rounded-xl border border-line bg-subtle px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-bold"><span className="h-2 w-2 rounded-full bg-warn" aria-hidden /> Aguardando configuração</div>
          <p className="mt-1 text-[13px] text-ink-soft">Falta configurar o app da Meta no Supabase (Edge Functions → Secrets):</p>
          <ul className="mt-1.5 list-disc pl-5 text-[13px] text-ink-soft">
            {!status.configured && <li><span className="font-mono text-xs">META_APP_ID</span> e <span className="font-mono text-xs">META_APP_SECRET</span> (do Meta for Developers)</li>}
            {!status.tokenKey && <li><span className="font-mono text-xs">INSTAGRAM_TOKEN_KEY</span> (chave que protege os tokens)</li>}
          </ul>
          <p className="mt-2 text-[13px] text-ink-soft">
            No app da Meta, cadastre este endereço de retorno do login: <span className="break-all font-mono text-xs text-ink">{status.redirectUri}</span>
          </p>
        </div>
      )}

      {accounts && visible.length === 0 && ready && (
        <p className="mt-4 text-sm text-ink-faint">Nenhuma conta conectada ainda.{!isAdmin && ' Peça ao administrador para conectar.'}</p>
      )}

      {visible.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {visible.map((a) => {
            const st = effectiveStatus(a);
            const left = daysLeft(a);
            return (
              <li key={a.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold">@{a.username ?? a.igUserId}</div>
                    <div className="text-xs text-ink-faint">Conectada em {formatDate(a.connectedAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cx(
                        'rounded-md px-2 py-1 text-xs font-bold',
                        st === 'conectado' ? 'bg-good-soft text-good' : st === 'expirado' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad',
                      )}
                    >
                      {st === 'conectado' ? 'Conectada' : st === 'expirado' ? 'Autorização vencida' : 'Com erro'}
                    </span>
                    {isAdmin && (
                      <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs text-bad" onClick={() => setRemoving(a)} disabled={!!busy}>
                        <Unplug className="h-4 w-4" /> Desconectar
                      </button>
                    )}
                  </div>
                </div>
                {st === 'conectado' && left !== null && left <= 14 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-warn"><AlertTriangle className="h-3.5 w-3.5" /> A autorização vence em {Math.max(0, left)} dia(s). Conecte de novo para renovar.</p>
                )}
                {st === 'expirado' && <p className="mt-2 text-xs text-warn">A Meta pede uma nova autorização. {isAdmin ? 'Clique em "Conectar conta" de novo.' : 'Peça ao administrador para conectar de novo.'}</p>}
                {a.lastError && <p className="mt-2 text-xs text-bad">{a.lastError}</p>}
                {a.tokenExpiresAt && st === 'conectado' && <p className="mt-1 text-xs text-ink-faint">Autorização válida até {formatDate(a.tokenExpiresAt)}.</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Permissões autorizadas ({a.scopes.length})</summary>
                  <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                    {(status?.scopes.length ? status.scopes : Object.keys(IG_SCOPE_LABEL)).map((s) => {
                      const ok = a.scopes.includes(s);
                      return (
                        <li key={s} className={cx('flex items-center gap-1.5', ok ? 'text-ink-soft' : 'text-warn')}>
                          {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-good" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
                          {IG_SCOPE_LABEL[s] ?? s} {!ok && '(não autorizada)'}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {removing && (
        <ConfirmDialog
          title={`Desconectar @${removing.username ?? removing.igUserId}`}
          confirmLabel="Desconectar"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const a = removing;
            setBusy(`rm:${a.id}`);
            void instagramApi
              .disconnect(a.id)
              .then(async () => {
                toast('Conta desconectada.', 'success');
                setRemoving(null);
                await reload();
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(''));
          }}
        >
          O OxyHub apaga a autorização guardada e para de usar esta conta. O histórico de conversas e oportunidades continua. Para revogar também do lado da Meta: Facebook → Configurações → Integrações comerciais.
        </ConfirmDialog>
      )}
    </section>
  );
}

function GeneralSettings({ settings, accounts, isAdmin, ownerId, onSaved }: { settings: IgSettings; accounts: IgAccount[]; isAdmin: boolean; ownerId: string; onSaved: (s: IgSettings) => void }) {
  const { toast } = useApp();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const usable = accounts.filter((a) => a.status !== 'desconectado');
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const lock = !isAdmin || busy;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await instagramApi.saveSettings(s, ownerId);
      onSaved(s);
      toast('Configurações do Instagram Agent salvas.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card px-5 py-5">
      <h2 className="text-[15px] font-extrabold">Configurações gerais</h2>
      {!isAdmin && <p className="mt-1 text-xs text-ink-faint">Só o administrador altera estas configurações.</p>}
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

      <label className="mt-4 flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={s.enabled} disabled={lock} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        <span>
          <span className="block text-sm font-bold">Módulo ligado</span>
          <span className="block text-xs text-ink-faint">Desligado, o Instagram Agent não lê, não analisa e não responde nada. O resto do OxyHub não é afetado.</span>
        </span>
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ig-account" className="label">Conta usada</label>
          <select id="ig-account" className="input" value={s.accountId ?? ''} disabled={lock || !usable.length} onChange={(e) => setS({ ...s, accountId: e.target.value || null })}>
            {!usable.length && <option value="">Nenhuma conta conectada</option>}
            {usable.length > 0 && <option value="">Escolha a conta</option>}
            {usable.map((a) => <option key={a.id} value={a.id}>@{a.username ?? a.igUserId}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ig-limit" className="label">Limite diário de uso da IA</label>
          <input id="ig-limit" type="number" min={0} max={2000} className="input" value={s.dailyAiLimit} disabled={lock} onChange={(e) => setS({ ...s, dailyAiLimit: Number(e.target.value) || 0 })} />
          <p className="mt-1 text-xs text-ink-faint">Análises e respostas por dia. Controla o custo do Claude.</p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="label">Modo de funcionamento</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {(Object.keys(MODE_INFO) as IgMode[]).map((mode) => (
            <label key={mode} className={cx('flex cursor-pointer flex-col rounded-xl border px-3.5 py-3', s.mode === mode ? 'border-accent bg-accent-soft' : 'border-line', lock && 'cursor-default opacity-80')}>
              <span className="flex items-center gap-2 text-sm font-bold">
                <input type="radio" name="ig-mode" className="accent-[rgb(var(--accent))]" checked={s.mode === mode} disabled={lock} onChange={() => setS({ ...s, mode })} />
                {MODE_INFO[mode].label}
              </span>
              <span className="mt-1 text-xs text-ink-faint">{MODE_INFO[mode].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor="ig-persona" className="label">Ajustes da personalidade só para o Instagram</label>
        <textarea
          id="ig-persona"
          rows={4}
          maxLength={3000}
          className="input py-2.5 text-[13px] leading-relaxed"
          placeholder="Ex.: no Instagram, mensagens mais curtas e descontraídas; pode usar no máximo um emoji."
          value={s.personaExtra}
          disabled={lock}
          onChange={(e) => setS({ ...s, personaExtra: e.target.value })}
        />
        <p className="mt-1 text-xs text-ink-faint">O BEELIE usa a mesma personalidade e base de conhecimento do Assistente (Configurações). Aqui entram só as diferenças para o Instagram.</p>
      </div>

      {isAdmin && (
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !dirty}>
            {busy && <Spinner />} Salvar
          </button>
        </div>
      )}
    </section>
  );
}
