import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Megaphone, Pause, Play, Plus, Sparkles, Square, Trash2 } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { STAGES, stageLabel, type Campaign, type CampaignAudience, type CampaignChannel, type Enrollment } from '@/core/types';
import { describeStep } from '../../../supabase/functions/_shared/automation/planner.ts';
import { CAMPAIGN_STATUS_LABEL, ENROLLMENT_STATUS_LABEL } from '@/services/automation/automationService';
import { formatDateTime } from '@/core/utils';
import { ConfirmDialog, EmptyState, PageHeader, Spinner, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { CampaignProgress } from './CampaignProgress';

const STATUS_TONE: Record<Campaign['status'], string> = {
  rascunho: 'bg-muted text-ink-soft',
  agendada: 'bg-ai-soft text-ai',
  ativa: 'bg-good-soft text-good',
  pausada: 'bg-warn-soft text-warn',
  finalizada: 'bg-muted text-ink-faint',
};

const CHANNEL_LABEL: Record<CampaignChannel, string> = { whatsapp: 'WhatsApp', email: 'E-mail', multicanal: 'WhatsApp + e-mail' };

export function StatusChip({ status }: { status: Campaign['status'] }) {
  return <span className={cx('rounded-md px-2 py-0.5 text-xs font-bold', STATUS_TONE[status])}>{CAMPAIGN_STATUS_LABEL[status]}</span>;
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-ink-faint">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-ink-faint">{hint}</div>}
    </div>
  );
}

