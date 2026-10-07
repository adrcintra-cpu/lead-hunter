import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink, Mail, MessageCircle, Pencil, RefreshCw, ShieldOff, Sparkles, Trash2, X } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { useLeadRow, type LeadRow } from '@/store/selectors';
import { ANALYSIS_SECTIONS, STAGES, type Channel, type CompanyField, type LeadStage, type Message } from '@/core/types';
import { TIER_LABEL } from '@/core/scoring';
import { formatDate, formatDateTime } from '@/core/utils';
import { channelLabel } from '@/services/leadHunterService';
import { ConfirmDialog, cx, EmptyState, ErrorBox, ProvenanceTag, Skeleton, Spinner, type ProvenanceKind } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { CadencePanel, ConversationPanel, CrmPanel, FollowUpPicker, LeadTasks, Timeline } from './LeadCrmPanels';
import { parseSubject } from '../../../supabase/functions/_shared/automation/replies.ts';
import { SendConnectedButton } from './SendConnectedButton';
import { Fold, PanelTitle, since } from './Fold';
import { readIntel, stageLabel as beelieStageLabel, TEMPERATURE_LABEL } from '../../../supabase/functions/_shared/automation/beelie.ts';
import { BeeliePanel } from './BeeliePanel';

export function LeadDrawer({ leadId }: { leadId: string }) {
  const { close } = useLeadDrawer();
  const row = useLeadRow(leadId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Fechar perfil" onClick={close} className="absolute inset-0 bg-black/30" />
      <aside role="dialog" aria-modal="true" aria-label="Perfil do lead" className="absolute inset-y-0 right-0 flex w-full max-w-[600px] flex-col overflow-y-auto border-l border-line bg-surface shadow-pop">
        {row ? (
          <LeadProfile row={row} onClose={close} />
        ) : (
          <div className="p-6">
            <EmptyState title="Lead não encontrado">Ele pode ter sido removido.</EmptyState>
          </div>
        )}
      </aside>
    </div>
  );
}

