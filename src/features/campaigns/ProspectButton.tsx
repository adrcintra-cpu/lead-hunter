import { useState } from 'react';
import { Send } from 'lucide-react';
import { useApp, useService } from '@/store/AppStore';
import { Spinner, cx } from '@/components/ui';
import { AddToCampaign } from './AddToCampaign';

const when = (iso: string | null) => {
  if (!iso) return 'já começa a enviar';
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 864e5);
  const hm = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const day = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (day === tomorrow.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })) return `começa amanhã às ${hm}`;
  if (day === today.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })) return `começa hoje às ${hm}`;
  return `começa em ${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' })} às ${hm}`;
};

/**
 * Um clique para prospectar: os leads entram na campanha padrão e o BEELIE escreve e envia sozinho,
 * no horário de envio. "Escolher campanha" fica como opção para quem quer separar por campanha.
 */
export function ProspectButton({ leadIds, onDone, label }: { leadIds: string[]; onDone?: () => void; label?: string }) {
  const service = useService();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await service.automation.prospect(leadIds);
      const out = r.skipped.length ? ` ${r.skipped.length} ${r.skipped.length === 1 ? 'ficou' : 'ficaram'} de fora (${[...new Set(r.skipped.map((x) => x.reason))].join(', ')}).` : '';
      if (!r.added) toast(`Nenhum lead novo para prospectar.${out}`, 'info');
      else {
        if (service.automation.runsLocally) void service.automation.tick();
        const n = `${r.added} ${r.added === 1 ? 'lead' : 'leads'}`;
        toast(
          r.paused
            ? `${n} na prospecção, mas a campanha “${r.campaign.name}” está pausada: retome para começar.${out}`
            : `${n} na prospecção. O BEELIE escreve e envia sozinho: ${when(r.startsAt)}.${out}`,
          'success',
        );
        onDone?.();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível prospectar.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary min-h-[38px]" disabled={busy || !leadIds.length} onClick={() => void go()}>
        {busy ? <Spinner /> : <Send className="h-4 w-4" />} {label ?? `Prospectar (${leadIds.length})`}
      </button>
      {pick ? (
        <AddToCampaign leadIds={leadIds} onDone={onDone} />
      ) : (
        <button type="button" className={cx('btn-ghost min-h-[38px] text-[13px]')} onClick={() => setPick(true)}>
          ou escolher campanha
        </button>
      )}
    </div>
  );
}
