import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Clock, GitBranch, ListChecks, Mail, MessageCircle, Plus, Trash2, Workflow } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { STAGES, type Cadence, type CadenceStep, type StepAction } from '@/core/types';
import { describeStep } from '../../../supabase/functions/_shared/automation/planner.ts';
import { uid } from '@/core/utils';
import { ConfirmDialog, EmptyState, PageHeader, cx } from '@/components/ui';

const VARS = ['{{nome}}', '{{empresa}}', '{{cargo}}', '{{cidade}}', '{{segmento}}', '{{site}}', '{{remetente}}', '{{minha_empresa}}', '{{oferta}}'];

export function CadencesPage() {
  const db = useDb();
  const navigate = useNavigate();
  const service = useService();
  const usedBy = (id: string) => db.campaigns.filter((c) => c.cadenceId === id).length;
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Cadências"
        subtitle="Sequências de contato: canal, intervalo, mensagem e condições. Usadas pelas campanhas."
        actions={
          <button
            type="button"
            className="btn-dark"
            onClick={() => {
              const at = new Date().toISOString();
              const c = service.automation.saveCadence({ id: uid('cad'), name: 'Nova cadência', stopOnReply: true, steps: [], createdAt: at, updatedAt: at });
              navigate(`/cadencias/${c.id}`);
            }}
          >
            <Plus className="h-4 w-4" /> Nova cadência
          </button>
        }
      />
      {db.cadences.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Workflow className="h-8 w-8" />} title="Nenhuma cadência">Crie uma sequência de contatos para usar nas campanhas.</EmptyState>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {db.cadences.map((c) => (
            <Link key={c.id} to={`/cadencias/${c.id}`} className="card flex flex-col px-5 py-4 transition-colors hover:border-accent">
              <div className="flex items-start justify-between gap-3">
                <span className="text-base font-extrabold">{c.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">{usedBy(c.id)} campanhas</span>
              </div>
              {c.description && <p className="mt-1 text-[13px] text-ink-faint">{c.description}</p>}
              <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                {c.steps.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-ink-faint">→</span>}
                    <StepChip step={s} />
                  </li>
                ))}
                {c.steps.length === 0 && <li className="text-ink-faint">Sem etapas</li>}
              </ol>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StepChip({ step }: { step: CadenceStep }) {
  const base = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold';
  if (step.type === 'send')
    return (
      <span className={cx(base, step.channel === 'whatsapp' ? 'bg-good-soft text-good' : 'bg-ai-soft text-ai')}>
        {step.channel === 'whatsapp' ? <MessageCircle className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
        {step.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
      </span>
    );
  if (step.type === 'wait') return <span className={cx(base, 'bg-muted text-ink-soft')}>{step.days}d</span>;
  if (step.type === 'condition') return <span className={cx(base, 'bg-warn-soft text-warn')}>Se…</span>;
  if (step.type === 'task') return <span className={cx(base, 'bg-muted text-ink-soft')}>Tarefa</span>;
  return <span className={cx(base, 'bg-muted text-ink-soft')}>Etapa</span>;
}

const NEW_STEP: Record<CadenceStep['type'], () => CadenceStep> = {
  send: () => ({ id: uid('st'), type: 'send', channel: 'whatsapp', mode: 'ai', template: '' }),
  wait: () => ({ id: uid('st'), type: 'wait', days: 3 }),
  condition: () => ({ id: uid('st'), type: 'condition', condition: 'replied', ifTrue: 'stop', ifFalse: 'continue' }),
  task: () => ({ id: uid('st'), type: 'task', title: 'Ligar para o lead' }),
  stage: () => ({ id: uid('st'), type: 'stage', stage: 'contatado' }),
};

const ACTIONS: { id: StepAction; label: string }[] = [
  { id: 'continue', label: 'Continuar' },
  { id: 'stop', label: 'Parar a automação' },
  { id: 'task_and_stop', label: 'Criar tarefa e parar' },
  { id: 'skip_next', label: 'Pular a próxima etapa' },
];

export function CadenceEditorPage() {
  const { cadenceId } = useParams();
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const navigate = useNavigate();
  const original = db.cadences.find((c) => c.id === cadenceId);
  const [draft, setDraft] = useState<Cadence | null>(original ?? null);
  const [deleting, setDeleting] = useState(false);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);
  const inUse = original ? service.automation.cadenceInUse(original.id) : undefined;

  if (!original || !draft) return <EmptyState title="Cadência não encontrada" action={<Link to="/cadencias" className="btn-outline">Ver cadências</Link>} />;

  const setStep = (i: number, s: CadenceStep) => setDraft({ ...draft, steps: draft.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: -1 | 1) => {
    const steps = [...draft.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  };
  const add = (t: CadenceStep['type'], at = draft.steps.length) => {
    const steps = [...draft.steps];
    steps.splice(at, 0, NEW_STEP[t]());
    setDraft({ ...draft, steps });
  };
  let day = 0;

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 pb-24">
      <Link to="/cadencias" className="btn-ghost -ml-3 w-fit">
        <ArrowLeft className="h-4 w-4" /> Cadências
      </Link>
      <PageHeader
        title={draft.name || 'Cadência'}
        subtitle={inUse ? `Em uso na campanha “${inUse.name}”: mudanças valem para as próximas etapas dos leads.` : 'Monte a sequência na ordem em que deve acontecer.'}
      />

      <section className="card grid gap-3 px-5 py-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cad-name" className="label">Nome</label>
          <input id="cad-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="cad-desc" className="label">Descrição</label>
          <input id="cad-desc" className="input" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={draft.stopOnReply} onChange={(e) => setDraft({ ...draft, stopOnReply: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          Qualquer resposta do lead interrompe a cadência (recomendado). Respostas automáticas de ausência não contam.
        </label>
      </section>

      <ol className="flex flex-col">
        {draft.steps.map((s, i) => {
          const label = s.type === 'wait' ? null : `Dia ${day}`;
          if (s.type === 'wait') day += Number(s.days) || 0;
          return (
            <li key={s.id} className="flex flex-col items-stretch">
              {i > 0 && <div className="mx-auto h-5 w-px bg-line-strong" aria-hidden />}
              <StepCard
                step={s}
                index={i}
                dayLabel={label}
                total={draft.steps.length}
                onChange={(n) => setStep(i, n)}
                onMove={(d) => move(i, d)}
                onRemove={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
              />
            </li>
          );
        })}
      </ol>

      <div className="card flex flex-wrap items-center gap-2 px-5 py-4">
        <span className="text-sm font-bold">Adicionar etapa:</span>
        <button type="button" className="btn-outline" onClick={() => add('send')}><MessageCircle className="h-4 w-4" /> Mensagem</button>
        <button type="button" className="btn-outline" onClick={() => add('wait')}><Clock className="h-4 w-4" /> Aguardar</button>
        <button type="button" className="btn-outline" onClick={() => add('condition')}><GitBranch className="h-4 w-4" /> Condição</button>
        <button type="button" className="btn-outline" onClick={() => add('task')}><ListChecks className="h-4 w-4" /> Tarefa</button>
        <button type="button" className="btn-outline" onClick={() => add('stage')}><Workflow className="h-4 w-4" /> Mudar etapa</button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:left-[236px]">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-ink-faint">{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-bad" onClick={() => setDeleting(true)}>
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
            <button type="button" className="btn-outline" disabled={!dirty} onClick={() => setDraft(original)}>Descartar</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!dirty}
              onClick={() => {
                service.automation.saveCadence(draft);
                toast('Cadência salva.', 'success');
              }}
            >
              Salvar cadência
            </button>
          </div>
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Excluir esta cadência?"
          confirmLabel="Excluir"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            try {
              service.automation.deleteCadence(original.id);
              toast('Cadência excluída.');
              navigate('/cadencias');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Não foi possível excluir.', 'error');
            }
          }}
        >
          “{original.name}” será excluída. Campanhas que já terminaram continuam com o histórico.
        </ConfirmDialog>
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  dayLabel,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  step: CadenceStep;
  index: number;
  dayLabel: string | null;
  total: number;
  onChange: (s: CadenceStep) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = `st-${step.id}`;
  const tone =
    step.type === 'send' ? (step.channel === 'whatsapp' ? 'border-l-good' : 'border-l-ai') : step.type === 'condition' ? 'border-l-warn' : 'border-l-line-strong';
  const title =
    step.type === 'send' ? (step.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail') : step.type === 'wait' ? 'Aguardar' : step.type === 'condition' ? 'Condição' : step.type === 'task' ? 'Tarefa para a equipe' : 'Mudar etapa do lead';
  return (
    <div className={cx('card border-l-4 px-4 py-3', tone)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-ink-faint">{index + 1}</span>
          <span className="text-sm font-extrabold">{title}</span>
          {dayLabel && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-bold text-ink-soft">{dayLabel}</span>}
        </div>
        <div className="flex gap-0.5">
          <button type="button" className="btn-ghost min-h-[30px] px-1.5" aria-label="Subir etapa" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" className="btn-ghost min-h-[30px] px-1.5" aria-label="Descer etapa" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" className="btn-ghost min-h-[30px] px-1.5 hover:text-bad" aria-label="Remover etapa" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {step.type === 'send' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-ch`} className="label">Canal</label>
            <select id={`${id}-ch`} className="input" value={step.channel} onChange={(e) => onChange({ ...step, channel: e.target.value as 'whatsapp' | 'email' })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-mode`} className="label">Mensagem</label>
            <select id={`${id}-mode`} className="input" value={step.mode} onChange={(e) => onChange({ ...step, mode: e.target.value as 'ai' | 'template' })}>
              <option value="ai">Personalizada pela IA</option>
              <option value="template">Template com variáveis</option>
            </select>
          </div>
          {step.channel === 'email' && (
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-subj`} className="label">Assunto {step.mode === 'ai' && '(opcional: a IA sugere um)'}</label>
              <input id={`${id}-subj`} className="input" value={step.subject ?? ''} placeholder="Ex.: {{empresa}} + {{minha_empresa}}" onChange={(e) => onChange({ ...step, subject: e.target.value })} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-tpl`} className="label">{step.mode === 'ai' ? 'Instruções para a IA (opcional)' : 'Texto'}</label>
            <textarea
              id={`${id}-tpl`}
              rows={step.mode === 'ai' ? 2 : 4}
              className="input py-2"
              value={step.template}
              placeholder={step.mode === 'ai' ? 'Ex.: mencionar a safra; tom mais direto.' : 'Olá, {{nome}}! Vi que a {{empresa}} atua com {{segmento}} em {{cidade}}…'}
              onChange={(e) => onChange({ ...step, template: e.target.value })}
            />
            {step.mode === 'template' && (
              <p className="mt-1 text-xs text-ink-faint">
                Variáveis: {VARS.join(' ')}. Sem o dado, a variável vira um campo entre colchetes para você completar; nada é inventado.
              </p>
            )}
          </div>
          {step.channel === 'whatsapp' && (
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-wt`} className="label">Template aprovado na Meta</label>
              <input id={`${id}-wt`} className="input font-mono" value={step.whatsappTemplate ?? ''} placeholder="ex.: prospeccao_inicial" onChange={(e) => onChange({ ...step, whatsappTemplate: e.target.value })} />
              <p className="mt-1 text-xs text-ink-faint">
                A Meta exige template aprovado para iniciar conversa. Envio automático só para leads com opt-in; os demais viram tarefa com o link pronto.
              </p>
            </div>
          )}
        </div>
      )}

      {step.type === 'wait' && (
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor={`${id}-days`} className="sr-only">Dias</label>
          <input id={`${id}-days`} type="number" min={0} max={90} className="input w-24" value={step.days} onChange={(e) => onChange({ ...step, days: Number(e.target.value) })} />
          <span className="text-sm text-ink-soft">dias</span>
        </div>
      )}

      {step.type === 'condition' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${id}-if`} className="label">Se o lead…</label>
            <select id={`${id}-if`} className="input" value={step.condition} onChange={(e) => onChange({ ...step, condition: e.target.value as 'replied' | 'interested' | 'read' })}>
              <option value="replied">respondeu</option>
              <option value="interested">demonstrou interesse</option>
              <option value="read">leu a mensagem</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-t`} className="label">Então</label>
            <select id={`${id}-t`} className="input" value={step.ifTrue} onChange={(e) => onChange({ ...step, ifTrue: e.target.value as StepAction })}>
              {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-f`} className="label">Senão</label>
            <select id={`${id}-f`} className="input" value={step.ifFalse} onChange={(e) => onChange({ ...step, ifFalse: e.target.value as StepAction })}>
              {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {step.type === 'task' && (
        <div className="mt-3">
          <label htmlFor={`${id}-task`} className="label">Título da tarefa</label>
          <input id={`${id}-task`} className="input" value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} />
        </div>
      )}

      {step.type === 'stage' && (
        <div className="mt-3">
          <label htmlFor={`${id}-stage`} className="label">Mover o lead para</label>
          <select id={`${id}-stage`} className="input" value={step.stage} onChange={(e) => onChange({ ...step, stage: e.target.value })}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-faint">{describeStep(step)}</p>
    </div>
  );
}
