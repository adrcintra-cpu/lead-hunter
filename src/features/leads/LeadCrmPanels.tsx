import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarClock, Check, CheckCircle2, ExternalLink, Mail, MessageCircle, Pause, Play, ShieldCheck, Square, UserRound } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import type { LeadRow } from '@/store/selectors';
import { MESSAGE_STATUS_LABEL, REPLY_CATEGORY_LABEL, REPLY_LABEL, type ActivityType, type Channel, type InboundMessage, type Message, type ReplyCategory } from '@/core/types';
import { describeStep } from '../../../supabase/functions/_shared/automation/planner.ts';
import { ENROLLMENT_STATUS_LABEL } from '@/services/automation/automationService';
import { formatDateTime } from '@/core/utils';
import { cx, Spinner } from '@/components/ui';
import { ProspectButton } from '../campaigns/ProspectButton';
import { PanelTitle } from './Fold';
import { TaskItem } from '@/features/tasks/TasksPage';

/** Dados de CRM: contato, cargo, e-mail, tags, responsável, próxima ação e opt-in de WhatsApp. */
export function CrmPanel({ row }: { row: LeadRow }) {
  const { lead, company } = row;
  const service = useService();
  const { toast } = useApp();
  const init = () => ({
    contactName: lead.contactName ?? '',
    contactRole: lead.contactRole ?? '',
    email: lead.email ?? '',
    tags: (lead.tags ?? []).join(', '),
    ownerName: lead.ownerName ?? '',
    nextAction: lead.nextAction ?? '',
    nextActionAt: lead.nextActionAt ? lead.nextActionAt.slice(0, 16) : '',
    whatsapp: company.whatsapp ?? '',
    phone: company.phone ?? '',
  });
  const [f, setF] = useState(init);
  const [consent, setConsent] = useState('');
  useEffect(() => setF(init()), [lead.id, lead.updatedAt, company.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());

  function save(e: FormEvent) {
    e.preventDefault();
    if (!emailOk) return;
    try {
      service.updateCompanyContact(lead.id, { whatsapp: f.whatsapp, phone: f.phone });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Telefone inválido.', 'error');
      return;
    }
    service.updateLead(lead.id, {
      contactName: f.contactName,
      contactRole: f.contactRole,
      email: f.email.toLowerCase(),
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      ownerName: f.ownerName,
      nextAction: f.nextAction,
      nextActionAt: f.nextActionAt ? new Date(f.nextActionAt).toISOString() : undefined,
    });
    service.rescore(lead.id);
    toast('Dados do lead salvos.', 'success');
  }

  return (
    <section>
      <PanelTitle className="mb-2">Contato e CRM</PanelTitle>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="crm-name" className="label">Nome do contato</label>
          <input id="crm-name" className="input" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-role" className="label">Cargo</label>
          <input id="crm-role" className="input" value={f.contactRole} placeholder="Ex.: Gerente de compras" onChange={(e) => set('contactRole', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-email" className="label">E-mail</label>
          <input id="crm-email" type="email" className={cx('input', !emailOk && 'border-bad')} value={f.email} onChange={(e) => set('email', e.target.value)} />
          {!emailOk && <p className="mt-1 text-xs text-bad">E-mail inválido.</p>}
        </div>
        <div>
          <label htmlFor="crm-wa" className="label">WhatsApp</label>
          <input id="crm-wa" className="input" inputMode="tel" value={f.whatsapp} placeholder="(19) 99999-9999" onChange={(e) => set('whatsapp', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-phone" className="label">Telefone</label>
          <input id="crm-phone" className="input" inputMode="tel" value={f.phone} placeholder="(19) 3333-3333" onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-owner" className="label">Responsável</label>
          <input id="crm-owner" className="input" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="crm-tags" className="label">Tags (separadas por vírgula)</label>
          <input id="crm-tags" className="input" value={f.tags} placeholder="Ex.: prioridade, feira" onChange={(e) => set('tags', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-next" className="label">Próxima ação</label>
          <input id="crm-next" className="input" value={f.nextAction} placeholder="Ex.: Ligar para apresentar proposta" onChange={(e) => set('nextAction', e.target.value)} />
        </div>
        <div>
          <label htmlFor="crm-next-at" className="label">Quando</label>
          <input id="crm-next-at" type="datetime-local" className="input" value={f.nextActionAt} onChange={(e) => set('nextActionAt', e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          <span className="text-xs text-ink-faint">
            Criado em {formatDateTime(lead.createdAt)}
            {lead.lastContactAt && ` · último contato ${formatDateTime(lead.lastContactAt)}`}
          </span>
          <button type="submit" className="btn-outline">Salvar dados</button>
        </div>
      </form>

      <div className={cx('mt-3 rounded-lg border px-3 py-2.5 text-[13px]', lead.whatsappConsentAt ? 'border-good/40 bg-good-soft' : 'border-line')}>
        {lead.whatsappConsentAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-good">
              <ShieldCheck className="h-4 w-4" /> Opt-in de WhatsApp: {lead.whatsappConsentSource} · {formatDateTime(lead.whatsappConsentAt)}
            </span>
            <button type="button" className="btn-ghost min-h-[30px] px-2 text-xs" onClick={() => service.setWhatsappConsent(lead.id, null)}>Remover</button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!consent.trim()) return;
              service.setWhatsappConsent(lead.id, consent);
              setConsent('');
            }}
          >
            <div className="min-w-[200px] flex-1">
              <label htmlFor="consent" className="label">Consentimento para WhatsApp (LGPD): como o contato autorizou? O envio é sempre manual, pelo wa.me</label>
              <input id="consent" className="input" value={consent} placeholder="Como o contato autorizou? Ex.: formulário do site" onChange={(e) => setConsent(e.target.value)} />
            </div>
            <button type="submit" className="btn-outline" disabled={!consent.trim()}>Registrar opt-in</button>
          </form>
        )}
      </div>
    </section>
  );
}

/** Campanha e cadência atuais, com pausar/retomar/encerrar. */
export function CadencePanel({ leadId }: { leadId: string }) {
  const db = useDb();
  const service = useService();
  const enrollments = db.enrollments.filter((e) => e.leadId === leadId);
  const current = enrollments.find((e) => e.status === 'ativa' || e.status === 'pausada' || e.status === 'pendente') ?? enrollments[0];
  if (!current) {
    return (
      <section>
        <PanelTitle className="mb-1">Campanha e cadência</PanelTitle>
        <p className="mb-2 text-[13px] text-ink-faint">Este lead não está em nenhuma campanha.</p>
        <ProspectButton leadIds={[leadId]} label="Prospectar este lead" />
      </section>
    );
  }
  const camp = db.campaigns.find((c) => c.id === current.campaignId);
  const cad = db.cadences.find((c) => c.id === current.cadenceId);
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold">Campanha: {camp ? <Link to={`/campanhas/${camp.id}`} className="hover:text-accent">{camp.name}</Link> : '—'}</h3>
          <p className="text-[13px] text-ink-faint">
            {cad?.name} · <span className="font-semibold">{ENROLLMENT_STATUS_LABEL[current.status]}</span>
            {current.stopReason && (current.status === 'pausada' || current.status === 'interrompida') && ` · ${current.stopReason}`}
          </p>
        </div>
        <div className="flex gap-1">
          {current.status === 'ativa' && (
            <button type="button" className="btn-outline min-h-[34px] px-2.5 text-xs" onClick={() => service.automation.setEnrollment(current, 'pausada', 'pausada manualmente')}>
              <Pause className="h-3.5 w-3.5" /> Pausar
            </button>
          )}
          {current.status === 'pausada' && (
            <button type="button" className="btn-primary min-h-[34px] px-2.5 text-xs" onClick={() => service.automation.setEnrollment(current, 'ativa')}>
              <Play className="h-3.5 w-3.5" /> Retomar
            </button>
          )}
          {(current.status === 'ativa' || current.status === 'pausada') && (
            <button type="button" className="btn-ghost min-h-[34px] px-2.5 text-xs text-bad" onClick={() => service.automation.setEnrollment(current, 'interrompida', 'encerrada manualmente')}>
              <Square className="h-3.5 w-3.5" /> Encerrar
            </button>
          )}
        </div>
      </div>
      {cad && (
        <ol className="mt-3 flex flex-col gap-1">
          {cad.steps.map((s, i) => {
            const done = i < current.stepIndex;
            const now = i === current.stepIndex && current.status === 'ativa';
            return (
              <li key={s.id} className={cx('flex items-center gap-2 text-[13px]', done ? 'text-ink-faint' : now ? 'font-bold' : '')}>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]', done ? 'bg-good-soft text-good' : now ? 'bg-inverse text-inverse-ink' : 'bg-muted text-ink-soft')}>
                  {done ? '✓' : i + 1}
                </span>
                {describeStep(s)}
                {now && current.nextRunAt && <span className="font-normal text-ink-faint">· {formatDateTime(current.nextRunAt)}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const STATUS_TONE: Partial<Record<Message['status'], string>> = {
  sent: 'bg-muted text-ink-soft',
  delivered: 'bg-ai-soft text-ai',
  read: 'bg-good-soft text-good',
  replied: 'bg-good-soft text-good',
  failed: 'bg-bad-soft text-bad',
  draft: 'bg-warn-soft text-warn',
};

const FOLLOW_UP_DAYS = [1, 3, 5, 7, 14, 30];

/** Próximo contato: 1, 3, 5, 7, 14, 30 dias ou data personalizada. Usa a "próxima ação" do lead. */
export function FollowUpPicker({ leadId, channel }: { leadId: string; channel?: Channel }) {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const lead = db.leads.find((l) => l.id === leadId);
  const [custom, setCustom] = useState('');
  if (!lead) return null;
  const schedule = (d: Date) => {
    service.scheduleFollowUp(leadId, d, channel);
    toast(`Próximo contato agendado para ${d.toLocaleDateString('pt-BR')}.`, 'success');
  };
  const inDays = (n: number) => {
    const d = new Date(service.now().getTime() + n * 864e5);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  return (
    <div className="mt-3 rounded-lg border border-line bg-subtle p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold">
        <CalendarClock className="h-4 w-4" /> Próximo contato
        {lead.nextActionAt && <span className="font-normal text-ink-faint">· agendado para {formatDateTime(lead.nextActionAt)}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {FOLLOW_UP_DAYS.map((n) => (
          <button key={n} type="button" className="btn-outline min-h-[32px] px-2.5 text-xs" onClick={() => schedule(inDays(n))}>
            {n === 1 ? '1 dia' : `${n} dias`}
          </button>
        ))}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom) schedule(new Date(`${custom}T09:00:00`));
            setCustom('');
          }}
        >
          <label htmlFor={`fu-${leadId}`} className="sr-only">Data personalizada</label>
          <input id={`fu-${leadId}`} type="date" className="input min-h-[32px] w-auto py-0 text-xs" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button type="submit" className="btn-outline min-h-[32px] px-2.5 text-xs" disabled={!custom}>Agendar</button>
        </form>
      </div>
    </div>
  );
}

const SHOW_MANUAL: Message['status'][] = ['opened_whatsapp', 'sent', 'delivered', 'read', 'replied', 'failed'];

/** Mensagens (automáticas e enviadas à mão) e respostas recebidas, em ordem. */
export function ConversationPanel({ row }: { row: LeadRow }) {
  const { lead, company } = row;
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const [reply, setReply] = useState('');
  const [replyChannel, setReplyChannel] = useState<'whatsapp' | 'email'>(company.whatsapp ? 'whatsapp' : 'email');
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => {
    const out = db.messages
      .filter((m) => m.leadId === lead.id && (m.campaignId || SHOW_MANUAL.includes(m.status)))
      .map((m) => ({ kind: 'out' as const, at: m.sentAt ?? m.updatedAt ?? m.createdAt, m }));
    const ins = db.inbound.filter((r) => r.leadId === lead.id).map((r) => ({ kind: 'in' as const, at: r.receivedAt, r }));
    return [...out, ...ins].sort((a, b) => a.at.localeCompare(b.at));
  }, [db.messages, db.inbound, lead.id]);
  // Categoria detalhada e próxima ação ficam no histórico (reply_classified).
  const analysis = useMemo(() => {
    const map = new Map<string, { category?: ReplyCategory; suggestedAction?: string }>();
    for (const a of db.activities) {
      if (a.leadId === lead.id && a.type === 'reply_classified' && typeof a.payload.inboundId === 'string') {
        map.set(a.payload.inboundId, { category: a.payload.category as ReplyCategory | undefined, suggestedAction: a.payload.suggestedAction as string | undefined });
      }
    }
    return map;
  }, [db.activities, lead.id]);
  const categoryOf = (r: InboundMessage) => {
    const c = analysis.get(r.id)?.category;
    return c ? REPLY_CATEGORY_LABEL[c] : r.classification ? REPLY_LABEL[r.classification] : undefined;
  };

  async function register(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await service.automation.receiveReply(lead.id, replyChannel, reply);
      toast(`Resposta analisada: “${categoryOf(r) ?? 'registrada'}”.`, 'success');
      setReply('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao registrar a resposta.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = (m: Message) =>
    m.status === 'draft' ? 'Aguardando envio manual' : m.status === 'sent' && m.provider === 'manual' ? 'Enviado manualmente' : MESSAGE_STATUS_LABEL[m.status];

  return (
    <section>
      <PanelTitle className="mb-2">Mensagens e respostas</PanelTitle>
      {items.length === 0 && <p className="text-[13px] text-ink-faint">Nenhuma mensagem enviada ainda.</p>}
      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          if (it.kind === 'out') {
            const m = it.m;
            const pending = m.channel === 'whatsapp' && (m.status === 'draft' || m.status === 'opened_whatsapp');
            const link = pending ? service.whatsapp.linkFor(m.id) : null;
            return (
              <li key={m.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 font-bold">
                    {m.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                    {m.channel === 'whatsapp' ? 'WhatsApp' : m.channel === 'email' ? 'E-mail' : 'LinkedIn'} · {formatDateTime(it.at)}
                  </span>
                  <span className={cx('rounded px-1.5 py-0.5 font-bold', STATUS_TONE[m.status] ?? 'bg-muted')}>{statusLabel(m)}</span>
                </div>
                {m.subject && <div className="mt-1.5 text-[13px] font-semibold">{m.subject}</div>}
                <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{m.finalContent}</p>
                <div className="mt-1.5 text-[11px] text-ink-faint">
                  {m.template}
                  {m.context?.length ? ` · contexto: ${m.context.map((c) => c.label).join(', ')}` : ''}
                  {m.failureReason && <span className="text-bad"> · {m.failureReason}</span>}
                </div>
                {pending && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {link && (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="btn-outline min-h-[32px] px-2.5 text-xs" onClick={() => service.markWhatsappOpened(m.id)}>
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir WhatsApp
                      </a>
                    )}
                    <button type="button" className="btn-primary min-h-[32px] px-2.5 text-xs" onClick={() => { service.markSent(m.id); toast('Marcado como enviado.', 'success'); }}>
                      <Check className="h-3.5 w-3.5" /> Marcar como enviado
                    </button>
                  </div>
                )}
              </li>
            );
          }
          const r = it.r;
          const extra = analysis.get(r.id);
          return (
            <li key={r.id} className="ml-6 rounded-lg border border-accent/40 bg-accent-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-bold text-accent-strong">
                  <UserRound className="h-3.5 w-3.5" /> Resposta · {r.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · {formatDateTime(it.at)}
                </span>
                {categoryOf(r) && (
                  <span className="flex items-center gap-1 rounded bg-ai-soft px-1.5 py-0.5 font-bold text-ai">
                    <Bot className="h-3 w-3" /> {categoryOf(r)}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-[13px]">{r.body}</p>
              {(r.summary || extra?.suggestedAction) && (
                <dl className="mt-2 grid gap-1 border-t border-accent/30 pt-2 text-[12.5px]">
                  {r.summary && (
                    <div><dt className="inline font-bold">Resumo: </dt><dd className="inline text-ink-soft">{r.summary}</dd></div>
                  )}
                  {extra?.suggestedAction && (
                    <div><dt className="inline font-bold">Próxima ação sugerida: </dt><dd className="inline text-ink-soft">{extra.suggestedAction}</dd></div>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      <form onSubmit={register} className="mt-3 rounded-lg border border-dashed border-line-strong p-3">
        <div className="text-[13px] font-bold">Registrar resposta</div>
        <p className="mt-0.5 text-xs text-ink-faint">Cole aqui o que o lead respondeu no WhatsApp ou no e-mail. A IA classifica, resume e sugere a próxima ação.</p>
        <label htmlFor={`reply-${lead.id}`} className="label mt-2">Resposta recebida</label>
        <textarea
          id={`reply-${lead.id}`}
          rows={3}
          className="input min-h-[72px] resize-y py-2"
          value={reply}
          placeholder="Ex.: Tenho interesse, pode me mandar um orçamento?"
          onChange={(e) => setReply(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <select aria-label="Canal da resposta" className="input w-auto" value={replyChannel} onChange={(e) => setReplyChannel(e.target.value as 'whatsapp' | 'email')}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
          </select>
          <button type="submit" className="btn-primary" disabled={busy || !reply.trim()}>
            {busy ? <Spinner /> : <Bot className="h-4 w-4" />} Analisar com IA
          </button>
        </div>
      </form>
    </section>
  );
}

export function LeadTasks({ leadId }: { leadId: string }) {
  const db = useDb();
  const tasks = db.tasks.filter((t) => t.leadId === leadId).sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'aberta' ? -1 : 1));
  if (!tasks.length) return null;
  return (
    <section>
      <PanelTitle className="mb-1 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" /> Tarefas
      </PanelTitle>
      <ul className="-mx-4 divide-y divide-line">{tasks.map((t) => <TaskItem key={t.id} t={t} showLead={false} />)}</ul>
    </section>
  );
}

const DOT: Partial<Record<ActivityType, string>> = {
  message_sent: 'bg-accent',
  reply_received: 'bg-good',
  reply_classified: 'bg-ai',
  cadence_paused: 'bg-warn',
  cadence_stopped: 'bg-bad',
  message_failed: 'bg-bad',
  task_created: 'bg-warn',
  stage_changed: 'bg-ink-soft',
};

/** Linha do tempo cronológica de tudo que aconteceu com o lead. */
export function Timeline({ leadId }: { leadId: string }) {
  const db = useDb();
  const items = db.activities.filter((a) => a.leadId === leadId && a.type !== 'cadence_step').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(-15);
  return (
    <section>
      <PanelTitle className="mb-1">Linha do tempo</PanelTitle>
      {items.length > shown.length && (
        <button type="button" className="mb-1 text-xs font-semibold text-accent hover:underline" onClick={() => setAll(true)}>
          Mostrar {items.length - shown.length} eventos anteriores
        </button>
      )}
      <ol className="relative ml-1 border-l border-line">
        {shown.map((a) => (
          <li key={a.id} className="relative py-1.5 pl-4 text-[13px]">
            <span className={cx('absolute -left-[4.5px] top-[11px] h-2 w-2 rounded-full', DOT[a.type] ?? 'bg-line-strong')} />
            <span className="mr-2 font-mono text-xs text-ink-faint">{formatDateTime(a.createdAt)}</span>
            {a.description}
          </li>
        ))}
      </ol>
    </section>
  );
}
