import { useEffect, useState } from 'react';
import { formatDateTime } from '@/core/utils';
import { cx } from '@/components/ui';
import { ATTENDANCE_LABEL, menuNavApi, NAV_STATUS_LABEL, type MenuNavigation } from '@/services/navigation/menuNavApi';
import { Fold } from './Fold';

const GOOD = ['ATENDIMENTO_HUMANO_PROVAVEL', 'CONTATO_COMERCIAL_INICIADO', 'RESPONSAVEL_IDENTIFICADO'];
const BAD = ['BLOQUEADO_POR_CHATBOT', 'SEM_RESPOSTA'];

/** Caminho resumido: "Menu detectado → Vendas → Transferência → Atendimento humano". */
function trail(n: MenuNavigation): string[] {
  const out = ['Menu detectado'];
  for (const p of n.path) {
    if (p.kind === 'menu' && p.chosen) out.push(p.chosen.label);
    else if (p.kind === 'dados') out.push('Identificação');
    else if (p.kind === 'transferencia') out.push('Transferência');
    else if (p.kind === 'humano' && !out.includes('Atendimento humano')) out.push('Atendimento humano');
    else if (p.kind === 'responsavel') out.push('Responsável');
    else if (p.kind === 'bloqueio') out.push(n.status === 'SEM_RESPOSTA' ? 'Sem resposta' : 'Bloqueado');
  }
  return out;
}

/** Perfil do lead: navegação do BEELIE no atendimento automático (só aparece quando houve uma). */
export function MenuNavFold({ leadId }: { leadId: string }) {
  const [nav, setNav] = useState<MenuNavigation | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void menuNavApi.latest(leadId).then((n) => alive && setNav(n)).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [leadId]);
  if (!nav) return null;

  const tone = GOOD.includes(nav.status) ? 'text-good' : BAD.includes(nav.status) ? 'text-bad' : 'text-ink';
  return (
    <Fold leadId={leadId} id="navegacao" title="Atendimento automático" summary={NAV_STATUS_LABEL[nav.status]}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-faint">Tipo de atendimento</dt>
        <dd className="font-semibold">{ATTENDANCE_LABEL[nav.attendance]}</dd>
        <dt className="text-ink-faint">Navegação</dt>
        <dd className="font-semibold">{trail(nav).join(' → ')}</dd>
        <dt className="text-ink-faint">Status</dt>
        <dd className={cx('font-semibold', tone)}>{NAV_STATUS_LABEL[nav.status]} · {nav.steps} {nav.steps === 1 ? 'etapa' : 'etapas'}</dd>
        {nav.nextAction && (
          <>
            <dt className="text-ink-faint">Próxima ação</dt>
            <dd className="font-semibold">{nav.nextAction}</dd>
          </>
        )}
        {nav.contact?.nome && (
          <>
            <dt className="text-ink-faint">Responsável</dt>
            <dd className="font-semibold">{[nav.contact.nome, nav.contact.departamento, nav.contact.telefone, nav.contact.email].filter(Boolean).join(' · ')}</dd>
          </>
        )}
        {nav.humanEvidence && (
          <>
            <dt className="text-ink-faint">Evidência de pessoa</dt>
            <dd>{nav.humanEvidence}</dd>
          </>
        )}
      </dl>
      {nav.path.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer select-none text-ink-faint">Histórico da navegação</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {nav.path.map((p, i) => (
              <li key={i} className="rounded-lg border border-line px-3 py-2">
                <div className="text-xs text-ink-faint">{formatDateTime(p.at)}</div>
                <div>{p.reason}</div>
                <div className="text-ink-soft">{p.result}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Fold>
  );
}
