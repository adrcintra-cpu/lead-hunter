import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, Download, ExternalLink, Facebook, Link2, MessageCircle, RefreshCw, Sparkles, Unplug, X, Zap } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { ConfirmDialog, cx, EmptyState, Skeleton, Spinner } from '@/components/ui';
import { formatDateTime } from '@/core/utils';
import { stageLabel } from '@/core/types';
import { dataMode } from '@/lib/supabase';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { metaLeadsApi, PLATFORM_LABEL, type MetaLead, type MetaLeadsData, type MetaStatus } from '@/services/metaLeads';
import { MetaLeadForm } from './MetaLeadForm';

// ---------- Estado de funcionalidade (operacional / aguardando / em desenvolvimento) ----------

type FeatureState = 'operacional' | 'aguardando_integracao' | 'aguardando_autorizacao' | 'em_desenvolvimento' | 'indisponivel';
const FEATURE: Record<FeatureState, { label: string; cls: string }> = {
  operacional: { label: 'Operacional', cls: 'bg-good-soft text-good' },
  aguardando_integracao: { label: 'Aguardando integração', cls: 'bg-warn-soft text-warn' },
  aguardando_autorizacao: { label: 'Aguardando autorização', cls: 'bg-warn-soft text-warn' },
  em_desenvolvimento: { label: 'Em desenvolvimento', cls: 'bg-ink/[0.06] text-ink-soft' },
  indisponivel: { label: 'Indisponível', cls: 'bg-ink/[0.06] text-ink-soft' },
};
export function StateChip({ state }: { state: FeatureState }) {
  const f = FEATURE[state];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold', f.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {f.label}
    </span>
  );
}

function connectionState(st: MetaStatus | null): FeatureState {
  if (!st) return 'indisponivel';
  if (!st.configured || !st.tokenKey) return 'aguardando_integracao';
  const live = st.pages.filter((p) => p.status === 'conectado');
  if (!live.length) return 'aguardando_integracao';
  if (st.missingScopes.length) return 'aguardando_autorizacao';
  return 'operacional';
}

// ---------- Dados compartilhados entre as abas ----------

export function useMetaLeads() {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [data, setData] = useState<MetaLeadsData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (dataMode !== 'supabase') {
      setError('O Meta Leads usa a API oficial da Meta e precisa do modo real (Supabase).');
      return;
    }
    const [st, d] = await Promise.allSettled([metaLeadsApi.status(), metaLeadsApi.load()]);
    setStatus(st.status === 'fulfilled' ? st.value : null);
    setData(d.status === 'fulfilled' ? d.value : { leads: [], stages: {}, replied: new Set(), logs: [], autoFirstContact: true });
    const bad = [st, d].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(bad ? (bad.reason instanceof Error ? bad.reason.message : String(bad.reason)) : '');
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { status, data, error, load };
}
export type MetaCtx = ReturnType<typeof useMetaLeads>;

const ADVANCED = new Set(['reuniao', 'proposta', 'cliente']);
const day = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : '');

function kpis(d: MetaLeadsData, from: number) {
  const list = d.leads.filter((l) => l.created_time && new Date(l.created_time).getTime() >= from);
  const ids = list.map((l) => l.lead_id).filter(Boolean) as string[];
  return {
    list,
    total: list.length,
    contacted: list.filter((l) => l.enrolled_at).length,
    replied: ids.filter((id) => d.replied.has(id)).length,
    advanced: ids.filter((id) => ADVANCED.has(d.stages[id])).length,
    clients: ids.filter((id) => d.stages[id] === 'cliente').length,
  };
}

function Kpi({ label, value, hint, dot = 'bg-accent' }: { label: string; value: number | string | undefined; hint?: string; dot?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <span className={cx('h-1.5 w-1.5 rounded-full', dot)} /> {label}
      </div>
      {value === undefined ? <Skeleton className="mt-1.5 h-8 w-14" /> : <div className={cx('mt-0.5 text-[32px] font-light tabular-nums leading-tight', value === 0 ? 'text-ink/30' : 'text-[#2563EB]')}>{value}</div>}
      {hint && <div className="mt-0.5 text-[12px] text-ink-faint">{hint}</div>}
    </div>
  );
}

