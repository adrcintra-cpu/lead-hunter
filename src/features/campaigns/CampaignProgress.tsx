import { useMemo, useState } from 'react';
import { useDb, useService } from '@/store/AppStore';
import type { Cadence } from '@/core/types';
import { cx } from '@/components/ui';

/** Dia no fuso de Brasília (YYYY-MM-DD). */
const dayBRT = (iso: string | Date) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const labelDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

interface DbLike {
  messages: { leadId: string; campaignId?: string; sentAt?: string; stepIndex?: number; channel: string; status?: string }[];
  inbound: { leadId: string; campaignId?: string; receivedAt: string; classification?: string }[];
  enrollments: { campaignId: string; leadId: string; status: string; stepIndex: number }[];
}

/**
 * Evolução de uma campanha: envios e respostas por dia, funil e desempenho por etapa.
 * Função pura (testável): recebe os dados e o "agora".
 */
export function campaignProgress(db: DbLike, campaignId: string, days: number, now: Date, cadence?: Pick<Cadence, 'steps'>) {
  const sent = db.messages.filter((m) => m.campaignId === campaignId && m.sentAt);
  const replies = db.inbound.filter((r) => r.campaignId === campaignId && r.classification !== 'ausente');
  const ens = db.enrollments.filter((e) => e.campaignId === campaignId);

  // Eixo de dias: os últimos N dias até hoje.
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayBRT(new Date(now.getTime() - i * 864e5)));
  const perDay = new Map(keys.map((k) => [k, { day: k, sent: 0, replies: 0 }]));
  for (const m of sent) {
    const d = perDay.get(dayBRT(m.sentAt!));
    if (d) d.sent++;
  }
  for (const r of replies) {
    const d = perDay.get(dayBRT(r.receivedAt));
    if (d) d.replies++;
  }

  const contacted = new Set(sent.map((m) => m.leadId));
  const replied = new Set(replies.map((r) => r.leadId));
  const interested = new Set(replies.filter((r) => r.classification === 'interessado' || r.classification === 'reuniao').map((r) => r.leadId));
  const funnel = [
    { label: 'Na campanha', value: ens.length },
    { label: 'Contatados', value: contacted.size },
    { label: 'Responderam', value: replied.size },
    { label: 'Interessados', value: interested.size },
  ];

  // Por etapa: a resposta conta para a última mensagem enviada ao lead antes dela.
  const steps = (cadence?.steps ?? [])
    .map((s, i) => ({ s, i }))
    .flatMap(({ s, i }) => (s.type === 'send' ? [{ channel: s.channel, i }] : []))
    .map(({ channel, i }, n) => {
      const stepSent = sent.filter((m) => m.stepIndex === i);
      // WhatsApp sem envio automático: mensagem pronta esperando o clique do usuário.
      const stepManual = db.messages.filter((m) => m.campaignId === campaignId && m.stepIndex === i && !m.sentAt && (m.status === 'draft' || m.status === 'opened_whatsapp'));
      const stepReplies = replies.filter((r) => {
        const before = sent.filter((m) => m.leadId === r.leadId && m.sentAt! <= r.receivedAt).sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))[0];
        return before?.stepIndex === i;
      });
      return {
        index: i,
        label: `${n + 1}ª mensagem · ${channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}`,
        sent: stepSent.length,
        replies: new Set(stepReplies.map((r) => r.leadId)).size,
        manual: stepManual.length,
        // Leads ainda na cadência que não chegaram a esta etapa.
        waiting: ens.filter((e) => e.status === 'ativa' && !stepSent.some((m) => m.leadId === e.leadId) && !stepManual.some((m) => m.leadId === e.leadId)).length,
      };
    });

  return { days: [...perDay.values()], funnel, steps, totals: { sent: sent.length, replies: replied.size } };
}

const SERIES = [
  { key: 'sent' as const, label: 'Enviadas', color: 'rgb(var(--viz-1))' },
  { key: 'replies' as const, label: 'Respostas', color: 'rgb(var(--viz-2))' },
];

/** Escala "bonita" para o eixo: 1, 2, 5, 10, 20, 50… */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) ?? v;
}

