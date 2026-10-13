import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '@/components/ui';
import { suggestSegments } from './segments';

/** Segmento: lista pronta (abre ao clicar, filtra ao digitar) e aceita um segmento digitado. */
export function SegmentInput({ id, className, value, extra, onCommit }: { id: string; className?: string; value: string; extra?: string[]; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const options = useMemo(() => (open ? suggestSegments(text ?? '', extra) : []), [open, text, extra]);
  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (v: string) => {
    setText(null);
    setOpen(false);
    onCommit(v);
  };
  const commitTyped = () => {
    setOpen(false);
    if (text === null) return;
    const t = text.trim();
    setText(null);
    if (t) onCommit(t);
  };

  let lastGroup = '';
  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        className={cx(className, 'w-full pr-9')}
        value={text ?? value}
        placeholder="Escolha ou digite o segmento"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(commitTyped, 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(0, options.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = text !== null || open ? options[active] : undefined;
            if (o) pick(o.name);
            else commitTyped();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      {options.length > 0 && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {options.map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={`${o.group}-${o.name}`} role="presentation">
                {header && <div className="px-3 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">{header}</div>}
                <div
                  role="option"
                  data-i={i}
                  aria-selected={i === active}
                  className={cx('cursor-pointer px-3 py-1.5 text-sm', i === active ? 'bg-accent-soft text-ink' : 'hover:bg-muted')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.name);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {o.name}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
