import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useDb, useService } from '@/store/AppStore';
import { cx } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { instagramApi } from '@/services/instagram/instagramApi';

type ChannelKey = 'whatsapp' | 'email' | 'instagram';
type Metric = 'enviadas' | 'respostas';
const PERIODS = [7, 15, 30] as const;

const CHANNELS: { key: ChannelKey; label: string; color: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', color: 'var(--ch-whatsapp)' },
  { key: 'email', label: 'E-mail', color: 'var(--ch-email)' },
  { key: 'instagram', label: 'Instagram', color: 'var(--ch-instagram)' },
];

const TZ = 'America/Sao_Paulo';
/** Dia no fuso de São Paulo, no formato AAAA-MM-DD. */
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

type IgRow = { direction: 'entrada' | 'saida'; status: string; createdAt: string };

/** Escala "redonda" para o eixo Y (0, 5, 10… / 0, 25, 50…). */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => v <= s * 4) ?? 10 * pow;
  return step * 4;
}

/**
 * Mensagens por dia em cada canal (WhatsApp, e-mail e Instagram), nos últimos 7, 15 ou 30 dias.
 * WhatsApp e e-mail vêm das mensagens e respostas já carregadas; o Instagram é lido da tabela do módulo.
 */
export function ChannelChart() {
  const db = useDb();
  const service = useService();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30);
  const [metric, setMetric] = useState<Metric>('enviadas');
  const [ig, setIg] = useState<IgRow[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Busca sempre 30 dias do Instagram; os filtros de 15 e 7 recortam localmente.
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const since = new Date(service.now().getTime() - 31 * 864e5).toISOString();
    const load = () => void instagramApi.activity(since).then((r) => alive && setIg(r)).catch(() => alive && setIg([]));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [service]);

  const days = useMemo(() => {
    const now = service.now().getTime();
    return Array.from({ length: period }, (_, i) => dayKey(new Date(now - (period - 1 - i) * 864e5)));
  }, [period, service, db.clockOffsetMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo(() => {
    const idx = new Map(days.map((d, i) => [d, i]));
    const out: Record<ChannelKey, number[]> = { whatsapp: days.map(() => 0), email: days.map(() => 0), instagram: days.map(() => 0) };
    const add = (ch: ChannelKey, iso: string | undefined | null) => {
      if (!iso) return;
      const i = idx.get(dayKey(new Date(iso)));
      if (i !== undefined) out[ch][i] += 1;
    };
    if (metric === 'enviadas') {
      for (const m of db.messages) if (m.sentAt && (m.channel === 'whatsapp' || m.channel === 'email')) add(m.channel, m.sentAt);
      for (const r of ig ?? []) if (r.direction === 'saida' && r.status === 'enviada') add('instagram', r.createdAt);
    } else {
      for (const r of db.inbound) if (r.channel === 'whatsapp' || r.channel === 'email') add(r.channel, r.receivedAt);
      for (const r of ig ?? []) if (r.direction === 'entrada') add('instagram', r.createdAt);
    }
    return out;
  }, [days, metric, db.messages, db.inbound, ig]);

  const totals = Object.fromEntries(CHANNELS.map((c) => [c.key, series[c.key].reduce((a, b) => a + b, 0)])) as Record<ChannelKey, number>;
  const max = niceMax(Math.max(...CHANNELS.flatMap((c) => series[c.key])));

  // Geometria
  const H = 200;
  const pad = { top: 10, right: 12, bottom: 24, left: 34 };
  const iw = width - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k);
  const labelEvery = days.length <= 7 ? 1 : days.length <= 15 ? (width < 420 ? 3 : 2) : width < 420 ? 7 : 5;

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.left) / iw) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  }

  const segBtn = (active: boolean) =>
    cx('min-h-[32px] rounded-md px-2.5 text-xs font-semibold transition-colors', active ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink');

  return (
    <section className="card px-4 py-4 md:px-5" aria-labelledby="ch-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ch-title" className="text-[15px] font-bold">
          Mensagens por canal
        </h2>
        <div className="flex flex-wrap gap-2">
          <div role="radiogroup" aria-label="O que mostrar" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
            {(['enviadas', 'respostas'] as Metric[]).map((mt) => (
              <button key={mt} type="button" role="radio" aria-checked={metric === mt} className={segBtn(metric === mt)} onClick={() => setMetric(mt)}>
                {mt === 'enviadas' ? 'Enviadas' : 'Respostas'}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Período" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={segBtn(period === p)} onClick={() => setPeriod(p)}>
                {p} dias
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legenda com o total do período (identidade não depende só da cor) */}
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {CHANNELS.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[13px] text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden />
            {c.label}
            <span className="font-mono font-semibold tabular-nums text-ink">{c.key === 'instagram' && ig === null && supabase ? '…' : totals[c.key]}</span>
          </li>
        ))}
      </ul>

      <div ref={wrap} className="relative mt-2">
        <svg
          width={width}
          height={H}
          className="block touch-pan-y select-none"
          role="img"
          aria-label={`${metric === 'enviadas' ? 'Mensagens enviadas' : 'Respostas recebidas'} por dia nos últimos ${period} dias: ${CHANNELS.map((c) => `${c.label} ${totals[c.key]}`).join(', ')}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-faint font-mono text-[10.5px] tabular-nums">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            (days.length - 1 - i) % labelEvery === 0 ? (
              <text key={d} x={x(i)} y={H - 6} textAnchor={i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="fill-ink-faint text-[10.5px]">
                {dayLabel(d)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} className="stroke-line-strong" strokeWidth={1} />}
          {CHANNELS.map((c) => (
            <polyline
              key={c.key}
              points={series[c.key].map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={c.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null &&
            CHANNELS.map((c) => (
              <circle key={c.key} cx={x(hover)} cy={y(series[c.key][hover])} r={4.5} fill={c.color} className="stroke-surface" strokeWidth={2} />
            ))}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-[150px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
          >
            <div className="mb-1 font-semibold text-ink">{dayLabel(days[hover])}</div>
            {CHANNELS.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden />
                  {c.label}
                </span>
                <span className="font-mono font-semibold tabular-nums text-ink">{series[c.key][hover]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-ink-faint">
        <summary className="cursor-pointer select-none">Ver em tabela</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="text-ink-soft">
                <th className="py-1 font-semibold">Dia</th>
                {CHANNELS.map((c) => <th key={c.key} className="py-1 text-right font-semibold">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d, ri) => {
                const i = days.length - 1 - ri;
                return (
                  <tr key={d} className="border-t border-line">
                    <td className="py-1">{dayLabel(d)}</td>
                    {CHANNELS.map((c) => <td key={c.key} className="py-1 text-right font-mono text-ink">{series[c.key][i]}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
