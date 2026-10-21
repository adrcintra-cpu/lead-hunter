import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Mail, MessageCircle, Search, Send } from 'lucide-react';
import { useDb, useService } from '@/store/AppStore';
import type { Message } from '@/core/types';
import { formatDateTime, relativeTime } from '@/core/utils';
import { EmptyState, PageHeader, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';

type Channel = 'email' | 'whatsapp';
type Stage = 'fila' | 'enviado' | 'entregue' | 'aberto' | 'respondeu' | 'falhou';
type Period = 7 | 30 | 0;

const STAGE: Record<Stage, { label: string; tone: string }> = {
  fila: { label: 'Na fila', tone: 'bg-warn-soft text-warn' },
  enviado: { label: 'Enviado', tone: 'bg-muted text-ink-soft' },
  entregue: { label: 'Entregue', tone: 'bg-ai-soft text-ai' },
  aberto: { label: 'Aberto', tone: 'bg-good-soft text-good' },
  respondeu: { label: 'Respondeu', tone: 'bg-good text-white' },
  falhou: { label: 'Não entregue', tone: 'bg-bad-soft text-bad' },
};
const FILTERS: (Stage | 'todos')[] = ['todos', 'enviado', 'entregue', 'aberto', 'respondeu', 'falhou'];

interface Row {
  m: Message;
  stage: Stage;
  replyAt?: string;
  replySummary?: string;
  company: string;
  leadId: string;
}

/** Falha antiga que já foi reenviada (a etapa foi reaberta): não conta mais como falha. */
const superseded = (m: Message) => m.status === 'failed' && (m.failureReason ?? '').startsWith('reenvio:');

/** Envios do BEELIE (e-mail e WhatsApp) e como cada um evoluiu: enviado → entregue → aberto → respondeu. */
export function MessagesPage() {
  const db = useDb();
  const service = useService();
  const drawer = useLeadDrawer();
  const [channel, setChannel] = useState<Channel>('email');
  const [filter, setFilter] = useState<Stage | 'todos'>('todos');
  const [period, setPeriod] = useState<Period>(30);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const since = period ? service.now().getTime() - period * 864e5 : 0;
    const companyOf = new Map(db.companies.map((c) => [c.id, c.tradeName ?? c.legalName]));
    const leadCompany = new Map(db.leads.map((l) => [l.id, companyOf.get(l.companyId) ?? 'Lead']));
    const replies = new Map<string, { at: string; summary?: string }[]>();
    for (const r of db.inbound) {
      if (r.channel !== channel || r.classification === 'ausente') continue;
      const list = replies.get(r.leadId) ?? [];
      list.push({ at: r.receivedAt, summary: r.summary || r.body });
      replies.set(r.leadId, list);
    }
    const out: Row[] = [];
    for (const m of db.messages) {
      if (m.channel !== channel || superseded(m)) continue;
      if (!['queued', 'sent', 'delivered', 'read', 'replied', 'failed'].includes(m.status)) continue;
      const at = m.sentAt ?? m.failedAt ?? m.createdAt;
      if (since && new Date(at).getTime() < since) continue;
      const reply = m.sentAt ? (replies.get(m.leadId) ?? []).filter((r) => r.at > m.sentAt!).sort((a, b) => a.at.localeCompare(b.at))[0] : undefined;
      const stage: Stage =
        m.status === 'failed' ? 'falhou'
        : reply || m.status === 'replied' ? 'respondeu'
        : m.status === 'queued' ? 'fila'
        : m.readAt || m.status === 'read' ? 'aberto'
        : m.deliveredAt || m.status === 'delivered' ? 'entregue'
        : 'enviado';
      out.push({ m, stage, replyAt: reply?.at ?? m.repliedAt, replySummary: reply?.summary, company: leadCompany.get(m.leadId) ?? 'Lead', leadId: m.leadId });
    }
    return out.sort((a, b) => (b.m.sentAt ?? b.m.createdAt).localeCompare(a.m.sentAt ?? a.m.createdAt));
  }, [db.messages, db.inbound, db.leads, db.companies, channel, period, service]);

  // Funil: quem chegou em cada etapa (um aberto também foi entregue e enviado).
  const reached = (r: Row, s: Stage) => {
    if (s === 'falhou') return r.stage === 'falhou';
    const order: Stage[] = ['enviado', 'entregue', 'aberto', 'respondeu'];
    if (r.stage === 'falhou' || r.stage === 'fila') return false;
    return order.indexOf(r.stage) >= order.indexOf(s);
  };
  const count = (s: Stage | 'todos') => (s === 'todos' ? rows.length : rows.filter((r) => reached(r, s)).length);
  const sent = count('enviado');
  const tracking = channel !== 'email' || rows.some((r) => r.m.deliveredAt || r.m.readAt);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'todos' || reached(r, filter)) &&
      (!needle || [r.company, r.m.recipient, r.m.subject, r.m.finalContent].some((x) => (x ?? '').toLowerCase().includes(needle))),
  );

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <PageHeader
        title="Envios"
        subtitle="Tudo o que o BEELIE mandou e como cada mensagem evoluiu: enviado, entregue, aberto e respondido."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex w-fit rounded-lg border border-line bg-subtle p-0.5">
          {(['email', 'whatsapp'] as const).map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={channel === c}
              onClick={() => { setChannel(c); setFilter('todos'); }}
              className={cx('inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-3 text-sm font-semibold', channel === c ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint')}
            >
              {c === 'email' ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
              {c === 'email' ? 'E-mail' : 'WhatsApp'}
            </button>
          ))}
        </div>
        <label htmlFor="env-period" className="sr-only">Período</label>
        <select id="env-period" className="input min-h-[38px] w-auto" value={period} onChange={(e) => setPeriod(Number(e.target.value) as Period)}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={0}>Tudo</option>
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <label htmlFor="env-q" className="sr-only">Buscar</label>
          <input id="env-q" className="input pl-9" placeholder="Empresa, e-mail ou assunto" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {FILTERS.map((f) => {
          const n = count(f);
          const pct = f !== 'todos' && f !== 'falhou' && f !== 'enviado' && sent ? Math.round((n / sent) * 100) : null;
          const muted = channel === 'email' && !tracking && (f === 'entregue' || f === 'aberto');
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cx('rounded-xl border p-3 text-left transition-colors', filter === f ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-ink-faint')}
            >
              <div className="text-xs font-semibold text-ink-faint">{f === 'todos' ? 'Todos' : STAGE[f].label}</div>
              <div className={cx('mt-0.5 text-xl font-extrabold tabular-nums', f === 'falhou' && n ? 'text-bad' : muted && 'text-ink-faint')}>
                {muted ? '—' : n}
                {pct !== null && !muted && <span className="ml-1 text-xs font-semibold text-ink-faint">{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>

      {channel === 'email' && !tracking && rows.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-line bg-warn-soft px-4 py-3 text-[13px] text-ink-soft">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <p>
            <b>Entrega e abertura ainda não aparecem.</b> Falta ligar o aviso do Resend (webhook) para o Lead Hunter. Enquanto isso, você vê o que foi enviado, as falhas e as respostas.
          </p>
        </div>
      )}

      <div className="card">
        {shown.length === 0 ? (
          <EmptyState icon={<Send className="h-8 w-8" />} title="Nenhum envio aqui">
            {rows.length ? 'Nenhum envio com esse filtro.' : 'Quando o BEELIE mandar mensagens pelas campanhas, elas aparecem aqui.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {shown.slice(0, 300).map((r) => (
              <MessageRow key={r.m.id} r={r} open={openId === r.m.id} onToggle={() => setOpenId(openId === r.m.id ? null : r.m.id)} onOpenLead={() => drawer.open(r.leadId)} />
            ))}
          </ul>
        )}
        {shown.length > 300 && <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">Mostrando os 300 mais recentes. Use a busca ou o período para achar os demais.</p>}
      </div>
    </div>
  );
}

function MessageRow({ r, open, onToggle, onOpenLead }: { r: Row; open: boolean; onToggle: () => void; onOpenLead: () => void }) {
  const { m } = r;
  const title = m.channel === 'email' ? m.subject || '(sem assunto)' : m.finalContent.slice(0, 90);
  const steps: { label: string; at?: string; done: boolean; bad?: boolean }[] =
    r.stage === 'falhou'
      ? [
          { label: 'Tentativa de envio', at: m.sentAt ?? m.createdAt, done: true },
          { label: `Não entregue${m.failureReason ? `: ${m.failureReason}` : ''}`, at: m.failedAt, done: true, bad: true },
        ]
      : [
          { label: r.stage === 'fila' ? 'Na fila para envio' : 'Enviado', at: m.sentAt ?? (r.stage === 'fila' ? m.createdAt : undefined), done: r.stage !== 'fila' },
          { label: 'Entregue', at: m.deliveredAt, done: !!m.deliveredAt || ['entregue', 'aberto', 'respondeu'].includes(r.stage) },
          { label: m.channel === 'email' ? 'Aberto' : 'Lido', at: m.readAt, done: !!m.readAt || ['aberto'].includes(r.stage) },
          { label: 'Respondeu', at: r.replyAt, done: r.stage === 'respondeu' },
        ];
  return (
    <li className="px-5 py-3">
      <button type="button" className="group flex w-full items-start gap-3 text-left" aria-expanded={open} onClick={onToggle}>
        <span className={cx('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', STAGE[r.stage].tone)}>{STAGE[r.stage].label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold group-hover:text-accent">{title}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-faint">
            <span className="font-semibold text-ink-soft">{r.company}</span>
            {m.recipient && <span className="truncate">{m.recipient}</span>}
            <span>{relativeTime(m.sentAt ?? m.failedAt ?? m.createdAt)}</span>
          </span>
        </span>
        <ChevronDown className={cx('mt-0.5 h-4 w-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="mt-3 grid gap-4 pl-0 md:grid-cols-[220px_1fr] md:pl-1">
          <ol className="flex flex-col gap-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', s.bad ? 'bg-bad' : s.done ? 'bg-good' : 'bg-line')} aria-hidden />
                <span className={cx(!s.done && 'text-ink-faint')}>
                  <span className="font-semibold">{s.label}</span>
                  {s.at && <span className="block text-xs text-ink-faint">{formatDateTime(s.at)}</span>}
                </span>
              </li>
            ))}
            {r.replySummary && <li className="rounded-lg bg-good-soft px-3 py-2 text-xs text-ink-soft">“{r.replySummary.slice(0, 220)}”</li>}
          </ol>
          <div className="min-w-0">
            {m.channel === 'email' && (
              <div className="mb-2 text-xs text-ink-faint">
                {m.sender && <div>De: {m.sender}</div>}
                {m.recipient && <div>Para: {m.recipient}</div>}
                {m.subject && <div className="font-semibold text-ink-soft">Assunto: {m.subject}</div>}
              </div>
            )}
            <div className="max-h-[320px] overflow-auto whitespace-pre-line rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] leading-relaxed">{m.finalContent}</div>
            <button type="button" className="btn-outline mt-2 min-h-[32px] px-3 text-xs" onClick={onOpenLead}>Abrir o lead</button>
          </div>
        </div>
      )}
    </li>
  );
}
