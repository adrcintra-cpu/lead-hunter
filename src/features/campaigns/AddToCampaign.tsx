import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { Spinner, cx } from '@/components/ui';

const STATUS: Record<string, string> = { rascunho: 'rascunho', ativa: 'ativa', pausada: 'pausada', agendada: 'agendada' };

/** Escolher uma campanha e colocar nela os leads selecionados (lista de leads ou perfil do lead). */
export function AddToCampaign({ leadIds, onDone, compact = false }: { leadIds: string[]; onDone?: () => void; compact?: boolean }) {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState('');
  const camps = db.campaigns.filter((c) => c.status !== 'finalizada');

  async function add() {
    const camp = db.campaigns.find((c) => c.id === target);
    if (!camp) return;
    setBusy('Adicionando…');
    try {
      const r = await service.automation.addLeadsToCampaign(target, leadIds, (d, t) => setBusy(`Preparando ${d} de ${t}…`));
      const skipped = r.skipped.length
        ? ` ${r.skipped.length} ${r.skipped.length === 1 ? 'ficou' : 'ficaram'} de fora (${[...new Set(r.skipped.map((x) => x.reason))].join(', ')}).`
        : '';
      if (!r.added) toast(`Nenhum lead adicionado.${skipped}`, 'info');
      else if (r.pendingReview) {
        toast(`${r.added} ${r.added === 1 ? 'lead preparado' : 'leads preparados'} em “${camp.name}”. Revise as mensagens e ative a campanha.${skipped}`, 'success');
        navigate(`/campanhas/${camp.id}`);
      } else {
        if (service.automation.runsLocally) void service.automation.tick();
        toast(`${r.added} ${r.added === 1 ? 'lead adicionado' : 'leads adicionados'} a “${camp.name}”. Os envios respeitam o horário da campanha.${skipped}`, 'success');
      }
      if (r.added) onDone?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível adicionar.', 'error');
    } finally {
      setBusy('');
    }
  }

  if (!camps.length) {
    return (
      <Link to="/campanhas" className={cx('text-accent underline', compact ? 'text-[13px]' : 'text-sm')}>
        Criar uma campanha
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Campanha de destino" className="input min-h-[36px] w-auto py-1 text-sm" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!busy}>
        <option value="">Escolha uma campanha</option>
        {camps.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({STATUS[c.status] ?? c.status})
          </option>
        ))}
      </select>
      <button type="button" className="btn-primary min-h-[36px]" disabled={!target || !!busy} onClick={() => void add()}>
        {busy ? <Spinner /> : <Megaphone className="h-4 w-4" />} {busy || 'Adicionar à campanha'}
      </button>
    </div>
  );
}