export function CampaignProgress({ campaignId }: { campaignId: string }) {
  const db = useDb();
  const service = useService();
  const [days, setDays] = useState(14);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const camp = db.campaigns.find((c) => c.id === campaignId);
  const cad = camp && db.cadences.find((c) => c.id === camp.cadenceId);
  const data = useMemo(
    () => campaignProgress(db, campaignId, days, service.now(), cad),
    [db, campaignId, days, service, cad],
  );
  const max = niceMax(Math.max(1, ...data.days.map((d) => Math.max(d.sent, d.replies))));
  const ticks = [max, max / 2, 0];
  const empty = data.totals.sent === 0 && data.totals.replies === 0;
  const funnelMax = Math.max(1, data.funnel[0].value);
  const showLabelEvery = days > 14 ? 5 : 2;

  return (
    <section className="card px-5 py-5" aria-labelledby="evo-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="evo-title" className="text-[15px] font-extrabold">Evolução</h2>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Período" className="flex rounded-lg border border-line p-0.5">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={days === n}
                onClick={() => setDays(n)}
                className={cx('min-h-[30px] rounded-md px-2.5 text-xs font-bold', days === n ? 'bg-inverse text-inverse-ink' : 'text-ink-soft hover:bg-muted')}
              >
                {n} dias
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost min-h-[32px] px-2.5 text-xs" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Envios e respostas por dia */}
        <div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-soft" aria-hidden={table}>
            <span className="font-bold text-ink">Por dia</span>
            {SERIES.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label} <span className="font-mono text-ink">{s.key === 'sent' ? data.totals.sent : data.totals.replies}</span>
              </span>
            ))}
          </div>

          {table ? (
            <div className="mt-3 max-h-[260px] overflow-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-subtle text-xs text-ink-faint">
                  <tr><th className="px-3 py-2 text-left font-semibold">Dia</th><th className="px-3 py-2 text-right font-semibold">Enviadas</th><th className="px-3 py-2 text-right font-semibold">Respostas</th></tr>
                </thead>
                <tbody>
                  {[...data.days].reverse().map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="px-3 py-1.5">{labelDay(d.day)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{d.sent}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{d.replies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="relative mt-3" role="img" aria-label={`Envios e respostas por dia nos últimos ${days} dias: ${data.totals.sent} enviadas, ${data.totals.replies} respostas.`}>
              <div className="flex h-[200px]">
                {/* eixo Y */}
                <div className="flex w-7 shrink-0 flex-col justify-between pb-5 pr-1.5 text-right font-mono text-[10.5px] text-ink-faint">
                  {ticks.map((t) => <span key={t} className="-translate-y-1/2 leading-none">{Number.isInteger(t) ? t : t.toFixed(1)}</span>)}
                </div>
                <div className="relative flex-1">
                  {/* grade */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-5 top-0 flex flex-col justify-between">
                    {ticks.map((t) => <div key={t} className={cx('border-t', t === 0 ? 'border-line-strong' : 'border-dashed border-line')} />)}
                  </div>
                  <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
                    {data.days.map((d, i) => (
                      <div
                        key={d.day}
                        className={cx('relative flex flex-1 flex-col', hover === i && 'bg-muted/60')}
                        onMouseEnter={() => setHover(i)}
                      >
                        <div className="flex flex-1 items-end justify-center gap-[2px] px-[12%]">
                          {SERIES.map((s) => {
                            const v = d[s.key];
                            return (
                              <div
                                key={s.key}
                                className="w-full max-w-[14px] rounded-t-[4px]"
                                style={{ height: v ? `max(3px, ${(v / max) * 100}%)` : 0, background: s.color }}
                              />
                            );
                          })}
                        </div>
                        <div className="h-5 pt-1 text-center font-mono text-[10px] text-ink-faint">
                          {(i % showLabelEvery === (data.days.length - 1) % showLabelEvery) ? labelDay(d.day) : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  {hover !== null && (
                    <div
                      className="pointer-events-none absolute top-1 z-10 min-w-[128px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
                      style={{
                        left: `${((hover + 0.5) / data.days.length) * 100}%`,
                        transform: hover > data.days.length / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                      }}
                    >
                      <div className="font-bold text-ink">{labelDay(data.days[hover].day)}</div>
                      {SERIES.map((s) => (
                        <div key={s.key} className="mt-1 flex items-center justify-between gap-3 text-ink-soft">
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                          <span className="font-mono text-ink">{data.days[hover][s.key]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {empty && <p className="absolute inset-x-0 top-16 text-center text-[13px] text-ink-faint">Nenhum envio no período.</p>}
            </div>
          )}
        </div>

        {/* Funil */}
        <div>
          <div className="text-xs font-bold text-ink">Funil</div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {data.funnel.map((f, i) => {
              const prev = i > 0 ? data.funnel[i - 1].value : 0;
              const pct = i > 0 && prev ? Math.round((f.value / prev) * 100) : null;
              return (
                <li key={f.label}>
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-ink-soft">{f.label}</span>
                    <span>
                      <span className="font-mono font-semibold tabular-nums text-ink">{f.value}</span>
                      {pct !== null && <span className="ml-1.5 text-[11px] text-ink-faint">{pct}%</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full" style={{ width: `${(f.value / funnelMax) * 100}%`, background: 'rgb(var(--viz-1))' }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {data.steps.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-bold text-ink">Por etapa da cadência</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead className="text-xs text-ink-faint">
                <tr>
                  <th className="py-1.5 text-left font-semibold">Etapa</th>
                  <th className="py-1.5 text-right font-semibold">Enviadas</th>
                  <th className="py-1.5 text-right font-semibold">Respostas</th>
                  <th className="py-1.5 text-right font-semibold">Taxa</th>
                  <th className="py-1.5 text-right font-semibold">Para enviar</th>
                  <th className="py-1.5 text-right font-semibold">Aguardando</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s.index} className="border-t border-line">
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{s.sent}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{s.replies}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{s.sent ? `${Math.round((s.replies / s.sent) * 100)}%` : '—'}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{s.manual}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{s.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-faint">A resposta conta para a última mensagem enviada antes dela. "Para enviar": WhatsApp pronto esperando você enviar (Tarefas → WhatsApp de hoje). "Aguardando": leads que ainda não chegaram a essa etapa.</p>
        </div>
      )}
    </section>
  );
}
