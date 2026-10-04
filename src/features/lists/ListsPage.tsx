import { useState } from 'react';
import { Link } from 'react-router-dom';
import { List, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import type { LeadList } from '@/core/types';
import { relativeTime } from '@/core/utils';
import { ConfirmDialog, EmptyState, Modal, PageHeader } from '@/components/ui';

export function ListFormModal({ initial, onClose }: { initial?: LeadList; onClose: () => void }) {
  const service = useService();
  const { toast } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  function save() {
    if (initial) service.renameList(initial.id, name, desc);
    else service.createList(name, desc);
    toast(initial ? 'Lista atualizada.' : `Lista “${name.trim()}” criada.`, 'success');
    onClose();
  }
  return (
    <Modal
      title={initial ? 'Editar lista' : 'Nova lista'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!name.trim()} onClick={save}>Salvar</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="l-name" className="label">Nome</label>
          <input id="l-name" autoFocus className="input" value={name} placeholder="Ex.: Agro Campinas" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="l-desc" className="label">Descrição (opcional)</label>
          <input id="l-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export function ListsPage() {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const [editing, setEditing] = useState<LeadList | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LeadList | null>(null);
  const count = (id: string) => db.listMembers.filter((m) => m.listId === id).length;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Listas"
        subtitle="Agrupe leads como quiser. Um lead pode estar em várias listas."
        actions={
          <button type="button" className="btn-dark" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Nova lista
          </button>
        }
      />
      {db.lists.length === 0 ? (
        <div className="card">
          <EmptyState icon={<List className="h-8 w-8" />} title="Nenhuma lista ainda" action={<button type="button" className="btn-primary" onClick={() => setEditing('new')}>Criar lista</button>}>
            Exemplos: Agro Campinas, Indústrias Limeira, Clínicas Piracicaba, Prospects Outubro.
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {db.lists.map((l) => (
            <div key={l.id} className="card flex flex-col px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/listas/${l.id}`} className="text-base font-extrabold hover:text-accent">{l.name}</Link>
                <span className="shrink-0 font-mono text-[13px] text-ink-soft">{count(l.id)} leads</span>
              </div>
              {l.description && <p className="mt-1 text-[13px] text-ink-faint">{l.description}</p>}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-ink-faint">Atualizada {relativeTime(l.updatedAt)}</span>
                <div className="flex gap-1">
                  <button type="button" className="btn-ghost min-h-[34px] px-2" aria-label={`Editar ${l.name}`} onClick={() => setEditing(l)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost min-h-[34px] px-2 hover:text-bad"
                    aria-label={`Excluir ${l.name}`}
                    onClick={() => setDeleting(l)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir esta lista?"
          confirmLabel="Excluir"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            service.deleteList(deleting.id);
            toast(`Lista “${deleting.name}” excluída.`);
          }}
        >
          A lista “{deleting.name}” será excluída. Os leads continuam no sistema.
        </ConfirmDialog>
      )}
      {editing && <ListFormModal initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