export function CampaignsPage() {
  const db = useDb();
  const service = useService();
  const navigate = useNavigate();
  const { toast } = useApp();
  const auto = service.automation;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = db.campaigns.length > 0 && db.campaigns.every((c) => selected.has(c.id));

  async function deleteSelected() {
    setDeleting(true);
    try {
      const n = await auto.deleteCampaigns(Array.from(selected));
      setSelected(new Set());
      toast(n === 1 ? 'Campanha excluída.' : `${n} campanhas excluídas.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível excluir.', 'error');
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Campanhas"
        subtitle="Escolha o público e a cadência; revise as mensagens; ative ou agende."
        actions={
          <button
            type="button"
            className="btn-dark"
            disabled={!db.cadences.length}
            onClick={() => {
              const c = auto.createCampaign({
                name: 'Nova campanha',
                objective: '',
                audience: { segments: [], cities: [], minScore: 0, stages: ['novo', 'qualificado'], tags: [] },
                channel: 'multicanal',
                cadenceId: db.cadences[0].id,
                ownerName: db.profile?.fullName ?? '',
              });
              navigate(`/campanhas/${c.id}`);
            }}
          >
            <Plus className="h-4 w-4" /> Nova campanha
          </button>
        }
      />
      {db.campaigns.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Megaphone className="h-8 w-8" />} title="Nenhuma campanha ainda">
            Uma campanha junta um público (segmento, cidade, score, tags) e uma cadência de mensagens.
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 font-semibold text-ink-soft">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(db.campaigns.map((c) => c.id)))}
                className="h-4 w-4 accent-[rgb(var(--accent))]"
              />
              Selecionar todas
            </label>
            {selected.size > 0 && (
              <>
                <span className="font-semibold text-accent-strong">{selected.size} selecionada{selected.size > 1 ? 's' : ''}</span>
                <button type="button" className="btn-outline min-h-[36px] text-bad" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                  {deleting ? <Spinner /> : <Trash2 className="h-4 w-4" />} Excluir
                </button>
                <button type="button" className="btn-ghost min-h-[36px]" onClick={() => setSelected(new Set())}>Cancelar</button>
              </>
            )}
          </div>
          {db.campaigns.map((c) => {
            const m = auto.campaignMetrics(c.id);
            const cad = db.cadences.find((x) => x.id === c.cadenceId);
            return (
              <div key={c.id} className={cx('card flex items-start gap-3 py-4 pl-4 pr-5 transition-colors hover:border-accent', selected.has(c.id) && 'border-accent')}>
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${c.name}`}
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="mt-1.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                />
              <Link to={`/campanhas/${c.id}`} className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold">{c.name}</span>
                      <StatusChip status={c.status} />
                    </div>
                    <div className="mt-0.5 text-[13px] text-ink-faint">
                      {CHANNEL_LABEL[c.channel]} · {cad?.name ?? 'cadência removida'}
                      {c.ownerName && ` · ${c.ownerName}`}
                      {c.status === 'agendada' && c.scheduledAt && ` · começa ${formatDateTime(c.scheduledAt)}`}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  <Metric label="Leads" value={m.leads} />
                  <Metric label="Enviadas" value={m.sent} />
                  <Metric label="Entregues" value={m.delivered} />
                  <Metric label="Respostas" value={m.replies} />
                  <Metric label="Taxa de resposta" value={`${m.replyRate}%`} />
                  <Metric label="Interessados" value={m.interested} />
                </div>
              </Link>
              </div>
            );
          })}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={selected.size === 1 ? 'Excluir esta campanha?' : `Excluir ${selected.size} campanhas?`}
          confirmLabel="Excluir"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void deleteSelected()}
        >
          As campanhas são excluídas e os envios delas param na hora. Os leads continuam, com o histórico das mensagens já enviadas.
        </ConfirmDialog>
      )}
    </div>
  );
}

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function CampaignDetailPage() {
  const { campaignId } = useParams();
  const db = useDb();
  const service = useService();
  const auto = service.automation;
  const { toast } = useApp();
  const navigate = useNavigate();
  const drawer = useLeadDrawer();
  const camp = db.campaigns.find((c) => c.id === campaignId);
  const [busy, setBusy] = useState('');
  const [schedule, setSchedule] = useState('');
  const [confirm, setConfirm] = useState<'finish' | 'delete' | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const enrollments = useMemo(() => db.enrollments.filter((e) => e.campaignId === campaignId), [db.enrollments, campaignId]);
  const audience = useMemo(() => (camp ? auto.audienceLeads(camp.audience, camp.id) : []), [camp, auto, db.leads, db.enrollments, db.suppression]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!camp) return <EmptyState title="Campanha não encontrada" action={<Link to="/campanhas" className="btn-outline">Ver campanhas</Link>} />;

  const cad = db.cadences.find((c) => c.id === camp.cadenceId);
  const editable = camp.status === 'rascunho';
  const m = auto.campaignMetrics(camp.id);
  const pending = enrollments.filter((e) => e.status === 'pendente');
  const set = (patch: Partial<Campaign>) => auto.updateCampaign(camp.id, patch);
  const setAud = (patch: Partial<CampaignAudience>) => set({ audience: { ...camp.audience, ...patch } });
  const segments = [...new Set(db.companies.map((c) => c.segment))].sort();
  const leadName = (id: string) => {
    const l = db.leads.find((x) => x.id === id);
    const c = l && db.companies.find((x) => x.id === l.companyId);
    return c ? c.tradeName ?? c.legalName : 'Lead';
  };

  async function prepare() {
    setBusy('Gerando mensagens…');
    try {
      const n = await auto.prepareCampaign(camp!.id, (d, t) => setBusy(`Gerando mensagens… ${d} de ${t}`));
      toast(n ? `${n} leads preparados. Revise as mensagens antes de ativar.` : 'Nenhum lead novo no público.', n ? 'success' : 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao preparar.', 'error');
    } finally {
      setBusy('');
    }
  }

  function activate(when?: string) {
    try {
      auto.activateCampaign(camp!.id, when);
      toast(when ? 'Campanha agendada.' : 'Campanha ativada. Os envios respeitam a janela de horário.', 'success');
      if (auto.runsLocally) auto.tick();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao ativar.', 'error');
    }
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <Link to="/campanhas" className="btn-ghost -ml-3 w-fit">
        <ArrowLeft className="h-4 w-4" /> Campanhas
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="h1">{camp.name}</h1>
            <StatusChip status={camp.status} />
          </div>
          {camp.objective && <p className="mt-1 text-sm text-ink-faint">{camp.objective}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(camp.status === 'ativa' || camp.status === 'agendada') && (
            <button type="button" className="btn-outline" onClick={() => auto.pauseCampaign(camp.id)}><Pause className="h-4 w-4" /> Pausar</button>
          )}
          {camp.status === 'pausada' && (
            <button type="button" className="btn-primary" onClick={() => auto.resumeCampaign(camp.id)}><Play className="h-4 w-4" /> Retomar</button>
          )}
          {camp.status !== 'rascunho' && camp.status !== 'finalizada' && (
            <button type="button" className="btn-ghost text-bad" onClick={() => setConfirm('finish')}><Square className="h-4 w-4" /> Finalizar</button>
          )}
          <button type="button" className="btn-ghost text-bad" onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" /> Excluir</button>
        </div>
      </div>

      <section className="card grid grid-cols-3 gap-4 px-5 py-4 sm:grid-cols-6 lg:grid-cols-9">
        <Metric label="Leads" value={m.leads} />
        <Metric label="Em andamento" value={m.active} />
        <Metric label="Enviadas" value={m.sent} />
        <Metric label="Entregues" value={m.delivered} />
        <Metric label="Lidas" value={m.read} hint="WhatsApp" />
        <Metric label="Respostas" value={m.replies} hint={`${m.replyRate}% dos contatados`} />
        <Metric label="Interessados" value={m.interested} />
        <Metric label="Falhas" value={m.failed} />
        <Metric label="Envio manual" value={m.manual} hint="WhatsApp via wa.me" />
      </section>

      {camp.status !== 'rascunho' && <CampaignProgress campaignId={camp.id} />}

      <section className="card px-5 py-5">
        <h2 className="text-[15px] font-extrabold">Configuração</h2>
        {!editable && <p className="mt-1 text-xs text-ink-faint">Público e cadência ficam travados depois da ativação.</p>}
        <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor="c-name" className="label">Nome</label>
            <input id="c-name" className="input" value={camp.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="c-owner" className="label">Responsável</label>
            <input id="c-owner" className="input" value={camp.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="c-obj" className="label">Objetivo</label>
            <input id="c-obj" className="input" value={camp.objective} placeholder="Ex.: agendar 10 reuniões com indústrias de Limeira" onChange={(e) => set({ objective: e.target.value })} />
          </div>
          <div>
            <label htmlFor="c-ch" className="label">Canal</label>
            <select id="c-ch" className="input" disabled={!editable} value={camp.channel} onChange={(e) => set({ channel: e.target.value as CampaignChannel })}>
              <option value="multicanal">WhatsApp + e-mail</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </div>
          <div>
            <label htmlFor="c-cad" className="label">Cadência</label>
            <div className="flex gap-2">
              <select id="c-cad" className="input" disabled={!editable} value={camp.cadenceId} onChange={(e) => set({ cadenceId: e.target.value })}>
                {db.cadences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {cad && <Link to={`/cadencias/${cad.id}`} className="btn-outline shrink-0">Editar</Link>}
            </div>
          </div>
        </div>

        <h3 className="mt-6 text-sm font-extrabold">Público</h3>
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor="a-seg" className="label">Segmentos (vazio = todos)</label>
            <input id="a-seg" list="segments" className="input" disabled={!editable} value={camp.audience.segments.join(', ')} placeholder="Ex.: Agronegócio, Indústria" onChange={(e) => setAud({ segments: splitList(e.target.value) })} />
            <datalist id="segments">{segments.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label htmlFor="a-city" className="label">Cidades (vazio = todas)</label>
            <input id="a-city" className="input" disabled={!editable} value={camp.audience.cities.join(', ')} placeholder="Ex.: Campinas, Limeira" onChange={(e) => setAud({ cities: splitList(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="a-score" className="label">Score mínimo</label>
            <select id="a-score" className="input" disabled={!editable} value={camp.audience.minScore} onChange={(e) => setAud({ minScore: Number(e.target.value) })}>
              <option value={0}>Qualquer</option>
              <option value={50}>50+ (morno e quente)</option>
              <option value={80}>80+ (só quentes)</option>
            </select>
          </div>
          <div>
            <label htmlFor="a-tags" className="label">Tags (qualquer uma)</label>
            <input id="a-tags" className="input" disabled={!editable} value={camp.audience.tags.join(', ')} placeholder="Ex.: prioridade" onChange={(e) => setAud({ tags: splitList(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="a-list" className="label">Lista</label>
            <select id="a-list" className="input" disabled={!editable} value={camp.audience.listId ?? ''} onChange={(e) => setAud({ listId: e.target.value || undefined })}>
              <option value="">Todas as listas</option>
              {db.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <fieldset disabled={!editable}>
            <legend className="label">Etapas do pipeline</legend>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.filter((s) => !['cliente', 'nao_interessado'].includes(s.id)).map((s) => {
                const on = camp.audience.stages.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAud({ stages: on ? camp.audience.stages.filter((x) => x !== s.id) : [...camp.audience.stages, s.id] })}
                    className={cx('min-h-[32px] rounded-full border px-2.5 text-xs font-semibold', on ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong text-ink-soft')}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <p className="mt-3 text-sm">
          <strong>{audience.length}</strong> leads disponíveis no público
          <span className="text-ink-faint"> (já descontados opt-out, clientes, não interessados e leads em outra cadência).</span>
        </p>

        <h3 className="mt-6 text-sm font-extrabold">Automação</h3>
        <p className="mt-1 text-xs text-ink-faint">Pode ser alterada a qualquer momento, inclusive com a campanha ativa.</p>
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor="c-lim-wa" className="label">Limite diário de WhatsApp</label>
            <input
              id="c-lim-wa"
              type="number"
              min={1}
              className="input"
              placeholder="Sem limite"
              value={camp.dailyLimitWhatsapp ?? ''}
              onChange={(e) => set({ dailyLimitWhatsapp: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined })}
            />
            <p className="mt-1 text-xs text-ink-faint">Mensagens prontas na fila de Tarefas por dia. Hoje: {auto.sentToday(camp.id, 'whatsapp')}.</p>
          </div>
          <div>
            <label htmlFor="c-lim-em" className="label">Limite diário de e-mail</label>
            <input
              id="c-lim-em"
              type="number"
              min={1}
              className="input"
              placeholder="Sem limite"
              value={camp.dailyLimitEmail ?? ''}
              onChange={(e) => set({ dailyLimitEmail: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined })}
            />
            <p className="mt-1 text-xs text-ink-faint">E-mails enviados por dia. Hoje: {auto.sentToday(camp.id, 'email')}. O excedente sai no dia seguinte.</p>
          </div>
          <label className="flex items-start gap-2.5 rounded-lg border border-line px-3.5 py-3 text-[13px] sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={!!camp.autoEnroll} onChange={(e) => set({ autoEnroll: e.target.checked })} />
            <span>
              <span className="font-bold">Entrada automática</span>
              <span className="block text-ink-faint">
                Empresas novas encontradas pelas buscas (inclusive as agendadas) que se encaixam no público acima, com score mínimo {camp.audience.minScore || 0}, entram sozinhas nesta campanha enquanto ela estiver ativa. A campanha não finaliza sozinha.
              </span>
            </span>
          </label>
        </div>

        {cad && (
          <div className="mt-5 rounded-lg bg-subtle px-4 py-3">
            <div className="text-xs font-bold text-ink-soft">Cadência: {cad.name}</div>
            <ol className="mt-1.5 flex flex-col gap-0.5 text-[13px]">
              {cad.steps.map((s, i) => (
                <li key={s.id}><span className="mr-2 font-mono text-xs text-ink-faint">{i + 1}</span>{describeStep(s)}</li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {(editable || pending.length > 0) && (
        <section className="card px-5 py-5">
          <h2 className="text-[15px] font-extrabold">Revisar e ativar</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            “Preparar mensagens” cria a primeira mensagem de cada lead com os dados reais disponíveis. Revise e edite antes de ativar. As mensagens seguintes são escritas na hora do envio.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <button type="button" className="btn-outline" onClick={prepare} disabled={!!busy || audience.length === 0}>
              {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} {busy || `Preparar mensagens (${audience.length})`}
            </button>
            <button type="button" className="btn-primary" onClick={() => activate()} disabled={(!pending.length && !camp.autoEnroll) || !!busy}>
              <Play className="h-4 w-4" /> Ativar agora ({pending.length})
            </button>
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="c-when" className="label">Ou agendar para</label>
                <input id="c-when" type="datetime-local" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
              </div>
              <button type="button" className="btn-outline" disabled={(!pending.length && !camp.autoEnroll) || !schedule} onClick={() => activate(new Date(schedule).toISOString())}>
                <CalendarClock className="h-4 w-4" /> Agendar
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-extrabold">Leads da campanha ({enrollments.length})</h2>
        </div>
        {enrollments.length === 0 ? (
          <EmptyState title="Nenhum lead na campanha">Prepare as mensagens para incluir o público.</EmptyState>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {enrollments.map((e) => (
              <EnrollmentRow
                key={e.id}
                e={e}
                name={leadName(e.leadId)}
                stage={stageLabel(db.leads.find((l) => l.id === e.leadId)?.stage ?? '')}
                stepText={cad?.steps[e.stepIndex] ? describeStep(cad.steps[e.stepIndex]) : 'Fim da cadência'}
                open={openDraft === e.id}
                onToggle={() => setOpenDraft(openDraft === e.id ? null : e.id)}
                onOpenLead={() => drawer.open(e.leadId)}
              />
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          title={confirm === 'finish' ? 'Finalizar esta campanha?' : 'Excluir esta campanha?'}
          confirmLabel={confirm === 'finish' ? 'Finalizar' : 'Excluir'}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === 'finish') {
              auto.finishCampaign(camp.id);
              toast('Campanha finalizada. Nenhum envio novo será feito.');
            } else {
              void auto
                .deleteCampaign(camp.id)
                .then(() => toast('Campanha excluída.', 'success'))
                .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Não foi possível excluir.', 'error'));
              navigate('/campanhas');
            }
          }}
        >
          {confirm === 'finish'
            ? 'Todas as cadências desta campanha serão encerradas. O histórico e as métricas continuam disponíveis.'
            : camp.status === 'rascunho'
              ? 'A campanha e os rascunhos de mensagem serão excluídos.'
              : 'A campanha é excluída e os envios param na hora. Os leads continuam, com o histórico das mensagens já enviadas.'}
        </ConfirmDialog>
      )}
    </div>
  );
}

function EnrollmentRow({
  e,
  name,
  stage,
  stepText,
  open,
  onToggle,
  onOpenLead,
}: {
  e: Enrollment;
  name: string;
  stage: string;
  stepText: string;
  open: boolean;
  onToggle: () => void;
  onOpenLead: () => void;
}) {
  const service = useService();
  const [body, setBody] = useState(e.draft?.body ?? '');
  const [subject, setSubject] = useState(e.draft?.subject ?? '');
  const tone =
    e.status === 'ativa' ? 'text-good' : e.status === 'pausada' ? 'text-warn' : e.status === 'interrompida' ? 'text-ink-faint' : e.status === 'concluida' ? 'text-ink-soft' : 'text-ai';
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={onOpenLead} className="text-left text-sm font-bold hover:text-accent">{name}</button>
          <div className="text-xs text-ink-faint">
            {stage} · <span className={cx('font-semibold', tone)}>{ENROLLMENT_STATUS_LABEL[e.status]}</span>
            {e.status === 'ativa' && e.nextRunAt && ` · próxima etapa ${formatDateTime(e.nextRunAt)}: ${stepText}`}
            {e.stopReason && (e.status === 'pausada' || e.status === 'interrompida') && ` · ${e.stopReason}`}
          </div>
        </div>
        <div className="flex gap-1">
          {e.draft && (
            <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs" onClick={onToggle}>{open ? 'Fechar' : e.status === 'pendente' ? 'Revisar mensagem' : 'Ver mensagem'}</button>
          )}
          {e.status === 'pendente' && (
            <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs hover:text-bad" onClick={() => service.automation.removeEnrollment(e.id)}>Remover</button>
          )}
        </div>
      </div>
      {open && e.draft && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="font-bold text-ink-soft">Contexto usado:</span>
            {e.draft.context.map((c) => (
              <span key={c.field} className="rounded bg-good-soft px-1.5 py-0.5 font-semibold text-good">{c.label}: {c.value}</span>
            ))}
            <span className="text-ink-faint">· {e.draft.template} · {e.draft.model}</span>
          </div>
          {e.draft.channel === 'email' && (
            <>
              <label htmlFor={`sub-${e.id}`} className="label">Assunto</label>
              <input id={`sub-${e.id}`} className="input mb-2" readOnly={e.status !== 'pendente'} value={subject} onChange={(ev) => setSubject(ev.target.value)} />
            </>
          )}
          <label htmlFor={`body-${e.id}`} className="label">{e.draft.channel === 'whatsapp' ? 'Mensagem de WhatsApp' : 'E-mail'}</label>
          <textarea id={`body-${e.id}`} rows={e.draft.channel === 'email' ? 8 : 4} readOnly={e.status !== 'pendente'} className="input py-2 leading-relaxed" value={body} onChange={(ev) => setBody(ev.target.value)} />
          {e.status === 'pendente' && (
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-outline" disabled={body === e.draft.body && subject === (e.draft.subject ?? '')} onClick={() => service.automation.editDraft(e.id, body, subject || undefined)}>
                Salvar edição
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
