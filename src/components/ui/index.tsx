import type { ReactNode } from 'react';
import { Loader2, Monitor, Moon, Sun, X } from 'lucide-react';
import type { ScoreTier, WhatsappStatus } from '@/core/types';
import { TIER_LABEL } from '@/core/scoring';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { useApp } from '@/store/AppStore';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

const tierClass: Record<ScoreTier, string> = {
  alta: 'bg-good-soft text-good',
  media: 'bg-warn-soft text-warn',
  baixa: 'bg-muted text-ink-soft',
};

export function ScoreBadge({ score, tier, showLabel = false }: { score: number; tier: ScoreTier; showLabel?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold', tierClass[tier])} title={TIER_LABEL[tier]}>
      <span className="font-mono text-[13px] font-semibold">{score}</span>
      {showLabel && <span>{TIER_LABEL[tier]}</span>}
    </span>
  );
}

const waClass: Record<WhatsappStatus, string> = {
  confirmado: 'bg-good-soft text-good',
  provavel: 'bg-warn-soft text-warn',
  desconhecido: 'bg-muted text-ink-soft',
};
const waLabel: Record<WhatsappStatus, string> = { confirmado: 'Confirmado', provavel: 'Provável', desconhecido: 'Desconhecido' };

export function WhatsappBadge({ status, hasNumber }: { status: WhatsappStatus; hasNumber: boolean }) {
  const s = hasNumber ? status : 'desconhecido';
  return <span className={cx('inline-flex rounded-md px-2 py-0.5 text-xs font-bold', waClass[s])}>{hasNumber ? waLabel[s] : 'Não encontrado'}</span>;
}

export type ProvenanceKind = 'found' | 'inference' | 'unavailable';

export function ProvenanceTag({ kind, title }: { kind: ProvenanceKind; title?: string }) {
  const map = {
    found: ['Dado encontrado', 'bg-good-soft text-good border-transparent'],
    inference: ['Inferência da IA', 'bg-ai-soft text-ai border-transparent'],
    unavailable: ['Não disponível', 'bg-muted text-ink-soft border-dashed border-line-strong'],
  } as const;
  const [label, cls] = map[kind];
  return (
    <span title={title} className={cx('inline-flex shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-bold', cls)}>
      {label}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className ?? 'h-4 w-4')} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-muted', className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <h3 className="text-base font-bold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-ink-faint">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-faint">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  const opts: { id: ThemePreference; label: string; icon: ReactNode }[] = [
    { id: 'light', label: 'Claro', icon: <Sun className="h-4 w-4" /> },
    { id: 'dark', label: 'Escuro', icon: <Moon className="h-4 w-4" /> },
    { id: 'system', label: 'Sistema', icon: <Monitor className="h-4 w-4" /> },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={preference === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => setPreference(o.id)}
          className={cx(
            'inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors',
            preference === o.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
          )}
        >
          {o.icon}
          {!compact && o.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[min(92vw,460px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm font-semibold shadow-pop',
            t.tone === 'error' ? 'bg-bad text-white dark:text-bg' : 'bg-inverse text-inverse-ink',
          )}
        >
          <span className="flex-1">{t.text}</span>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Fechar aviso" className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="btn bg-bad text-white hover:opacity-90 dark:text-bg"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">{children}</p>
    </Modal>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-label={title} className={`card relative z-10 max-h-[90vh] w-full overflow-y-auto p-5 shadow-pop ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <h2 className="text-lg font-extrabold">{title}</h2>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
