import { useEffect, useMemo, useState } from 'react';
import { cx } from '@/components/ui';
import { loadCities, suggestCities, type City } from './cities';

/** Campo de cidade com autocomplete (todos os municípios do Brasil). Escolher uma sugestão já preenche o estado. */
export function CityInput({
  id,
  className,
  value,
  uf,
  placeholder,
  onCommit,
}: {
  id: string;
  className?: string;
  value: string;
  uf: string | null;
  placeholder?: string;
  /** Texto final do campo e, quando veio de uma sugestão, o estado dela. */
  onCommit: (city: string, uf: string | null | undefined) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [list, setList] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = text ?? value;
  const options = useMemo(() => (open && text !== null ? suggestCities(list, text, uf) : []), [open, text, list, uf]);
  useEffect(() => setActive(0), [text]);

  const pick = (c: City) => {
    setText(null);
    setOpen(false);
    onCommit(c.name, c.uf);
  };
  const commitTyped = () => {
    setOpen(false);
    if (text === null) return;
    const t = text;
    setText(null);
    onCommit(t, undefined);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        className={cx(className, 'w-full')}
        value={shown}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          void loadCities().then(setList);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(commitTyped, 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[active];
            if (o) pick(o);
            else commitTyped();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {options.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {options.map((o, i) => (
            <li
              key={`${o.name}-${o.uf}`}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-1.5 text-sm', i === active ? 'bg-accent-soft text-ink' : 'hover:bg-muted')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.name}
              <span className="text-ink-faint">/{o.uf}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
