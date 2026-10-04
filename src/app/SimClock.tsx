import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { Spinner } from '@/components/ui';

/** Modo de teste: relógio simulado para ver uma cadência de vários dias acontecer em segundos. */
export function SimClock() {
  const service = useService();
  const db = useDb();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!service.automation.runsLocally) return null;
  const active = db.enrollments.filter((e) => e.status === 'ativa').length;
  const now = service.now();
  const offsetDays = Math.round((db.clockOffsetMs ?? 0) / 864e5);

  async function advance(days: number) {
    setBusy(true);
    try {
      const before = db.messages.filter((m) => m.sentAt).length;
      await service.automation.advanceClock(days * 864e5);
      const after = service.db.messages.filter((m) => m.sentAt).length;
      toast(`Relógio avançou ${days} ${days === 1 ? 'dia' : 'dias'}. ${after - before} mensagens enviadas (simulado).`, 'success');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-xs font-bold">
        <Clock className="h-3.5 w-3.5" /> Relógio de teste
      </div>
      <div className="mt-1 text-xs text-ink-faint">
        {now.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        {offsetDays > 0 && ` (+${offsetDays}d)`} · {active} em cadência
      </div>
      <div className="mt-2 flex gap-1">
        <button type="button" className="btn-outline min-h-[30px] flex-1 px-2 text-xs" disabled={busy} onClick={() => advance(1)}>
          {busy ? <Spinner className="h-3 w-3" /> : '+1 dia'}
        </button>
        <button type="button" className="btn-outline min-h-[30px] flex-1 px-2 text-xs" disabled={busy} onClick={() => advance(7)}>+7 dias</button>
        {offsetDays > 0 && (
          <button type="button" className="btn-ghost min-h-[30px] px-2 text-xs" disabled={busy} onClick={() => service.automation.resetClock()} title="Voltar ao horário real">
            Hoje
          </button>
        )}
      </div>
    </div>
  );
}
