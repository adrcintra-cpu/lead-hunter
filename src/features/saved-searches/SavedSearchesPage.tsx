import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Play, Trash2 } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import type { SavedSearch, SearchCriteria } from '@/core/types';
import { relativeTime } from '@/core/utils';
import { ConfirmDialog, EmptyState, PageHeader } from '@/components/ui';

export function describeCriteria(c: SearchCriteria): string {
  const wa = { obrigatorio: 'WhatsApp obrigatório', preferencial: 'WhatsApp preferencial', indiferente: '' }[c.whatsapp];
  return [
    c.segment || 'Qualquer segmento',
    c.regionLabel || 'Qualquer região',
    c.radiusKm ? `${c.radiusKm} km` : '',
    c.requireWebsite === 'sim' ? 'com site' : '',
    wa,
    c.minEmployees ? `${c.minEmployees}+ funcionários` : '',
    `até ${c.quantity}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function SavedSearchesPage() {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  const lastRunText = (savedId: string, lastRunAt?: string) => {
    if (!lastRunAt) return 'Nunca executada';
    const last = db.searches.find((x) => x.savedSearchId === savedId && x.status === 'done');
    const news = last ? ` · ${last.newCount} ${last.newCount === 1 ? 'empresa nova' : 'empresas novas'}` : '';
    return `Última execução ${relativeTime(lastRunAt)}${news}`;
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader title="Buscas" subtitle="Critérios salvos para rodar de novo. No MVP a execução é sempre manual." />
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold">Salvas</h2>
        {db.savedSearches.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Bookmark className="h-8 w-8" />} title="Nenhuma busca salva">
              Na revisão de critérios de uma busca, use “Salvar busca”.
            </EmptyState>
          </div>
        ) : (
          db.savedSearches.map((s) => (
            <div key={s.id} className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="text-base font-extrabold">{s.name}</div>
                <div className="mt-1 text-[13px] text-ink-soft">{describeCriteria(s.criteria)}</div>
                <div className="mt-1.5 text-xs text-ink-faint">{lastRunText(s.id, s.lastRunAt)}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-outline" onClick={() => navigate(`/buscar?q=${encodeURIComponent(s.rawQuery)}&saved=${s.id}`)}>
                  <Play className="h-4 w-4" /> Executar novamente
                </button>
                <button
                  type="button"
                  className="btn-ghost px-2 hover:text-bad"
                  aria-label={`Excluir ${s.name}`}
                  onClick={() => setDeleting(s)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold">Histórico de buscas</h2>
        {db.searches.length === 0 ? (
          <p className="text-sm text-ink-faint">Nenhuma busca executada ainda.</p>
        ) : (
          <div className="card divide-y divide-line">
            {db.searches.map((s) => (
              <button key={s.id} type="button" onClick={() => navigate(`/buscar?search=${s.id}`)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-subtle">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{s.rawQuery}</span>
                  <span className="block text-xs text-ink-faint">{s.confirmedCriteria ? describeCriteria(s.confirmedCriteria) : ''}</span>
                </span>
                <span className="text-xs text-ink-faint">
                  {s.status === 'error' ? 'Erro' : s.status === 'running' ? 'Buscando…' : `${s.resultCount} resultados · ${s.newCount} novos`} · {relativeTime(s.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Excluir esta busca salva?"
          confirmLabel="Excluir"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            service.deleteSavedSearch(deleting.id);
            toast(`Busca “${deleting.name}” excluída.`);
          }}
        >
          A busca salva “{deleting.name}” será excluída. Os leads que ela encontrou continuam no sistema.
        </ConfirmDialog>
      )}
    </div>
  );
}