export function LeadProfile({ row, onClose, standalone = false }: { row: LeadRow; onClose?: () => void; standalone?: boolean }) {
  const { lead, company: c, score } = row;
  const service = useService();
  const { toast } = useApp();
  const navigate = useNavigate();
  const name = c.tradeName ?? c.legalName;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const db = useDb();
  const ev = leadEvolution(db, lead);

  async function remove() {
    try {
      await service.deleteLeads([lead.id]);
      toast('Lead excluído.', 'success');
      if (onClose) onClose();
      else navigate('/leads');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível excluir.', 'error');
    }
  }

  return (
    <>
      {confirmDelete && (
        <ConfirmDialog title={`Excluir ${name}?`} confirmLabel="Excluir" onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()}>
          A empresa, o histórico, as mensagens, as tarefas e a participação em campanhas serão apagados. Isso não pode ser desfeito.
        </ConfirmDialog>
      )}
      <header className={cx('z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-6 py-4', !standalone && 'sticky top-0')}>
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{name}</h2>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            {c.segment} · {c.city}/{c.state}
            {lead.contactName && ` · ${lead.contactName}${lead.contactRole ? ` (${lead.contactRole})` : ''}`}
            {lead.ownerName && ` · resp. ${lead.ownerName}`}
          </p>
          {(lead.tags?.length || lead.nextAction) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(lead.tags ?? []).map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">#{t}</span>)}
              {lead.nextAction && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">Próxima ação: {lead.nextAction}{lead.nextActionAt ? ` · ${formatDateTime(lead.nextActionAt)}` : ''}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="stage" className="sr-only">Etapa</label>
          <select id="stage" className="input min-h-[38px] w-auto py-1 text-[13px]" value={lead.stage} onChange={(e) => service.changeStage(lead.id, e.target.value as LeadStage)}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {!standalone && (
            <Link to={`/leads/${lead.id}`} className="btn-ghost min-h-[38px] px-2" aria-label="Abrir em página dedicada" title="Abrir em página dedicada">
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost min-h-[38px] px-2 text-bad" aria-label="Excluir lead" title="Excluir lead">
            <Trash2 className="h-4 w-4" />
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="btn-outline min-h-[38px] px-2" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-6 px-6 pb-12 pt-5">
        <ScoreCard row={row} />
        {score && <p className="-mt-3 text-[13px] leading-relaxed text-ink-soft">{score.justification}</p>}

        <div className="flex flex-wrap gap-2">
          <ProvenanceTag kind="found" />
          <ProvenanceTag kind="inference" />
          <ProvenanceTag kind="unavailable" />
        </div>

        <div className="flex flex-col gap-2.5">
          <Fold leadId={lead.id} id="beelie" title="Inteligência comercial · Beelie" positive={ev.beelie.pos} summary={ev.beelie.summary}>
            <BeeliePanel lead={lead} />
          </Fold>
          <Fold leadId={lead.id} id="campanha" title="Campanha e cadência" positive={ev.campanha.pos} negative={ev.campanha.neg} summary={ev.campanha.summary}>
            <CadencePanel leadId={lead.id} />
          </Fold>
          {ev.tarefas.total > 0 && (
            <Fold leadId={lead.id} id="tarefas" title="Tarefas" positive={ev.tarefas.pos} negative={ev.tarefas.neg} summary={ev.tarefas.summary}>
              <LeadTasks leadId={lead.id} />
            </Fold>
          )}
          <Fold leadId={lead.id} id="conversa" title="Mensagens e respostas" positive={ev.conversa.pos} negative={ev.conversa.neg} summary={ev.conversa.summary}>
            <ConversationPanel row={row} />
          </Fold>
          <Fold leadId={lead.id} id="crm" title="Contato e CRM" summary={lead.contactName ?? undefined}>
            <CrmPanel row={row} />
          </Fold>
          <Fold leadId={lead.id} id="empresa" title="Dados da empresa">
            <CompanyFacts row={row} />
          </Fold>
          <Fold leadId={lead.id} id="analise" title="Análise da IA">
            <AnalysisPanel row={row} />
          </Fold>
          <Fold leadId={lead.id} id="abordagem" title="Gerar abordagem">
            <ApproachPanel row={row} />
          </Fold>
          <Fold leadId={lead.id} id="listas" title="Listas">
            <ListsPanel leadId={lead.id} />
          </Fold>
          <Fold leadId={lead.id} id="notas" title="Notas">
            <NotesAndHistory leadId={lead.id} />
          </Fold>
          <Fold leadId={lead.id} id="historico" title="Linha do tempo" positive={ev.historico.pos} negative={ev.historico.neg}>
            <Timeline leadId={lead.id} />
          </Fold>
        </div>
      </div>
    </>
  );
}

function ScoreCard({ row }: { row: LeadRow }) {
  const { lead, score } = row;
  const service = useService();
  const [busy, setBusy] = useState(false);
  const bar = lead.scoreTier === 'alta' ? 'bg-good' : lead.scoreTier === 'media' ? 'bg-warn' : 'bg-ink-faint';
  const chip = lead.scoreTier === 'alta' ? 'bg-good-soft text-good' : lead.scoreTier === 'media' ? 'bg-warn-soft text-warn' : 'bg-muted text-ink-soft';
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex items-center gap-5">
        <div>
          <div className="text-[11.5px] font-bold tracking-[0.08em] text-ink-soft">SCORE</div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-[40px] font-semibold leading-none">{lead.currentScore}</span>
            <span className="font-mono text-base text-ink-faint">/100</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cx('rounded-md px-2.5 py-1 text-[12.5px] font-extrabold', chip)}>{TIER_LABEL[lead.scoreTier]}</span>
            <button
              type="button"
              className="btn-ghost min-h-[32px] px-2 text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await service.rescore(lead.id);
                setBusy(false);
              }}
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Recalcular
            </button>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cx('h-full rounded-full', bar)} style={{ width: `${lead.currentScore}%` }} />
          </div>
          {score && (
            <div className="mt-2 font-mono text-xs text-ink-soft">
              Regras {score.ruleScore} · Ajuste da IA {score.aiAdjustment >= 0 ? '+' : ''}{score.aiAdjustment}
            </div>
          )}
        </div>
      </div>
      {score && (
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-soft">Ver composição do score</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {score.breakdown.map((r) => (
              <li key={r.key} className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                <span className="text-ink-soft">{r.label}</span>
                <span className="truncate text-ink-faint" title={r.evidence}>{r.evidence}</span>
                <span className="font-mono">{r.points}/{r.max}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const FACT_FIELDS: { field: CompanyField; label: string }[] = [
  { field: 'legalName', label: 'Razão social' },
  { field: 'tradeName', label: 'Nome fantasia' },
  { field: 'cnpj', label: 'CNPJ' },
  { field: 'registrationStatus', label: 'Situação na Receita' },
  { field: 'cnae', label: 'Atividade (CNAE)' },
  { field: 'companySize', label: 'Porte (Receita)' },
  { field: 'employeesRange', label: 'Funcionários' },
  { field: 'openedAt', label: 'Abertura' },
  { field: 'segment', label: 'Segmento' },
  { field: 'city', label: 'Cidade' },
  { field: 'state', label: 'Estado' },
  { field: 'address', label: 'Endereço comercial' },
  { field: 'website', label: 'Website' },
  { field: 'phone', label: 'Telefone comercial' },
  { field: 'whatsapp', label: 'WhatsApp comercial' },
  { field: 'instagram', label: 'Instagram' },
  { field: 'linkedin', label: 'LinkedIn' },
];

/** Campos que só aparecem quando a fonte de CNPJ os preencheu (evita uma lista longa de "não disponível"). */
const ONLY_WHEN_PRESENT: CompanyField[] = ['registrationStatus', 'cnae', 'companySize', 'employeesRange', 'openedAt'];

function CompanyFacts({ row }: { row: LeadRow }) {
  const { company: c } = row;
  const service = useService();
  const db = useDb();
  const expires = db.leadSources
    .filter((s) => s.companyId === c.id && s.expiresAt)
    .map((s) => s.expiresAt!)
    .sort()
    .pop();
  return (
    <section>
      <PanelTitle className="mb-1">Dados da empresa</PanelTitle>
      <dl>
        {FACT_FIELDS.map(({ field, label }) => {
          const raw = c[field as keyof typeof c] as string | undefined;
          if (!raw && ONLY_WHEN_PRESENT.includes(field)) return null;
          const src = c.fieldProvenance[field];
          // Nome vindo do Google é nome comercial: só vira razão social com o CNPJ.
          const known = field === 'legalName' ? !!(raw && src) : !!raw;
          let value: string | undefined = known ? raw : undefined;
          if (field === 'whatsapp' && raw) value = `${raw} · ${c.whatsappStatus === 'confirmado' ? 'confirmado' : c.whatsappStatus === 'provavel' ? 'provável, não confirmado' : 'status desconhecido'}`;
          if (field === 'employeesRange' && raw) value = `${raw} funcionários`;
          if (field === 'openedAt' && raw) value = formatDate(`${raw}T12:00:00`);
          const inactive = field === 'registrationStatus' && raw && raw.toUpperCase() !== 'ATIVA';
          const kind: ProvenanceKind = known ? 'found' : 'unavailable';
          return (
            <div key={field} className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2">
              <dt className="text-[12.5px] text-ink-faint">{label}</dt>
              <dd className={cx('break-words text-[13.5px]', !known && 'text-ink-faint', inactive && 'font-bold text-bad')}>
                {value ?? (field === 'legalName' ? 'Informe o CNPJ para confirmar' : '—')}
              </dd>
              <dd>
                <ProvenanceTag kind={kind} title={src && known ? `Fonte: ${service.providerLabel(src.provider)} · ${formatDateTime(src.fetchedAt)}` : undefined} />
              </dd>
            </div>
          );
        })}
      </dl>
      <CnpjForm row={row} />
      <p className="mt-2 text-xs text-ink-faint">
        Origem: {row.lead.origin} · descoberto em {formatDateTime(row.lead.discoveredAt)}. Passe o mouse na etiqueta para ver a fonte de cada campo.
        {expires && ` Dados da busca válidos até ${formatDate(expires)}; depois, rode a busca de novo para atualizar.`}
      </p>
    </section>
  );
}

function CnpjForm({ row }: { row: LeadRow }) {
  const service = useService();
  const { toast } = useApp();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const has = !!row.company.cnpj && !!row.company.fieldProvenance.cnpj;
  const [open, setOpen] = useState(false);

  if (has && !open) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
        <span>{warning}</span>
        <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs" onClick={() => setOpen(true)}>Corrigir CNPJ</button>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const r = await service.enrichCnpj(row.lead.id, value);
      if (r.warning) setWarning(r.warning);
      toast('Dados da Receita incluídos e score recalculado.', 'success');
      setValue('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível consultar o CNPJ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-dashed border-line-strong p-3">
      <label htmlFor="cnpj" className="label">{has ? 'Corrigir CNPJ' : 'Sabe o CNPJ? Complete com os dados da Receita'}</label>
      <div className="flex gap-2">
        <input id="cnpj" className="input font-mono" inputMode="numeric" placeholder="00.000.000/0000-00" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn-outline shrink-0" disabled={busy || value.replace(/\D/g, '').length < 14}>
          {busy && <Spinner />} Consultar
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {warning && <p className="mt-2 text-xs text-warn">{warning}</p>}
      <p className="mt-1.5 text-xs text-ink-faint">Consulta pública (BrasilAPI). Traz razão social, situação, atividade e porte da Receita.</p>
    </form>
  );
}

function AnalysisPanel({ row }: { row: LeadRow }) {
  const db = useDb();
  const service = useService();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const analysis = db.analyses.find((a) => a.leadId === row.lead.id);

  async function load(force = false) {
    setBusy(true);
    setError('');
    try {
      await service.ensureAnalysis(row.lead.id, force);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na análise.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!analysis) load();
  }, [row.lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const kindOf = (k: string): ProvenanceKind => (k === 'fact' ? 'found' : k === 'inference' ? 'inference' : 'unavailable');

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <PanelTitle>Análise da IA</PanelTitle>
        {analysis && (
          <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs" onClick={() => load(true)} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Refazer
          </button>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!analysis && busy && (
        <div className="flex flex-col gap-2 pt-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {analysis &&
        ANALYSIS_SECTIONS.map(({ key, label }) => {
          const items = analysis.sections[key] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={key} className="border-t border-line py-2.5">
              <div className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">{label}</div>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {items.map((it, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-[13.5px] leading-relaxed">
                    <span className={cx(it.kind === 'inference' && 'italic', it.kind === 'unavailable' && 'text-ink-faint')}>{it.text}</span>
                    <ProvenanceTag kind={kindOf(it.kind)} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      {analysis && <p className="mt-1 text-xs text-ink-faint">Modelo: {analysis.model} · {formatDateTime(analysis.createdAt)}. Inferências não são fatos: confirme antes de usar.</p>}
    </section>
  );
}

const CHANNELS: Channel[] = ['whatsapp', 'email', 'linkedin'];

function ApproachPanel({ row }: { row: LeadRow }) {
  const { lead, company } = row;
  const service = useService();
  const db = useDb();
  const { toast } = useApp();
  const [channel, setChannel] = useState<Channel>(company.whatsapp ? 'whatsapp' : 'email');
  const [variant, setVariant] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const suppressed = service.suppressionFor(company);

  const message: Message | undefined = useMemo(
    () => db.messages.filter((m) => m.leadId === lead.id && m.channel === channel).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [db.messages, lead.id, channel],
  );
  const [draft, setDraft] = useState(message?.finalContent ?? '');
  useEffect(() => {
    setDraft(message?.finalContent ?? '');
    setEditing(false);
  }, [message?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resposta sugerida pela IA depois de uma resposta do lead (objetivo: marcar uma conversa).
  const isSuggestion = !!message?.template?.startsWith('IA — resposta sugerida');
  const lastReply = useMemo(
    () => db.inbound.filter((r) => r.leadId === lead.id && r.channel === channel).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0],
    [db.inbound, lead.id, channel],
  );

  async function regenerateSuggestion() {
    setBusy(true);
    setError('');
    try {
      const cat = db.activities
        .filter((a) => a.leadId === lead.id && a.type === 'reply_classified')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.payload?.category as string | undefined;
      const m = await service.automation.suggestReply(lead.id, channel as 'whatsapp' | 'email', cat);
      if (!m) setError('Não há resposta do lead para responder.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível sugerir uma resposta.');
    } finally {
      setBusy(false);
    }
  }

  async function generate(nextVariant: number) {
    setBusy(true);
    setError('');
    try {
      await service.generateMessage(lead.id, channel, nextVariant);
      setVariant(nextVariant);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar a abordagem.');
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    if (message) service.editMessage(message.id, draft);
    setEditing(false);
  }

  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(editing ? draft : message.finalContent);
      service.markCopied(message.id);
      toast('Mensagem copiada.', 'success');
    } catch {
      toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error');
    }
  }

  // Link real (abre em nova aba): não depende de pop-up e usa o texto atual, mesmo durante a edição.
  const waLink = message && channel === 'whatsapp' ? service.whatsappLink(message.id, editing ? draft : undefined) : null;

  function onWhatsappOpened() {
    if (!message) return;
    if (editing) saveEdit();
    service.markWhatsappOpened(message.id);
    toast('WhatsApp aberto com a mensagem. Depois de enviar, clique em “Marcar como enviado”.', 'success');
  }

  // E-mail: abre o app de e-mail do usuário com assunto e corpo prontos (o envio é dele).
  const emailText = editing ? draft : message?.finalContent ?? '';
  const emailParts = parseSubject(emailText);
  const mailto =
    message && channel === 'email' && lead.email
      ? `mailto:${lead.email.trim()}?subject=${encodeURIComponent(emailParts.subject ?? '')}&body=${encodeURIComponent(emailParts.body)}`
      : null;

  function onMarkSent() {
    if (!message) return;
    if (editing) saveEdit();
    service.markSent(message.id);
    toast('Registrado como enviado manualmente. Agende o próximo contato.', 'success');
  }

  // Já houve contato: a próxima mensagem é um follow-up que continua a conversa.
  const hadContact = db.messages.some((m) => m.leadId === lead.id && (m.sentAt || m.status === 'opened_whatsapp'));
  const sent = message && (message.status === 'sent' || message.status === 'delivered' || message.status === 'read' || message.status === 'replied');

  const waProblem =
    channel !== 'whatsapp'
      ? ''
      : !company.whatsapp
        ? 'Nenhum WhatsApp encontrado para esta empresa. Use e-mail ou LinkedIn.'
        : company.whatsappStatus !== 'confirmado'
          ? 'Número não confirmado como WhatsApp. Verifique antes de enviar.'
          : '';

  return (
    <section className="rounded-xl border border-line p-4">
      <PanelTitle>Gerar abordagem</PanelTitle>
      <div role="radiogroup" aria-label="Canal" className="mt-3 flex flex-wrap gap-1.5">
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            type="button"
            role="radio"
            aria-checked={channel === ch}
            onClick={() => setChannel(ch)}
            className={cx(
              'min-h-[38px] rounded-lg border px-3.5 text-[13px] font-bold transition-colors',
              channel === ch ? 'border-inverse bg-inverse text-inverse-ink' : 'border-line-strong bg-surface text-ink hover:bg-muted',
            )}
          >
            {channelLabel(ch)}
          </button>
        ))}
      </div>

      {suppressed ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bad-soft px-3.5 py-3 text-[13px] leading-relaxed text-bad">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0" />
          Contato na lista de supressão ({suppressed.reason}). A geração de abordagem e o link de WhatsApp ficam bloqueados.
        </div>
      ) : (
        <>
          {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
          {!message ? (
            <div className="mt-3 rounded-lg border border-dashed border-line-strong p-4 text-center">
              <p className="text-[13px] text-ink-faint">
                {hadContact ? 'A IA lê o histórico e escreve uma continuação da conversa, sem repetir a mensagem anterior.' : 'A IA escreve uma mensagem curta usando só dados encontrados.'}
              </p>
              <button type="button" className="btn-primary mt-3" onClick={() => generate(0)} disabled={busy}>
                {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} {hadContact ? 'Gerar follow-up com IA' : 'Gerar mensagem com IA'} ({channelLabel(channel)})
              </button>
            </div>
          ) : (
            <>
              {isSuggestion && !sent && lastReply && (
                <div className="mt-3 rounded-lg border border-line bg-subtle px-3 py-2 text-[13px]">
                  <div className="text-xs font-bold text-ink-faint">O lead respondeu</div>
                  <p className="mt-0.5 whitespace-pre-wrap">{lastReply.body}</p>
                </div>
              )}
              <label htmlFor="msg" className="label mt-3">
                {editing ? 'Editando mensagem' : sent ? 'Mensagem enviada' : isSuggestion ? 'Resposta sugerida pela IA · revise antes de enviar' : 'Mensagem preparada'}
              </label>
              <textarea
                id="msg"
                rows={channel === 'email' ? 11 : 6}
                readOnly={!editing}
                value={editing ? draft : message.finalContent}
                onChange={(e) => setDraft(e.target.value)}
                className={cx('input min-h-[120px] resize-y py-2.5 leading-relaxed', !editing && 'bg-subtle')}
              />
              <p className="mt-1.5 text-xs text-ink-faint">Campos entre colchetes são seus: complete em Configurações para preencher automaticamente.</p>
              {sent ? (
                <>
                  <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-good">
                    <Check className="h-4 w-4" /> {message?.provider === 'whatsapp_qr' ? 'Enviado pelo WhatsApp conectado' : 'Enviado manualmente'} em {formatDateTime(message?.sentAt ?? message?.updatedAt ?? '')}
                  </p>
                  <FollowUpPicker leadId={lead.id} channel={channel} />
                  <button type="button" className="btn-outline mt-3" onClick={() => generate(0)} disabled={busy}>
                    {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} Gerar follow-up com IA
                  </button>
                </>
              ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-outline" onClick={copy}>
                  <Copy className="h-4 w-4" /> Copiar
                </button>
                <button type="button" className="btn-outline" onClick={() => (isSuggestion ? regenerateSuggestion() : generate(variant + 1))} disabled={busy}>
                  {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Regenerar
                </button>
                <button type="button" className="btn-outline" onClick={() => (editing ? saveEdit() : setEditing(true))}>
                  <Pencil className="h-4 w-4" /> {editing ? 'Salvar edição' : 'Editar'}
                </button>
                {waLink && channel === 'whatsapp' && (
                  <>
                    <SendConnectedButton messageId={message.id} getText={() => (editing ? draft : message.finalContent)} beforeSend={() => editing && saveEdit()} />
                    <SendConnectedButton audio messageId={message.id} getText={() => (editing ? draft : message.finalContent)} beforeSend={() => editing && saveEdit()} />
                  </>
                )}
                {waLink && (
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className="btn-primary" onClick={onWhatsappOpened}>
                    <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
                  </a>
                )}
                {mailto && (
                  <a href={mailto} className="btn-primary" onClick={() => editing && saveEdit()}>
                    <Mail className="h-4 w-4" /> Abrir no e-mail
                  </a>
                )}
                <button type="button" className="btn-outline" onClick={onMarkSent}>
                  <Check className="h-4 w-4" /> Marcar como enviado
                </button>
              </div>
              )}
            </>
          )}
          {waProblem && <p className="mt-2 text-[12.5px] text-warn">{waProblem}</p>}
          {channel === 'email' && message && !lead.email && !sent && (
            <p className="mt-2 text-[12.5px] text-warn">Cadastre o e-mail do contato (Dados de CRM) para abrir a mensagem no seu app de e-mail.</p>
          )}
        </>
      )}
    </section>
  );
}

function ListsPanel({ leadId }: { leadId: string }) {
  const db = useDb();
  const service = useService();
  const memberOf = new Set(db.listMembers.filter((m) => m.leadId === leadId).map((m) => m.listId));
  if (db.lists.length === 0) {
    return (
      <section>
        <PanelTitle className="mb-1">Listas</PanelTitle>
        <p className="text-[13px] text-ink-faint">
          Nenhuma lista criada. <Link to="/listas" className="text-accent underline">Criar lista</Link>
        </p>
      </section>
    );
  }
  return (
    <section>
      <PanelTitle className="mb-2">Listas</PanelTitle>
      <div className="flex flex-wrap gap-1.5">
        {db.lists.map((l) => {
          const on = memberOf.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => (on ? service.removeFromList(leadId, l.id) : service.addToList(leadId, l.id))}
              className={cx(
                'min-h-[34px] rounded-full border px-3 text-[13px] font-semibold transition-colors',
                on ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong text-ink-soft hover:bg-muted',
              )}
            >
              {on ? '✓ ' : '+ '}
              {l.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NotesAndHistory({ leadId }: { leadId: string }) {
  const db = useDb();
  const service = useService();
  const [note, setNote] = useState('');
  const notes = db.notes.filter((n) => n.leadId === leadId);
  return (
    <>
      <section>
        <PanelTitle className="mb-2">Notas</PanelTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            service.addNote(leadId, note);
            setNote('');
          }}
        >
          <label htmlFor="note" className="sr-only">Nova nota</label>
          <input id="note" className="input" placeholder="Anotar algo sobre este lead" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn-outline" disabled={!note.trim()}>Salvar</button>
        </form>
        {notes.length > 0 && (
          <ul className="mt-2">
            {notes.map((n) => (
              <li key={n.id} className="border-t border-line py-2 text-[13.5px]">
                {n.body}
                <span className="ml-2 font-mono text-xs text-ink-faint">{formatDateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Negativas nas respostas: recusa ou pedido para não receber mensagens. */
const NEG_REPLY = new Set(['nao_interessado', 'opt_out']);
const NEG_ACTIVITY = new Set(['message_failed', 'cadence_stopped']);

/**
 * Novidades de cada seção desde a última vez que ela foi aberta (azul = positivas, vermelho = negativas)
 * e o resumo de uma linha mostrado com a seção fechada.
 */
function leadEvolution(db: ReturnType<typeof useDb>, lead: LeadRow['lead']) {
  const id = lead.id;
  const now = new Date().toISOString();
  const after = (at: string | undefined, sec: string) => !!at && at > since(id, sec);

  const intel = lead.beelie ? readIntel(lead.beelie) : null;
  const beelie = {
    pos: intel ? intel.learned.filter((l) => after(l.at, 'beelie')).length : 0,
    summary: intel ? `${beelieStageLabel(intel.stage)} · ${TEMPERATURE_LABEL[intel.temperature]}` : undefined,
  };

  const msgs = db.messages.filter((m) => m.leadId === id);
  const campMsgs = msgs.filter((m) => m.campaignId && after(m.sentAt ?? m.createdAt, 'campanha'));
  const enr = db.enrollments.find((e) => e.leadId === id && (e.status === 'ativa' || e.status === 'pausada' || e.status === 'pendente'));
  const camp = enr && db.campaigns.find((c) => c.id === enr.campaignId);
  const campanha = {
    pos: campMsgs.filter((m) => ['sent', 'delivered', 'read', 'replied'].includes(m.status)).length,
    neg: campMsgs.filter((m) => m.status === 'failed').length,
    summary: camp ? camp.name : 'Nenhuma campanha',
  };

  const tasks = db.tasks.filter((t) => t.leadId === id);
  const open = tasks.filter((t) => t.status === 'aberta');
  const tarefas = {
    total: tasks.length,
    pos: open.filter((t) => after(t.createdAt, 'tarefas')).length,
    neg: open.filter((t) => t.dueAt && t.dueAt < now).length,
    summary: open.length ? `${open.length} ${open.length === 1 ? 'aberta' : 'abertas'}` : 'nenhuma aberta',
  };

  const replies = db.inbound.filter((r) => r.leadId === id && after(r.receivedAt, 'conversa') && r.classification !== 'ausente');
  const lastIn = db.inbound.filter((r) => r.leadId === id).map((r) => r.receivedAt).sort().pop();
  const conversa = {
    pos: replies.filter((r) => !NEG_REPLY.has(String(r.classification))).length,
    neg: replies.filter((r) => NEG_REPLY.has(String(r.classification))).length + msgs.filter((m) => !m.campaignId && m.status === 'failed' && after(m.sentAt ?? m.createdAt, 'conversa')).length,
    summary: lastIn ? `última resposta ${formatDateTime(lastIn)}` : msgs.some((m) => m.sentAt) ? 'sem resposta ainda' : undefined,
  };

  const acts = db.activities.filter((a) => a.leadId === id && after(a.createdAt, 'historico'));
  const isNeg = (a: (typeof acts)[number]) => NEG_ACTIVITY.has(a.type) || (a.type === 'stage_changed' && /não interessado/i.test(a.description));
  const historico = { pos: acts.filter((a) => !isNeg(a)).length, neg: acts.filter(isNeg).length };

  return { beelie, campanha, tarefas, conversa, historico };
}
