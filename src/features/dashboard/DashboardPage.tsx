import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Database, Megaphone, Plus, Sparkles } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { useLeadRows } from '@/store/selectors';
import { CLOSED_STAGES, stageLabel } from '@/core/types';
import { formatDateTime, relativeTime } from '@/core/utils';
import { EmptyState, PageHeader, ScoreBadge, Spinner, cx } from '@/components/ui';
import { dataMode } from '@/lib/supabase';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { TaskItem } from '@/features/tasks/TasksPage';
import { StatusChip } from '@/features/campaigns/CampaignsPage';

function Kpi({ label, value, note, accent }: { label: string; value: string | number; note?: string; accent?: boolean }) {
  return (
    <div className="card px-4 py-4">
      <div className="text-[12.5px] font-semibold text-ink-faint">{label}</div>
      <div className={cx('mt-1.5 font-mono text-3xl font-semibold tabular-nums', accent && 'text-accent')}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

export function DashboardPage() {
  const db = useDb();
  const rows = useLeadRows();
  const service = useService();
  const auto = service.automation;
  const { toast } = useApp();
  const navigate = useNavigate();
  const drawer = useLeadDrawer();
  const [loadingDemo, setLoadingDemo] = useState('');
  const [insights, setInsights] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);

  const m = useMemo(() => auto.campaignMetrics(), [auto, db.messages, db.inbound, db.enrollments]); // eslint-disable-line react-hooks/exhaustive-deps
  const temp = useMemo(
    () => ({
      hot: db.leads.filter((l) => l.scoreTier === 'alta').length,
      warm: db.leads.filter((l) => l.scoreTier === 'media').length,
      cold: db.leads.filter((l) => l.scoreTier === 'baixa').length,
    }),
    [db.leads],
  );
  const openTasks = db.tasks.filter((t) => t.status === 'aberta').sort((a, b) => (a.dueAt ?? a.createdAt).localeCompare(b.dueAt ?? b.createdAt));
  const latest = useMemo(() => [...rows].sort((a, b) => b.lead.discoveredAt.localeCompare(a.lead.discoveredAt)).slice(0, 5), [rows]);
  const activity = db.activities.filter((a) => a.type !== 'cadence_step').slice(0, 8);
  const liveCampaigns = db.campaigns.filter((c) => c.status === 'ativa' || c.status === 'agendada' || c.status === 'pausada');
  // Follow-ups: próximo contato agendado nos leads ainda em prospecção.
  const followUps = useMemo(() => {
    const now = service.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 864e5);
    const due = db.leads
      .filter((l) => l.nextActionAt && !CLOSED_STAGES.includes(l.stage) && new Date(l.nextActionAt) < end)
      .sort((a, b) => a.nextActionAt!.localeCompare(b.nextActionAt!));
    const weekAgo = now.getTime() - 7 * 864e5;
    return {
      due,
      overdue: due.filter((l) => new Date(l.nextActionAt!) < start).length,
      today: due.filter((l) => new Date(l.nextActionAt!) >= start).length,
      start,
      contacts7d: db.messages.filter((m) => m.sentAt && new Date(m.sentAt).getTime() >= weekAgo).length,
    };
  }, [db.leads, db.messages, service, db.clockOffsetMs]); // eslint-disable-line react-hooks/exhaustive-deps
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

  async function readResults() {
    setThinking(true);
    try {
      setInsights(await service.ai.summarizeResults(auto.resultsSnapshot()));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível gerar a leitura.', 'error');
    } finally {
      setThinking(false);
    }
  }

  const today = service.now().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const total = Math.max(1, db.leads.length);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <PageHeader
        title="Visão geral da prospecção"
        subtitle={<span className="capitalize">{today}</span>}
        actions={
          <>
            <Link to="/campanhas" className="btn-outline"><Megaphone className="h-4 w-4" /> Campanhas</Link>
            <Link to="/buscar" className="btn-primary"><Plus className="h-4 w-4" /> Nova busca</Link>
          </>
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
                ? 'Descreva o perfil de empresa que você procura, ou carregue uma demonstração com buscas, contatos e uma campanha pronta para testar.'
                : 'Descreva o perfil de empresa que você procura. A busca usa o Google Places.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Leads" value={db.leads.length} note={`${db.leads.filter((l) => l.stage === 'cliente').length} viraram clientes`} />
            <Kpi label="Em cadência" value={db.enrollments.filter((e) => e.status === 'ativa').length} note={`${liveCampaigns.length} campanhas em andamento`} />
            <Kpi label="Mensagens enviadas" value={m.sent} note={`${m.delivered} entregues · ${m.failed} falhas`} />
            <Kpi label="Respostas" value={m.replies} note={`taxa de ${m.replyRate}%`} accent />
            <Kpi label="Interessados" value={m.interested} note={`${m.meetings} pediram reunião`} accent />
            <Kpi label="Tarefas abertas" value={openTasks.length} note="atendimento humano" />
            <Kpi label="Opt-out" value={m.optOuts} note="pediram para não receber" />
            <div className="card px-4 py-4">
              <div className="text-[12.5px] font-semibold text-ink-faint">Temperatura dos leads</div>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="bg-good" style={{ width: `${(temp.hot / total) * 100}%` }} />
                <div className="bg-warn" style={{ width: `${(temp.warm / total) * 100}%` }} />
                <div className="bg-ink-faint/50" style={{ width: `${(temp.cold / total) * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="font-semibold text-good">{temp.hot} quentes</span>
                <span className="font-semibold text-warn">{temp.warm} mornos</span>
                <span className="text-ink-faint">{temp.cold} frios</span>
              </div>
            </div>
          </div>

          <section className="card px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[15px] font-bold"><Bot className="h-4 w-4 text-ai" /> Leitura inteligente dos resultados</h2>
              <button type="button" className="btn-outline" onClick={readResults} disabled={thinking}>
                {thinking ? <Spinner /> : <Sparkles className="h-4 w-4" />} {insights ? 'Atualizar leitura' : 'Gerar leitura'}
              </button>
            </div>
            {insights ? (
              <ul className="mt-3 flex flex-col gap-1.5 text-[14px] leading-relaxed">
                {insights.map((t, i) => <li key={i} className="border-l-2 border-ai pl-3">{t}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-ink-faint">A IA lê os números das campanhas (envios, respostas, segmentos e canais) e aponta o que está funcionando. Ela usa só os números reais.</p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <section className="card">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                  <h2 className="text-[15px] font-bold">Follow-ups</h2>
                  <span className="text-[12.5px] font-semibold">
                    <span className={cx(followUps.overdue > 0 ? 'text-bad' : 'text-ink-faint')}>{followUps.overdue} atrasados</span>
                    <span className="text-ink-faint"> · </span>
                    <span className="text-accent">{followUps.today} para hoje</span>
                  </span>
                </div>
                <p className="px-5 text-xs text-ink-faint">{followUps.contacts7d} {followUps.contacts7d === 1 ? 'contato realizado' : 'contatos realizados'} nos últimos 7 dias</p>
                {followUps.due.length ? (
                  <ul className="mt-1 divide-y divide-line">
                    {followUps.due.slice(0, 6).map((l) => {
                      const late = new Date(l.nextActionAt!) < followUps.start;
                      return (
                        <li key={l.id}>
                          <button type="button" onClick={() => drawer.open(l.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-left hover:bg-subtle">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold">{nameOf(l.id)}</span>
                              <span className="block truncate text-[12.5px] text-ink-faint">{l.nextAction || 'Follow-up'} · {stageLabel(l.stage)}</span>
                            </span>
                            <span className={cx('text-xs font-semibold', late ? 'text-bad' : 'text-ink-soft')}>{late ? 'Atrasado · ' : ''}{formatDateTime(l.nextActionAt!)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-5 pb-4 pt-1 text-[13px] text-ink-faint">Nenhum follow-up para hoje. Agende o próximo contato no perfil do lead, depois de marcar a mensagem como enviada.</p>
                )}
              </section>
              <section className="card">
                <div className="flex items-center justify-between px-5 pt-4">
                  <h2 className="text-[15px] font-bold">Tarefas abertas</h2>
                  <Link to="/tarefas" className="text-sm font-bold text-accent hover:underline">Ver todas</Link>
                </div>
                {openTasks.length ? (
                  <ul className="mt-1 divide-y divide-line">{openTasks.slice(0, 5).map((t) => <TaskItem key={t.id} t={t} />)}</ul>
                ) : (
                  <p className="px-5 pb-4 pt-1 text-[13px] text-ink-faint">Nenhuma tarefa aberta. Quando um lead responder, a tarefa aparece aqui.</p>
                )}
              </section>
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
            </div>

            <div className="flex flex-col gap-4">
              {liveCampaigns.length > 0 && (
                <section className="card px-5 py-4">
                  <h2 className="text-[15px] font-bold">Campanhas em andamento</h2>
                  <ul className="mt-1">
                    {liveCampaigns.map((c) => {
                      const cm = auto.campaignMetrics(c.id);
                      return (
                        <li key={c.id} className="border-t border-line py-2.5 first:border-t-0">
                          <Link to={`/campanhas/${c.id}`} className="flex items-center justify-between gap-2 hover:text-accent">
                            <span className="truncate text-[13.5px] font-semibold">{c.name}</span>
                            <StatusChip status={c.status} />
                          </Link>
                          <div className="text-xs text-ink-faint">{cm.sent} enviadas · {cm.replies} respostas · {cm.interested} interessados</div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
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
        </>
      )}
    </div>
  );
}
