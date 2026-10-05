import { useMemo, useState, type FormEvent } from 'react';
import { Check, CheckCircle2, Circle, ExternalLink, ListChecks, Plus } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import type { Task } from '@/core/types';
import { formatDateTime, relativeTime } from '@/core/utils';
import { EmptyState, PageHeader, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { SendConnectedButton } from '@/features/leads/SendConnectedButton';

const SOURCE_LABEL: Record<Task['source'], string> = { manual: 'Manual', cadencia: 'Cadência', resposta: 'Resposta do lead' };

export function TaskItem({ t, showLead = true }: { t: Task; showLead?: boolean }) {
  const db = useDb();
  const service = useService();
  const drawer = useLeadDrawer();
  const lead = t.leadId ? db.leads.find((l) => l.id === t.leadId) : undefined;
  const company = lead && db.companies.find((c) => c.id === lead.companyId);
  const overdue = t.status === 'aberta' && t.dueAt && new Date(t.dueAt) < service.now();
  // Tarefa de WhatsApp da cadência: a mensagem preparada correspondente (para registrar abertura e envio).
  const waMessage =
    t.actionUrl?.startsWith('https://wa.me/') && t.leadId
      ? db.messages
          .filter((m) => m.leadId === t.leadId && m.channel === 'whatsapp' && (m.status === 'draft' || m.status === 'opened_whatsapp') && (!t.campaignId || m.campaignId === t.campaignId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <button
        type="button"
        aria-label={t.status === 'aberta' ? 'Concluir tarefa' : 'Reabrir tarefa'}
        onClick={() => service.automation.completeTask(t.id, t.status === 'aberta')}
        className={cx('mt-0.5 shrink-0', t.status === 'aberta' ? 'text-ink-faint hover:text-accent' : 'text-good')}
      >
        {t.status === 'aberta' ? <Circle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm font-bold', t.status === 'concluida' && 'text-ink-faint line-through')}>{t.title}</div>
        {t.description && <p className="mt-0.5 text-[13px] text-ink-soft">{t.description}</p>}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span>{SOURCE_LABEL[t.source]}</span>
          {t.ownerName && <span>Para {t.ownerName}</span>}
          {t.dueAt && <span className={cx(overdue && 'font-bold text-bad')}>Prazo {formatDateTime(t.dueAt)}</span>}
          <span>Criada {relativeTime(t.createdAt)}</span>
          {showLead && company && (
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => drawer.open(lead!.id)}>
              {company.tradeName ?? company.legalName}
            </button>
          )}
        </div>
      </div>
      {t.actionUrl && t.status === 'aberta' && (
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          {waMessage && <SendConnectedButton messageId={waMessage.id} small />}
          <a
            href={t.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary min-h-[34px] px-3 text-xs"
            onClick={() => waMessage && service.markWhatsappOpened(waMessage.id)}
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir WhatsApp
          </a>
          {waMessage && (
            <button type="button" className="btn-outline min-h-[34px] px-3 text-xs" onClick={() => service.markSent(waMessage.id)}>
              <Check className="h-3.5 w-3.5" /> Marcar como enviado
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function TasksPage() {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const [filter, setFilter] = useState<'whatsapp' | 'aberta' | 'concluida'>('aberta');
  const [title, setTitle] = useState('');
  // Fila de WhatsApp: tarefas abertas com link wa.me, melhores leads (maior score) primeiro.
  const isWa = (t: Task) => t.status === 'aberta' && !!t.actionUrl?.startsWith('https://wa.me/');
  const scoreOf = (t: Task) => db.leads.find((l) => l.id === t.leadId)?.currentScore ?? 0;
  const tasks = useMemo(
    () =>
      filter === 'whatsapp'
        ? db.tasks.filter(isWa).sort((a, b) => scoreOf(b) - scoreOf(a))
        : db.tasks
            .filter((t) => t.status === filter)
            .sort((a, b) => (a.dueAt ?? a.createdAt).localeCompare(b.dueAt ?? b.createdAt) * (filter === 'aberta' ? 1 : -1)),
    [db.tasks, db.leads, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const open = db.tasks.filter((t) => t.status === 'aberta').length;
  const waCount = db.tasks.filter(isWa).length;

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    service.automation.createTask({ title: title.trim(), source: 'manual', ownerName: db.profile?.fullName || undefined });
    setTitle('');
    toast('Tarefa criada.', 'success');
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <PageHeader title="Tarefas" subtitle="Atendimento humano: respostas para tratar, WhatsApp para enviar manualmente e ações das cadências." />
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor="new-task" className="sr-only">Nova tarefa</label>
        <input id="new-task" className="input" placeholder="Nova tarefa" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" className="btn-dark shrink-0" disabled={!title.trim()}><Plus className="h-4 w-4" /> Criar</button>
      </form>
      <div role="tablist" className="inline-flex w-fit rounded-lg border border-line bg-subtle p-0.5">
        {(['whatsapp', 'aberta', 'concluida'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            type="button"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cx('min-h-[34px] rounded-md px-3 text-sm font-semibold', filter === f ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint')}
          >
            {f === 'whatsapp' ? `WhatsApp de hoje (${waCount})` : f === 'aberta' ? `Abertas (${open})` : 'Concluídas'}
          </button>
        ))}
      </div>
      {filter === 'whatsapp' && (
        <p className="-mt-2 text-[13px] text-ink-faint">
          Mensagens prontas, dos melhores leads para os demais. Para cada uma: <b>Abrir WhatsApp</b> → enviar → <b>Marcar como enviado</b>. O limite diário de cada campanha controla quantas entram na fila por dia.
        </p>
      )}
      <div className="card">
        {tasks.length === 0 ? (
          <EmptyState icon={<ListChecks className="h-8 w-8" />} title={filter === 'whatsapp' ? 'Nenhum WhatsApp na fila' : filter === 'aberta' ? 'Nenhuma tarefa aberta' : 'Nenhuma tarefa concluída'}>
            As cadências criam tarefas quando um lead responde ou quando o WhatsApp precisa ser enviado manualmente.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">{tasks.map((t) => <TaskItem key={t.id} t={t} />)}</ul>
        )}
      </div>
    </div>
  );
}
