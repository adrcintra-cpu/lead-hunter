import { useEffect, useState } from 'react';
import { Radar, X } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { Spinner, cx } from '@/components/ui';
import { loadHunter, saveHunter, type HunterPrefs } from '@/services/assistant/assistantSettings';
import { DEFAULT_HUNTER_EXCLUDED, HUNTER_MAX_PER_DAY } from '../../../supabase/functions/_shared/automation/hunter.ts';
import { SegmentInput } from '@/features/search/SegmentInput';

/** Liga a busca automática do BEELIE (no servidor) e define os segmentos que ele não busca. */
export function HunterPanel() {
  const { toast } = useApp();
  const [h, setH] = useState<HunterPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadHunter().then((r) => alive && setH(r));
    return () => {
      alive = false;
    };
  }, []);

  async function update(enabled: boolean, excluded: string[], msg: string) {
    if (!h) return;
    const prev = h;
    setH({ ...h, enabled, excluded });
    setBusy(true);
    try {
      await saveHunter(enabled, excluded);
      toast(msg, 'success');
    } catch (e) {
      setH(prev);
      toast(e instanceof Error ? e.message : 'Não foi possível salvar.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (on: boolean) => {
    if (!h) return;
    // Primeira vez: já começa sem os concorrentes (agências e estúdios).
    const excluded = on && !h.excluded.length ? DEFAULT_HUNTER_EXCLUDED : h.excluded;
    void update(on, excluded, on ? 'Busca automática ligada: o BEELIE vai buscar empresas novas sozinho.' : 'Busca automática desligada.');
  };
  const add = (seg: string) => {
    const v = seg.trim();
    if (!h || !v || h.excluded.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    void update(h.enabled, [...h.excluded, v], `“${v}” não será buscado.`);
  };
  const remove = (seg: string) => h && void update(h.enabled, h.excluded.filter((x) => x !== seg), `“${seg}” volta para a busca.`);

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]"
            checked={!!h?.enabled}
            disabled={!h?.available || busy}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 text-[15px] font-extrabold"><Radar className="h-4 w-4" /> Busca automática do BEELIE</span>
            <span className="mt-1 block max-w-2xl text-[13px] leading-relaxed text-ink-faint">
              Funciona com o app fechado. Quando a fila de leads novos com WhatsApp fica abaixo de 3 dias de prospecção, o BEELIE busca empresas no Google pelo Brasil todo,
              um segmento e uma cidade por vez (passa por mais de 100 cidades). No máximo {HUNTER_MAX_PER_DAY} buscas por dia. Só empresas novas viram leads, e elas entram
              nas campanhas com entrada automática.
            </span>
          </span>
        </label>
        {!h ? <Spinner /> : h.enabled && <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-bold text-accent-strong">Hoje: {h.today} {h.today === 1 ? 'busca' : 'buscas'}</span>}
      </div>

      {h && !h.available && <p className="mt-3 text-xs text-warn">Falta aplicar a migration da busca automática (npx supabase db push).</p>}

      {h?.available && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="text-sm font-bold">Não buscar estes segmentos</div>
          <p className="mt-0.5 text-xs text-ink-faint">Empresas com esses termos no nome também são descartadas.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {h.excluded.length === 0 && <span className="text-xs text-ink-faint">Nenhum: busca todos os segmentos.</span>}
            {h.excluded.map((s) => (
              <span key={s} className={cx('inline-flex items-center gap-1 rounded-full border border-line bg-muted py-1 pl-3 pr-1 text-[13px]')}>
                {s}
                <button type="button" className="rounded-full p-1 text-ink-faint hover:text-ink" aria-label={`Voltar a buscar ${s}`} disabled={busy} onClick={() => remove(s)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 max-w-sm">
            <label htmlFor="hunter-ex" className="sr-only">Adicionar segmento para não buscar</label>
            <SegmentInput id="hunter-ex" className="input" value="" onCommit={add} />
          </div>
        </div>
      )}
    </section>
  );
}
