import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '@/components/ui';

/** Dentro de uma seção recolhível o título já aparece no cabeçalho: o painel esconde o próprio título. */
const InFold = createContext(false);

/** Título de painel: some quando o painel está dentro de um Fold (o cabeçalho do Fold já mostra). */
export function PanelTitle({ children, className }: { children: ReactNode; className?: string }) {
  if (useContext(InFold)) return null;
  return <h3 className={cx('text-sm font-extrabold', className)}>{children}</h3>;
}

const seenKey = (leadId: string, id: string) => `lh-seen:${leadId}:${id}`;

/** Quando a seção foi aberta pela última vez neste navegador (só uma data; nada sensível). */
export function lastSeen(leadId: string, id: string): string | null {
  try {
    return localStorage.getItem(seenKey(leadId, id));
  } catch {
    return null;
  }
}

function markSeen(leadId: string, id: string) {
  try {
    localStorage.setItem(seenKey(leadId, id), new Date().toISOString());
  } catch {
    /* sem armazenamento: os contadores só não zeram */
  }
}

/** Data de corte dos contadores: última abertura da seção ou, se nunca abriu, os últimos 3 dias. */
export function since(leadId: string, id: string): string {
  return lastSeen(leadId, id) ?? new Date(Date.now() - 3 * 864e5).toISOString();
}

/**
 * Seção do perfil do lead, fechada por padrão. A seta abre e fecha.
 * Contadores: azul = novidades positivas, vermelho = negativas, desde a última vez que a seção foi aberta.
 */
export function Fold({
  leadId,
  id,
  title,
  icon,
  positive = 0,
  negative = 0,
  summary,
  children,
}: {
  leadId: string;
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  positive?: number;
  negative?: number;
  /** Uma linha curta mostrada com a seção fechada (ex.: estágio, campanha). */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [badges, setBadges] = useState(true);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      markSeen(leadId, id);
      setBadges(false);
    }
  };
  const pos = badges ? positive : 0;
  const neg = badges ? negative : 0;
  return (
    <section className="rounded-xl border border-line">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`fold-${id}`}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left hover:bg-muted/50"
      >
        {icon}
        <span className="text-sm font-extrabold">{title}</span>
        {pos > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-white" title={`${pos} novidade(s) positiva(s)`}>
            +{pos}
          </span>
        )}
        {neg > 0 && (
          <span className="rounded-full bg-bad px-1.5 py-0.5 text-[11px] font-bold leading-none text-white" title={`${neg} novidade(s) negativa(s)`}>
            −{neg}
          </span>
        )}
        {!open && summary && <span className="ml-1 min-w-0 truncate text-[12.5px] text-ink-faint">{summary}</span>}
        <ChevronDown className={cx('ml-auto h-4 w-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={`fold-${id}`} className="border-t border-line px-4 pb-4 pt-3 [&>section]:rounded-none [&>section]:border-0 [&>section]:p-0">
          <InFold.Provider value>{children}</InFold.Provider>
        </div>
      )}
    </section>
  );
}
