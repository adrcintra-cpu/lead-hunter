import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDb } from '@/store/AppStore';
import { useLeadRows } from '@/store/selectors';
import { EmptyState, PageHeader } from '@/components/ui';
import { LeadsTable } from '@/features/leads/LeadsPage';

export function ListDetailPage() {
  const { listId } = useParams();
  const db = useDb();
  const rows = useLeadRows();
  const list = db.lists.find((l) => l.id === listId);
  const members = useMemo(() => {
    const ids = new Set(db.listMembers.filter((m) => m.listId === listId).map((m) => m.leadId));
    return rows.filter((r) => ids.has(r.lead.id));
  }, [db.listMembers, rows, listId]);

  if (!list) return <EmptyState title="Lista não encontrada" action={<Link to="/listas" className="btn-outline">Ver listas</Link>} />;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <Link to="/listas" className="btn-ghost -ml-3 w-fit">
        <ArrowLeft className="h-4 w-4" /> Listas
      </Link>
      <PageHeader title={list.name} subtitle={list.description} />
      <LeadsTable rows={members} emptyText="Adicione leads pela tabela de Leads ou pelo perfil de cada lead." />
    </div>
  );
}