function PendingCard({ ctx, goConfig }: { ctx: MetaCtx; goConfig: () => void }) {
  const st = ctx.status;
  const state = connectionState(st);
  if (state === 'operacional') return null;
  return (
    <section className="card flex flex-wrap items-center gap-4 bg-gradient-to-r from-warn-soft/70 to-transparent p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold">{state === 'aguardando_autorizacao' ? 'Faltam permissões da Meta' : 'Conecte a Página que recebe os leads dos anúncios'}</h2>
          <StateChip state={state} />
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">
          {!st
            ? 'Não consegui consultar a integração agora.'
            : !st.configured || !st.tokenKey
              ? 'A integração com a Meta ainda não está configurada no servidor.'
              : state === 'aguardando_autorizacao'
                ? `A conexão foi feita sem: ${st.missingScopes.join(', ')}. Sem elas a Meta não entrega os leads.`
                : 'Nenhum número aqui é estimado: os indicadores começam a contar quando a Página estiver conectada.'}
        </p>
      </div>
      <button className="btn btn-primary" onClick={goConfig}>
        <Link2 size={18} /> Ver o que falta
      </button>
    </section>
  );
}

// ---------- Aba Meta Leads ----------

type Period = 7 | 30 | 90;

export function MetaLeadsTab({ ctx, goConfig }: { ctx: MetaCtx; goConfig: () => void }) {
  const [period, setPeriod] = useState<Period>(30);
  const [platform, setPlatform] = useState<'todos' | 'fb' | 'ig'>('todos');
  const [form, setForm] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MetaLead | null>(null);
  const d = ctx.data;
  const from = Date.now() - period * 86_400_000;
  const k = d ? kpis(d, from) : null;
  const forms = useMemo(() => [...new Set((d?.leads ?? []).map((l) => l.form_name ?? l.form_id).filter(Boolean))] as string[], [d]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (k?.list ?? []).filter(
      (l) =>
        (platform === 'todos' || l.platform === platform) &&
        (!form || (l.form_name ?? l.form_id) === form) &&
        (!term || [l.contact.name, l.contact.email, l.contact.phone, l.contact.company, l.campaign_name, l.ad_name].some((x) => x?.toLowerCase().includes(term))),
    );
  }, [k, platform, form, q]);
  const today = d ? d.leads.filter((l) => day(l.created_time) === day(new Date().toISOString())).length : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PendingCard ctx={ctx} goConfig={goConfig} />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Período" className="inline-flex rounded-full bg-ink/[0.05] p-1">
          {([7, 30, 90] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('rounded-full px-3.5 py-1.5 text-[13px] font-bold', period === p ? 'bg-white text-ink shadow-sm' : 'text-ink-soft')}>
              {p} dias
            </button>
          ))}
        </div>
        <button className="btn btn-ghost ml-auto" onClick={() => void ctx.load()} title="Atualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Leads recebidos" value={k?.total} hint={`Hoje: ${today ?? '—'}`} />
        <Kpi label="Contatados pelo Beelie" value={k?.contacted} hint="Primeiro contato automático" />
        <Kpi label="Responderam" value={k?.replied} hint="Resposta registrada no OxySDR" dot="bg-good" />
        <Kpi label="Reunião ou proposta" value={k ? k.advanced - k.clients : undefined} hint="Estágio no pipeline" />
        <Kpi label="Viraram clientes" value={k?.clients} hint="Estágio Cliente" dot="bg-good" />
      </section>
      <p className="-mt-3 text-xs text-ink-faint">Origem: Meta Leads (Graph API oficial) e o pipeline do OxySDR. Nada é estimado.</p>

      <div className="flex flex-wrap items-center gap-2">
        {(['todos', 'fb', 'ig'] as const).map((p) => (
          <button key={p} className={cx('btn', platform === p ? 'btn-dark' : 'btn-outline')} onClick={() => setPlatform(p)}>
            {p === 'todos' ? 'Todos' : PLATFORM_LABEL[p]}
          </button>
        ))}
        {forms.length > 1 && (
          <select className="input max-w-[240px]" value={form} onChange={(e) => setForm(e.target.value)} aria-label="Formulário">
            <option value="">Todos os formulários</option>
            {forms.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <input className="input max-w-[260px] sm:ml-auto" placeholder="Buscar nome, e-mail, campanha…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </div>

      {!d && !ctx.error ? (
        <div className="card p-6"><Skeleton className="h-24 w-full" /></div>
      ) : !list.length ? (
        <div className="card">
          <EmptyState icon={<Facebook size={28} />} title={d?.leads.length ? 'Nenhum lead com esses filtros' : 'Nenhum lead da Meta ainda'}>
            {d?.leads.length
              ? 'Troque o período ou os filtros.'
              : 'Conecte a Página em Configurações e importe o histórico. Os próximos formulários chegam sozinhos e o Beelie faz o primeiro contato na hora.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {list.slice(0, 300).map((l) => {
            const stage = l.lead_id ? d!.stages[l.lead_id] : undefined;
            return (
              <li key={l.id}>
                <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-ink/[0.03]" onClick={() => setOpen(l)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{l.contact.name || l.contact.email || l.contact.phone || 'Sem nome no formulário'}</div>
                    <div className="truncate text-[13px] text-ink-faint">
                      {[l.contact.company, l.campaign_name ?? l.form_name, l.ad_name].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <span className="glass-chip rounded-full px-2.5 py-0.5 text-[12px] font-bold">{(l.platform && PLATFORM_LABEL[l.platform]) || 'Meta'}</span>
                  {stage && <span className="text-[12px] font-semibold text-ink-soft">{stageLabel(stage)}</span>}
                  {l.lead_id && d!.replied.has(l.lead_id) ? (
                    <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-[12px] font-bold text-good">Respondeu</span>
                  ) : l.enrolled_at ? (
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-bold text-accent-ink">Beelie em contato</span>
                  ) : null}
                  <span className="w-[120px] text-right text-[12px] tabular-nums text-ink-faint">{l.created_time ? formatDateTime(l.created_time) : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 300 && <p className="text-xs text-ink-faint">Mostrando os 300 mais recentes de {list.length}. Use a busca ou os filtros.</p>}

      {open && <LeadSheet item={open} stage={open.lead_id ? d?.stages[open.lead_id] : undefined} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LeadSheet({ item, stage, onClose }: { item: MetaLead; stage?: string; onClose: () => void }) {
  const drawer = useLeadDrawer();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const c = item.contact;
  const wa = c.phone?.replace(/\D/g, '');
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside role="dialog" aria-modal="true" aria-label="Lead da Meta" className="glass-strong relative z-10 flex h-full w-full max-w-[460px] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold uppercase tracking-wide text-ink-faint">Meta Leads</div>
            <h2 className="text-[20px] font-bold leading-tight">{c.name || 'Sem nome no formulário'}</h2>
            {c.company && <div className="text-[14px] text-ink-soft">{c.company}{c.jobTitle ? ` · ${c.jobTitle}` : ''}</div>}
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
          {c.phone && (<><dt className="text-ink-faint">Telefone</dt><dd>{c.phone}</dd></>)}
          {c.email && (<><dt className="text-ink-faint">E-mail</dt><dd className="break-all">{c.email}</dd></>)}
          {c.city && (<><dt className="text-ink-faint">Cidade</dt><dd>{c.city}</dd></>)}
          <dt className="text-ink-faint">Pipeline</dt>
          <dd>{stage ? stageLabel(stage) : item.lead_id ? '—' : 'Não ligado a um lead'}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          {item.lead_id && (
            <button className="btn btn-primary" onClick={() => { onClose(); drawer.open(item.lead_id!); }}>
              <ArrowRight size={18} /> Abrir no OxySDR
            </button>
          )}
          {wa && (
            <a className="btn btn-outline" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18} /> WhatsApp
            </a>
          )}
        </div>
        <MetaLeadForm item={item} />
      </aside>
    </div>,
    document.body,
  );
}

// ---------- Aba Conversas ----------

export function ConversationsTab() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FeatureCard title="WhatsApp e e-mail dos leads" state="operacional" text="As conversas do Beelie com os leads da Meta ficam no histórico de cada lead e em Mensagens, junto com o resto do OxySDR.">
        <Link to="/envios" className="btn btn-outline"><MessageCircle size={18} /> Abrir Mensagens</Link>
      </FeatureCard>
      <FeatureCard title="Direct do Instagram" state="operacional" text="O atendimento no Direct já funciona no Instagram Agent, com o Beelie e só pela API oficial.">
        <Link to="/instagram?aba=inbox" className="btn btn-outline"><ExternalLink size={18} /> Abrir Inbox do Instagram</Link>
      </FeatureCard>
      <FeatureCard title="Messenger (Facebook)" state="em_desenvolvimento" text="Central de conversas do Messenger com o Beelie. Próxima fase: depende da permissão pages_messaging aprovada pela Meta. Nada é simulado até lá." />
    </div>
  );
}

function FeatureCard({ title, state, text, children }: { title: string; state: FeatureState; text: string; children?: ReactNode }) {
  return (
    <section className="card flex flex-col gap-2 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">{title}</h3>
        <StateChip state={state} />
      </div>
      <p className="text-[14px] text-ink-soft">{text}</p>
      {children && <div className="mt-1 flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}

// ---------- Aba Automações ----------

export function AutomationsTab({ ctx, goConfig }: { ctx: MetaCtx; goConfig: () => void }) {
  const st = connectionState(ctx.status);
  const on = ctx.data?.autoFirstContact ?? true;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FeatureCard
        title="Primeiro contato na hora"
        state={st === 'operacional' ? (on ? 'operacional' : 'indisponivel') : st}
        text={`Lead novo da Meta entra na campanha “Meta Leads — atendimento do Beelie”: WhatsApp na hora (dentro da janela de envio, limites e opt-out), retomada no dia 1 e e-mail no dia 3. Parou de responder? Para sozinho quando a pessoa responde.${on ? '' : ' Desligado em Configurações.'}`}
      >
        <button className="btn btn-outline" onClick={goConfig}><Zap size={18} /> Ajustar</button>
        <Link to="/campanhas" className="btn btn-ghost"><ArrowRight size={18} /> Ver campanhas</Link>
      </FeatureCard>
      <FeatureCard title="Reativação inteligente" state="em_desenvolvimento" text="Retomar leads antigos da Meta que não avançaram, com mensagem baseada nas respostas do formulário. Próxima fase. Os leads importados do histórico ficam guardados para ela e não recebem mensagem automática." />
      <FeatureCard title="Automações 24/7 por regra" state="em_desenvolvimento" text="Regras como “lead sem resposta em 2 dias → tarefa” ou “formulário X → campanha Y”. Próxima fase." />
    </div>
  );
}

// ---------- Aba Relatórios ----------

export function ReportsTab({ ctx }: { ctx: MetaCtx }) {
  const [by, setBy] = useState<'campanha' | 'formulario' | 'anuncio' | 'canal'>('campanha');
  const d = ctx.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const m = new Map<string, { total: number; contacted: number; replied: number; advanced: number; clients: number }>();
    for (const l of d.leads) {
      const key =
        by === 'campanha' ? l.campaign_name ?? 'Sem campanha informada' : by === 'formulario' ? l.form_name ?? l.form_id ?? '—' : by === 'anuncio' ? l.ad_name ?? 'Sem anúncio informado' : (l.platform && PLATFORM_LABEL[l.platform]) || 'Não informado';
      const r = m.get(key) ?? { total: 0, contacted: 0, replied: 0, advanced: 0, clients: 0 };
      r.total++;
      if (l.enrolled_at) r.contacted++;
      if (l.lead_id && d.replied.has(l.lead_id)) r.replied++;
      if (l.lead_id && ADVANCED.has(d.stages[l.lead_id])) r.advanced++;
      if (l.lead_id && d.stages[l.lead_id] === 'cliente') r.clients++;
      m.set(key, r);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [d, by]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Agrupar por" className="inline-flex w-fit flex-wrap rounded-full bg-ink/[0.05] p-1">
        {(['campanha', 'formulario', 'anuncio', 'canal'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={by === x} onClick={() => setBy(x)} className={cx('rounded-full px-3.5 py-1.5 text-[13px] font-bold', by === x ? 'bg-white text-ink shadow-sm' : 'text-ink-soft')}>
            {x === 'campanha' ? 'Campanha' : x === 'formulario' ? 'Formulário' : x === 'anuncio' ? 'Anúncio' : 'Canal'}
          </button>
        ))}
      </div>
      {!d ? (
        <div className="card p-6"><Skeleton className="h-24 w-full" /></div>
      ) : !rows.length ? (
        <div className="card"><EmptyState title="Sem dados ainda">O relatório aparece quando os primeiros leads da Meta chegarem (últimos 90 dias).</EmptyState></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">{by === 'campanha' ? 'Campanha' : by === 'formulario' ? 'Formulário' : by === 'anuncio' ? 'Anúncio' : 'Canal'}</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                <th className="px-3 py-2.5 text-right font-semibold">Contatados</th>
                <th className="px-3 py-2.5 text-right font-semibold">Responderam</th>
                <th className="px-3 py-2.5 text-right font-semibold">Reunião+</th>
                <th className="px-4 py-2.5 text-right font-semibold">Clientes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(([k, r]) => (
                <tr key={k}>
                  <td className="max-w-[280px] truncate px-4 py-2.5 font-semibold" title={k}>{k}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.contacted}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.replied} <span className="text-ink-faint">({pct(r.replied, r.total)})</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.advanced}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.clients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-faint">Últimos 90 dias. Leads e origem vêm da Meta; respostas e estágios, do OxySDR. Custo por lead depende da leitura de gastos da conta de anúncios (próxima fase).</p>
    </div>
  );
}

// ---------- Configurações do Meta Leads ----------

export function MetaConfig({ ctx, isAdmin, ownerId }: { ctx: MetaCtx; isAdmin: boolean; ownerId: string }) {
  const { toast } = useApp();
  const st = ctx.status;
  const [busy, setBusy] = useState('');
  const [importing, setImporting] = useState<{ page: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const state = connectionState(st);
  const live = (st?.pages ?? []).filter((p) => p.status !== 'desconectado');

  const connect = async () => {
    setBusy('connect');
    try {
      const { url } = await metaLeadsApi.startConnect();
      // Dentro do Hub, a autorização da Meta abre na janela inteira (o Facebook não abre em quadro).
      (window.top ?? window).location.href = url;
    } catch (e) {
      toast((e as Error).message);
      setBusy('');
    }
  };
  const runImport = async (pageRef: string, name: string) => {
    const total = { novos: 0, existentes: 0, repetidos: 0, erros: 0, forms: 0 };
    setImporting({ page: pageRef, text: `Importando ${name}…` });
    try {
      for (let i = 0; i < 20; i++) {
        const r = await metaLeadsApi.importHistory(pageRef);
        total.novos += r.novos;
        total.existentes += r.existentes;
        total.repetidos += r.repetidos;
        total.erros += r.erros;
        total.forms = r.forms;
        setImporting({ page: pageRef, text: `${r.forms} formulários · ${total.novos} novos · ${total.existentes} já estavam no OxySDR${r.more ? ' · continuando…' : ''}` });
        if (!r.more) break;
      }
      toast(`Histórico importado: ${total.novos} leads novos, ${total.existentes} ligados a leads que já existiam${total.erros ? `, ${total.erros} com erro (veja o registro)` : ''}.`, total.erros ? undefined : 'success');
      await ctx.load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setImporting(null);
    }
  };
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      toast(msg, 'success');
      await ctx.load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const reqs: { done: boolean; label: string; hint: string }[] = [
    { done: !!st?.configured && !!st?.tokenKey, label: 'App da Meta configurado no servidor', hint: 'META_APP_ID, META_APP_SECRET e INSTAGRAM_TOKEN_KEY (os mesmos do Instagram Agent).' },
    { done: live.some((p) => p.status === 'conectado'), label: 'Página do Facebook conectada', hint: 'Pelo login oficial do Facebook, com uma conta que administra a Página e os anúncios.' },
    { done: !!st && live.length > 0 && !st.missingScopes.length, label: 'Permissões de leads liberadas', hint: 'leads_retrieval, pages_manage_ads, pages_manage_metadata, pages_show_list e pages_read_engagement. Para clientes fora da equipe do app, a Meta exige a Revisão do App (acesso avançado).' },
    { done: live.some((p) => p.subscribed), label: 'Página inscrita para avisar leads novos', hint: 'Feito automaticamente ao conectar (campo leadgen), sem tirar a inscrição do Direct.' },
    {
      done: !!st?.lastWebhookAt,
      label: 'Webhook “page → leadgen” no app da Meta',
      hint: `No app da Meta: Webhooks → Página → URL ${st?.webhookUrl ?? '(endereço da função instagram-webhook)'} com o mesmo token de verificação do Instagram, e assinar o campo leadgen. Fica verde quando o primeiro lead chegar por ele.`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">Conexão com a Meta</h2>
          <StateChip state={state} />
          {isAdmin && (
            <button className="btn btn-primary ml-auto" disabled={busy === 'connect' || !st?.configured} onClick={() => void connect()}>
              {busy === 'connect' ? <Spinner /> : <Facebook size={18} />} {live.length ? 'Conectar outra Página' : 'Conectar Página'}
            </button>
          )}
        </div>
        {!isAdmin && <p className="mt-1 text-[13px] text-ink-faint">Só o administrador da conta conecta Páginas e importa leads.</p>}
        <ol className="mt-4 flex flex-col gap-2">
          {reqs.map((r) => (
            <li key={r.label} className="flex items-start gap-2.5 text-[14px]">
              {r.done ? <Check size={18} className="mt-0.5 shrink-0 text-good" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />}
              <span>
                <b className="font-semibold">{r.label}</b>
                <span className="block break-words text-[13px] text-ink-faint">{r.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {live.length > 0 && (
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Páginas conectadas</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {live.map((p) => (
              <li key={p.id} className="rounded-[14px] bg-ink/[0.03] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold">{p.page_name ?? p.page_id}</span>
                  {p.instagram_username && <span className="text-[13px] text-ink-faint">@{p.instagram_username}</span>}
                  <StateChip state={p.status === 'erro' ? 'aguardando_autorizacao' : p.subscribed ? 'operacional' : 'aguardando_integracao'} />
                </div>
                <div className="mt-1 text-[13px] text-ink-faint">
                  {p.last_sync_at ? `Última sincronização: ${formatDateTime(p.last_sync_at)}` : 'Ainda não sincronizou.'} {p.subscribed ? '· Recebe leads novos automaticamente' : '· Sem recebimento automático'}
                </div>
                {p.last_error && <p className="mt-1 text-[13px] text-bad">Último erro: {p.last_error}</p>}
                {importing?.page === p.id && <p className="mt-1 flex items-center gap-2 text-[13px]"><Spinner /> {importing.text}</p>}
                {isAdmin && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn btn-outline" disabled={!!importing || !!busy} onClick={() => void runImport(p.id, p.page_name ?? 'Página')}>
                      <Download size={16} /> Importar histórico
                    </button>
                    {!p.subscribed && (
                      <button className="btn btn-ghost" disabled={!!busy} onClick={() => void act(`sub-${p.id}`, () => metaLeadsApi.resubscribe(p.id), 'Página inscrita para receber leads novos.')}>
                        <RefreshCw size={16} /> Inscrever de novo
                      </button>
                    )}
                    <button className="btn btn-ghost text-bad" disabled={!!busy} onClick={() => setConfirm(p.id)}>
                      <Unplug size={16} /> Desconectar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-ink-faint">A Meta guarda os leads de formulário por 90 dias na API. A importação pode ser repetida: o que já foi importado é pulado. Leads antigos não recebem mensagem automática.</p>
        </section>
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">Beelie nos leads novos</h2>
          <Sparkles size={16} className="text-accent" />
        </div>
        <label className="mt-2 flex items-center gap-2 text-[14px] font-semibold">
          <input
            type="checkbox"
            checked={ctx.data?.autoFirstContact ?? true}
            disabled={!isAdmin || !!busy || !ctx.data}
            onChange={(e) => void act('auto', () => metaLeadsApi.setAutoFirstContact(ownerId, e.target.checked), e.target.checked ? 'Primeiro contato automático ligado.' : 'Primeiro contato automático desligado.')}
          />
          Fazer o primeiro contato pelo WhatsApp assim que o lead chegar
        </label>
        <p className="mt-1 text-[13px] text-ink-faint">
          Respeita a janela de envio, os limites diários do WhatsApp e a lista de opt-out. A mensagem usa as respostas do formulário. Lead que já está em outra cadência, já é cliente ou não deixou contato não recebe.
        </p>
      </section>

      {ctx.data && ctx.data.logs.length > 0 && (
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Registro de sincronização</h2>
          <ul className="mt-2 flex flex-col gap-1 text-[13px]">
            {ctx.data.logs.slice(0, 15).map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-ink-faint">{formatDateTime(l.created_at)}</span>
                <span className={cx('font-semibold', l.status === 'erro' ? 'text-bad' : l.status === 'ok' ? 'text-good' : 'text-ink-soft')}>{LOG_LABEL[l.action] ?? l.action}</span>
                {l.detail?.erro != null && <span className="break-words text-ink-soft">{String(l.detail.erro)}</span>}
                {l.detail?.pagina != null && <span className="text-ink-faint">· {String(l.detail.pagina)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          title="Desconectar a Página?"
          confirmLabel="Desconectar"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm;
            void act(`dc-${id}`, () => metaLeadsApi.disconnect(id), 'Página desconectada.');
          }}
        >
          O acesso guardado é apagado e os leads novos param de chegar. Os leads já recebidos continuam no OxySDR.
        </ConfirmDialog>
      )}
    </div>
  );
}

const LOG_LABEL: Record<string, string> = {
  webhook_lead: 'Lead recebido',
  importacao: 'Importação do histórico',
  pagina_inscrita: 'Inscrição da Página',
  pagina_desconectada: 'Página desconectada',
  conexao_falhou: 'Conexão falhou',
  conexao_sem_pagina: 'Conexão sem Página',
  conexao_recusada: 'Conexão recusada',
};
