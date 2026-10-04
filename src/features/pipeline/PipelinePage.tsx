import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useApp, useService } from '@/store/AppStore';
import { useLeadRows, type LeadRow } from '@/store/selectors';
import { STAGES, stageLabel, type LeadStage } from '@/core/types';
import { PageHeader, ScoreBadge, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';

export function PipelinePage() {
  const rows = useLeadRows();
  const service = useService();
  const { toast } = useApp();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const columns = useMemo(
    () =>
      STAGES.map((s) => ({
        ...s,
        rows: rows.filter((r) => r.lead.stage === s.id).sort((a, b) => b.lead.currentScore - a.lead.currentScore),
      })),
    [rows],
  );
  const active = rows.find((r) => r.lead.id === activeId) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const to = e.over?.id as LeadStage | undefined;
    const row = rows.find((r) => r.lead.id === e.active.id);
    if (!to || !row || row.lead.stage === to) return;
    service.changeStage(row.lead.id, to);
    toast(`${row.company.tradeName ?? row.company.legalName} → ${stageLabel(to)}. Alteração registrada no histórico.`, 'success');
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pipeline" subtitle="Arraste os cards entre as etapas. Toda mudança fica registrada no histórico do lead." />
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-10 md:px-10">
          <div className="grid auto-cols-[248px] grid-flow-col gap-3">
            {columns.map((col) => (
              <Column key={col.id} id={col.id} label={col.label} rows={col.rows} />
            ))}
          </div>
        </div>
        <DragOverlay>{active ? <Card row={active} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ id, label, rows }: { id: LeadStage; label: string; rows: LeadRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cx('flex min-h-[460px] flex-col gap-2 rounded-xl bg-muted/70 p-2.5 transition-colors', isOver && 'bg-accent-soft ring-2 ring-accent/50')}
    >
      <div className="flex items-center justify-between px-1 pb-1 pt-0.5">
        <h2 className="text-[13px] font-extrabold">{label}</h2>
        <span className="font-mono text-xs text-ink-soft">{rows.length}</span>
      </div>
      {rows.map((r) => (
        <DraggableCard key={r.lead.id} row={r} />
      ))}
      {rows.length === 0 && <div className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-faint">Solte aqui</div>}
    </section>
  );
}

function DraggableCard({ row }: { row: LeadRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.lead.id });
  return (
    <div ref={setNodeRef} className={cx(isDragging && 'opacity-30')}>
      <Card row={row} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function Card({ row, overlay, handleProps }: { row: LeadRow; overlay?: boolean; handleProps?: Record<string, unknown> }) {
  const drawer = useLeadDrawer();
  const service = useService();
  const { lead, company: c } = row;
  return (
    <div className={cx('rounded-lg border border-line bg-surface p-2.5', overlay && 'rotate-1 shadow-pop')}>
      <div className="flex items-start gap-1.5">
        <button type="button" {...handleProps} aria-label={`Mover ${c.tradeName ?? c.legalName}`} className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-ink-faint hover:bg-muted active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => drawer.open(lead.id)} className="block w-full truncate text-left text-[13.5px] font-bold hover:text-accent">
            {c.tradeName ?? c.legalName}
          </button>
          <div className="truncate text-xs text-ink-faint">{c.city}/{c.state} · {c.segment}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ScoreBadge score={lead.currentScore} tier={lead.scoreTier} />
        {!overlay && (
          <>
            <label htmlFor={`st-${lead.id}`} className="sr-only">Mover para etapa</label>
            <select
              id={`st-${lead.id}`}
              value={lead.stage}
              onChange={(e) => service.changeStage(lead.id, e.target.value as LeadStage)}
              className="max-w-[124px] rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-soft"
            >
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
