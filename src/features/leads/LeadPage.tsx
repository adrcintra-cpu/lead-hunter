import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLeadRow } from '@/store/selectors';
import { EmptyState } from '@/components/ui';
import { LeadProfile } from './LeadDrawer';

/** Página dedicada do lead (/leads/:leadId), útil para links diretos. */
export function LeadPage() {
  const { leadId } = useParams();
  const row = useLeadRow(leadId ?? null);
  return (
    <div className="mx-auto max-w-[760px]">
      <Link to="/leads" className="btn-ghost -ml-3 mb-3">
        <ArrowLeft className="h-4 w-4" /> Voltar para Leads
      </Link>
      <div className="card overflow-hidden">
        {row ? <LeadProfile row={row} standalone /> : <EmptyState title="Lead não encontrado" />}
      </div>
    </div>
  );
}
