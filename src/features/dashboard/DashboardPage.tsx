import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, Plus, Sparkles } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { useLeadRows } from '@/store/selectors';
import { stageLabel, STAGES, type LeadStage } from '@/core/types';
import { relativeTime } from '@/core/utils';
import { EmptyState, PageHeader, ScoreBadge, Spinner } from '@/components/ui';
import { dataMode } from '@/lib/supabase';
import { useLeadDrawer } from '@/app/useLeadDrawer';

const CONTACTED_PLUS = new Set<LeadStage>(STAGES.slice(STAGES.findIndex((s) => s.id === 'contatado')).map((s) => s.id).filter((s) => s !== 'descartado'));

export function DashboardPage() {
  const db = useDb();
  const rows = useLeadRows();
  const service = useService();
  const { toast } = useApp();
  const navigate = useNavigate();
  const drawer = useLeadDrawer();
  const [loadingDemo, setLoadingDemo] = useState('');

  const kpis = useMemo(() => {
    const leads = db.leads;
    return [
      { label: 'Leads encontrados', value: leads.length, note: `em ${db.searches.filter((s) => s.status === 'done').length} buscas` },
      { label: 'Qualificados', value: leads.filter((l) => l.stage !== 'novo' && l.stage !== 'descartado').length, note: 'além da etapa Novo' },
      { label: 'Novos', value: leads.filter((l) => l.stage === 'novo').length, note: 'aguardando análise' },
      { label: 'Contatados', value: leads.filter((l) => CONTACTED_PLUS.has(l.stage)).length, note: 'de Contatado em diante' },
      { label: 'Convertidos', value: leads.filter((l) => l.stage === 'cliente').length, note: 'viraram clientes', accent: true },
    ];
  }, [db.leads, db.searches]);

  const latest = useMemo(() => [...rows].sort((a, b) => b.lead.discoveredAt.localeCompare(a.lead.discoveredAt)).slice(0, 6), [rows]);
  const recentSearches = db.searches.slice(0, 4);
  const activity = db.activities.slice(0, 7);
  const nameOf = (leadId: string) => {
    const r = rows.find((x) => x.lead.id === leadId);
    return r ? r.company.tradeName ?? r.company.legalName : 'Lead';
  };

  async function loadDemo() {
    setLoadingDemo('Preparando…');
    try {
      await service.loadDemo((q) => setLoadingDemo(q));
      toast('Dados de demonstração carregados.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao carregar demonstração.', 'error');
    } finally {
      setLoadingDemo('');
    }
  }

  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <PageHeader
        title="Visão geral da prospecção"
        subtitle={<span className="capitalize">{today}</span>}
        actions={
          <Link to="/buscar" className="btn-primary">
            <Plus className="h-4 w-4" /> Nova busca
          </Link>
        }
      />

      <button
        type="button"
        onClick={() => navigate('/buscar')}
        className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line-strong bg-surface px-5 text-left text-base text-ink-faint transition-colors hover:border-accent"
      >
        <Sparkles className="h-5 w-5 text-accent" aria-hidden />
        Que tipo de empresa você está procurando?
      </button>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="card px-4 py-4">
            <div className="text-[12.5px] font-semibold text-ink-faint">{k.label}</div>
            <div className={`mt-1.5 font-mono text-3xl font-semibold ${k.accent ? 'text-accent' : ''}`}>{k.value}</div>
            <div className="mt-0.5 text-xs text-ink-faint">{k.note}</div>
          </div>
        ))}
      </div>

      {loadingDemo && db.leads.length > 0 && (
        <div className="card flex items-center gap-3 px-5 py-3 text-sm text-ink-soft" aria-live="polite">
          <Spinner /> Carregando demonstração — buscando: {loadingDemo}
        </div>
      )}

      {db.leads.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="Nenhum lead ainda"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/buscar" className="btn-primary">Fazer a primeira busca</Link>
                {dataMode === 'mock' && (
                  <button type="button" className="btn-outline" onClick={loadDemo} disabled={!!loadingDemo}>
                    {loadingDemo && <Spinner />}
                    Carregar demonstração
                  </button>
                )}
              </div>
            }
          >
            {loadingDemo
              ? `Buscando: ${loadingDemo}`
              : dataMode === 'mock'
                ? 'Descreva o perfil de empresa que você procura, ou carregue uma demonstração com 5 buscas prontas nos dados fictícios.'
                : 'Descreva o perfil de empresa que você procura. A busca usa o Google Places.'}
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="card px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold">Últimos leads encontrados</h2>
              <Link to="/leads" className="text-sm font-bold text-accent hover:underline">Ver todos</Link>
            </div>
            <ul className="mt-1">
              {latest.map(({ lead, company }) => (
                <li key={lead.id} className="border-t border-line first:border-t-0">
                  <button type="button" onClick={() => drawer.open(lead.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 text-left">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{company.tradeName ?? company.legalName}</span>
                      <span className="block text-[12.5px] text-ink-faint">{company.segment} · {company.city}/{company.state}</span>
                    </span>
                    <span className="hidden text-xs text-ink-faint sm:inline">{stageLabel(lead.stage)}</span>
                    <ScoreBadge score={lead.currentScore} tier={lead.scoreTier} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-4">
            <section className="card px-5 py-4">
              <h2 className="text-[15px] font-bold">Buscas recentes</h2>
              <ul className="mt-1">
                {recentSearches.map((s) => (
                  <li key={s.id} className="border-t border-line py-2.5 first:border-t-0">
                    <Link to={`/buscar?search=${s.id}`} className="block hover:text-accent">
                      <span className="block text-[13.5px] font-semibold">{s.rawQuery}</span>
                      <span className="block text-xs text-ink-faint">
                        {relativeTime(s.createdAt)} · {s.status === 'error' ? 'erro' : s.status === 'running' ? 'buscando…' : `${s.resultCount} empresas, ${s.newCount} novas`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card px-5 py-4">
              <h2 className="text-[15px] font-bold">Atividade recente</h2>
              <ul className="mt-1">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0">
                      <button type="button" onClick={() => drawer.open(a.leadId)} className="text-left text-[13.5px] hover:text-accent">
                        <span className="font-semibold">{nameOf(a.leadId)}</span> — {a.description}
                      </button>
                      <div className="text-xs text-ink-faint">{relativeTime(a.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
