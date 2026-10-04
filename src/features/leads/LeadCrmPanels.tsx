import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, Mail, MessageCircle, Pause, Play, ShieldCheck, Square, UserRound } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import type { LeadRow } from '@/store/selectors';
import { MESSAGE_STATUS_LABEL, REPLY_LABEL, type ActivityType, type Message } from '@/core/types';
import { describeStep } from '../../../supabase/functions/_shared/automation/planner.ts';
import { ENROLLMENT_STATUS_LABEL } from '@/services/automation/automationService';
import { formatDateTime } from '@/core/utils';
import { cx, Spinner } from '@/components/ui';
import { TaskItem } from '@/features/tasks/TasksPage';

/** Dados de CRM: contato, cargo, e-mail, tags, responsável, próxima ação e opt-in de WhatsApp. */
export function CrmPanel({ row }: { row: LeadRow }) {
  const { lead } = row;
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
  });
  const [f, setF] = useState(init);
  const [consent, setConsent] = useState('');
  useEffect(() => setF(init()), [lead.id, lead.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());

  function save(e: FormEvent) {
    e.preventDefault();
    if (!emailOk) return;
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
      <h3 className="mb-2 text-sm font-extrabold">Contato e CRM</h3>
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
              <label htmlFor="consent" className="label">Sem opt-in de WhatsApp: a automação só cria tarefas para envio manual</label>
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
        <h3 className="mb-1 text-sm font-extrabold">Campanha e cadência</h3>
        <p className="text-[13px] text-ink-faint">
          Este lead não está em nenhuma campanha. <Link to="/campanhas" className="text-accent underline">Ver campanhas</Link>
        </p>
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

/** Mensagens enviadas (com status de entrega) e respostas recebidas, em ordem. */
export function ConversationPanel({ row }: { row: LeadRow }) {
  const { lead, company } = row;
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const [sim, setSim] = useState('');
  const [simChannel, setSimChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => {
    const out = db.messages
      .filter((m) => m.leadId === lead.id && m.campaignId)
      .map((m) => ({ kind: 'out' as const, at: m.sentAt ?? m.createdAt, m }));
    const ins = db.inbound.filter((r) => r.leadId === lead.id).map((r) => ({ kind: 'in' as const, at: r.receivedAt, r }));
    return [...out, ...ins].sort((a, b) => a.at.localeCompare(b.at));
  }, [db.messages, db.inbound, lead.id]);

  async function simulate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await service.automation.receiveReply(lead.id, simChannel, sim);
      toast(`Resposta classificada como “${REPLY_LABEL[r.classification!]}”.`, 'success');
      setSim('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao registrar a resposta.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-extrabold">Mensagens e respostas</h3>
      {items.length === 0 && <p className="text-[13px] text-ink-faint">Nenhuma mensagem automática enviada ainda.</p>}
      <ul className="flex flex-col gap-2">
        {items.map((it) =>
          it.kind === 'out' ? (
            <li key={it.m.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-bold">
                  {it.m.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                  {it.m.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · {formatDateTime(it.at)}
                </span>
                <span className={cx('rounded px-1.5 py-0.5 font-bold', STATUS_TONE[it.m.status] ?? 'bg-muted')}>
                  {it.m.status === 'draft' ? 'Aguardando envio manual' : MESSAGE_STATUS_LABEL[it.m.status]}
                </span>
              </div>
              {it.m.subject && <div className="mt-1.5 text-[13px] font-semibold">{it.m.subject}</div>}
              <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{it.m.finalContent}</p>
              <div className="mt-1.5 text-[11px] text-ink-faint">
                {it.m.template}
                {it.m.context?.length ? ` · contexto: ${it.m.context.map((c) => c.label).join(', ')}` : ''}
                {it.m.failureReason && <span className="text-bad"> · {it.m.failureReason}</span>}
              </div>
            </li>
          ) : (
            <li key={it.r.id} className="ml-6 rounded-lg border border-accent/40 bg-accent-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-bold text-accent-strong">
                  <UserRound className="h-3.5 w-3.5" /> Resposta · {formatDateTime(it.at)}
                </span>
                {it.r.classification && (
                  <span className="flex items-center gap-1 rounded bg-ai-soft px-1.5 py-0.5 font-bold text-ai">
                    <Bot className="h-3 w-3" /> {REPLY_LABEL[it.r.classification]}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-[13px]">{it.r.body}</p>
            </li>
          ),
        )}
      </ul>
      {service.automation.runsLocally && (
        <form onSubmit={simulate} className="mt-3 rounded-lg border border-dashed border-line-strong p-3">
          <label htmlFor="sim" className="label">Modo de teste: simular uma resposta deste lead</label>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Canal da resposta" className="input w-auto" value={simChannel} onChange={(e) => setSimChannel(e.target.value as 'whatsapp' | 'email')}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
            <input id="sim" className="input min-w-[200px] flex-1" value={sim} placeholder="Ex.: Tenho interesse, pode me mandar valores?" onChange={(e) => setSim(e.target.value)} />
            <button type="submit" className="btn-outline" disabled={busy || !sim.trim() || (simChannel === 'whatsapp' && !company.whatsapp)}>
              {busy && <Spinner />} Simular
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">No modo real, as respostas chegam pelos webhooks do WhatsApp e do e-mail.</p>
        </form>
      )}
    </section>
  );
}

export function LeadTasks({ leadId }: { leadId: string }) {
  const db = useDb();
  const tasks = db.tasks.filter((t) => t.leadId === leadId).sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'aberta' ? -1 : 1));
  if (!tasks.length) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold">
        <CheckCircle2 className="h-4 w-4" /> Tarefas
      </h3>
      <ul className="-mx-5 divide-y divide-line">{tasks.map((t) => <TaskItem key={t.id} t={t} showLead={false} />)}</ul>
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
      <h3 className="mb-1 text-sm font-extrabold">Linha do tempo</h3>
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
