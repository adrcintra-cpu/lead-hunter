import { Bot, Check } from 'lucide-react';
import type { Lead } from '@/core/types';
import { formatDateTime } from '@/core/utils';
import { cx } from '@/components/ui';
import {
  BEELIE_STAGES,
  FACT_LABEL,
  INTENT_LABEL,
  NEED_AREAS,
  TEMPERATURE_LABEL,
  readIntel,
  type FactField,
  type Temperature,
} from '../../../supabase/functions/_shared/automation/beelie.ts';

const TEMP_CLASS: Record<Temperature, string> = {
  frio: 'bg-muted text-ink-soft',
  morno: 'bg-warn-soft text-warn',
  quente: 'bg-bad/10 text-bad',
};

/** Selo discreto de temperatura (pipeline e lista). */
export function TemperatureChip({ lead, className }: { lead: Lead; className?: string }) {
  if (!lead.beelie) return null;
  const t = readIntel(lead.beelie).temperature;
  return <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-bold', TEMP_CLASS[t], className)}>{TEMPERATURE_LABEL[t]}</span>;
}

/** Fatos que já aparecem no cartão de contato ou em outra linha do painel. */
const HIDDEN: FactField[] = ['is_right_person', 'need', 'referred_name', 'referred_role', 'referred_contact'];

/** Inteligência comercial do Beelie: estágio, temperatura, necessidade e o que ele aprendeu na conversa. */
export function BeeliePanel({ lead }: { lead: Lead }) {
  if (!lead.beelie) {
    return (
      <section className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-ink-faint">
        <span className="flex items-center gap-2 font-bold text-ink-soft"><Bot className="h-4 w-4" /> Beelie</span>
        Quando o lead responder, o Beelie anota aqui com quem está falando, a necessidade e o estágio da conversa.
      </section>
    );
  }
  const intel = readIntel(lead.beelie);
  const stageIdx = BEELIE_STAGES.findIndex((s) => s.id === intel.stage);
  const steps = BEELIE_STAGES.filter((s) => s.id !== 'encerrado');
  const referred = intel.facts.referred_name?.value;
  const facts = (Object.entries(intel.facts) as [FactField, NonNullable<(typeof intel.facts)[FactField]>][]).filter(([f]) => !HIDDEN.includes(f));
  const updates = intel.learned.filter((l) => l.applied).slice(0, 3);

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold"><Bot className="h-4 w-4" /> Inteligência comercial · Beelie</h3>
        <span className={cx('rounded-md px-2 py-0.5 text-xs font-bold', TEMP_CLASS[intel.temperature])}>{TEMPERATURE_LABEL[intel.temperature]}</span>
      </div>

      {intel.stage === 'encerrado' ? (
        <p className="mt-2 text-[13px] font-semibold text-bad">Conversa encerrada: o lead recusou ou pediu para não ser contatado.</p>
      ) : (
        <ol className="mt-3 flex gap-1" aria-label={`Estágio: ${BEELIE_STAGES[stageIdx]?.label}`}>
          {steps.map((s, i) => (
            <li key={s.id} className="min-w-0 flex-1">
              <div className={cx('h-1.5 rounded-full', i <= stageIdx ? 'bg-accent' : 'bg-muted')} />
              <div className={cx('mt-1 truncate text-[10.5px]', i === stageIdx ? 'font-bold text-ink' : 'text-ink-faint')}>{s.label}</div>
            </li>
          ))}
        </ol>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-faint">Necessidade</dt>
        <dd>{intel.needArea ? NEED_AREAS[intel.needArea] : intel.need ?? <span className="text-ink-faint">ainda não identificada</span>}</dd>
        <dt className="text-ink-faint">Responsável certo?</dt>
        <dd>
          {intel.rightPerson === true ? 'Sim' : intel.rightPerson === false ? 'Não' : <span className="text-ink-faint">não confirmado</span>}
          {referred && (
            <span className="text-ink-soft">
              {' '}· indicou <strong>{referred}</strong>
              {intel.facts.referred_role ? ` (${intel.facts.referred_role.value})` : ''}
              {intel.facts.referred_contact ? ` · ${intel.facts.referred_contact.value}` : ''}
            </span>
          )}
        </dd>
        {intel.lastIntent && (
          <>
            <dt className="text-ink-faint">Última resposta</dt>
            <dd>{INTENT_LABEL[intel.lastIntent]}{lead.lastContactAt ? ` · ${formatDateTime(lead.lastContactAt)}` : ''}</dd>
          </>
        )}
        {lead.nextAction && (
          <>
            <dt className="text-ink-faint">Próxima ação</dt>
            <dd>{lead.nextAction}</dd>
          </>
        )}
        {intel.objections.length > 0 && (
          <>
            <dt className="text-ink-faint">Objeções</dt>
            <dd>{intel.objections.join(' · ')}</dd>
          </>
        )}
      </dl>

      {facts.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="text-[11.5px] font-bold uppercase tracking-wide text-ink-faint">Informações identificadas pelo Beelie</div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px]">
            {facts.map(([f, v]) => (
              <li key={f} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-ink-faint">{FACT_LABEL[f]}:</span>
                <span className="font-semibold">{v.value}</span>
                {v.source === 'humano' ? (
                  <span className="text-[11px] text-ink-faint">corrigido por você</span>
                ) : v.status === 'confirmado' ? (
                  <Check className="h-3.5 w-3.5 text-good" aria-label="confirmado" />
                ) : (
                  <span className="rounded bg-muted px-1 text-[10.5px] font-semibold text-ink-soft">provável</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {updates.length > 0 && (
        <p className="mt-2.5 text-[12px] text-ink-faint">
          Cadastro atualizado pelo Beelie: {updates.map((u) => `${u.label} → ${u.value}`).join(', ')} · {formatDateTime(updates[0].at)}. Se algo estiver errado, corrija em “Contato e CRM”: sua correção tem prioridade.
        </p>
      )}
    </section>
  );
}
