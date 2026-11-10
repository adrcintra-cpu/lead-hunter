import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Clapperboard, FileText, LayoutGrid, Radar, Workflow, type LucideIcon } from 'lucide-react';
import { cx } from '@/components/ui';

/**
 * Menu "Oxyhub": volta ao painel único e troca de sistema sem novo login.
 * Os links passam pelo hub (/abrir/…), que abre cada sistema já logado.
 */
import { HUB_URL as HUB } from '@/lib/oxyhub';

type SystemId = 'aprovacao' | 'lead' | 'coody' | 'proposals';
const SYSTEMS: { id: SystemId; name: string; description: string; icon: LucideIcon }[] = [
  { id: 'aprovacao', name: 'Aprovação de conteúdo', description: 'Planejamento e aprovação', icon: Workflow },
  { id: 'lead', name: 'Lead Hunter', description: 'Prospecção e pipeline', icon: Radar },
  { id: 'coody', name: 'Coody', description: 'Workspace criativo', icon: Clapperboard },
  { id: 'proposals', name: 'Oxycom Proposals', description: 'Propostas comerciais', icon: FileText },
];
const CURRENT: SystemId = 'lead';

function Items() {
  return (
    <>
      <a href={HUB} className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 hover:bg-ink/5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-white">
          <LayoutGrid className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-ink">Painel Oxyhub</span>
          <span className="block text-xs text-ink-faint">Pendências de todos os sistemas</span>
        </span>
      </a>
      <div className="my-1 h-px bg-ink/10" />
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">Sistemas</p>
      {SYSTEMS.map((s) => {
        const here = s.id === CURRENT;
        const Icon = s.icon;
        const body = (
          <>
            <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', here ? 'bg-accent/10 text-accent' : 'bg-ink/5 text-ink-soft')}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{s.name}</span>
              <span className="block text-xs text-ink-faint">{here ? 'Você está aqui' : s.description}</span>
            </span>
            {here && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
          </>
        );
        return here ? (
          <div key={s.id} aria-current="page" className="flex items-center gap-3 rounded-[12px] px-3 py-2">
            {body}
          </div>
        ) : (
          <a key={s.id} href={`${HUB}/abrir/${s.id}`} className="flex items-center gap-3 rounded-[12px] px-3 py-2 hover:bg-ink/5">
            {body}
          </a>
        );
      })}
    </>
  );
}

/** Lista simples (gaveta do celular). */
export function OxyhubSystemsList() {
  return (
    <nav aria-label="Sistemas Oxyhub" className="flex flex-col">
      <Items />
    </nav>
  );
}

/** Botão da barra lateral que abre o menu para cima. */
export function OxyhubSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="glass-chip flex min-h-[40px] w-full items-center gap-2.5 rounded-full px-3.5 text-sm font-semibold text-ink"
      >
        <LayoutGrid className="h-[18px] w-[18px]" aria-hidden />
        Sistemas Oxyhub
        <ChevronUp className={cx('ml-auto h-4 w-4 text-ink-faint transition-transform', !open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute bottom-full left-0 z-50 mb-2 w-72 rounded-[18px] p-1.5 shadow-2xl">
          <Items />
        </div>
      )}
    </div>
  );
}
