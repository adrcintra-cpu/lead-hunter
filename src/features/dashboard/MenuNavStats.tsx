import { useEffect, useState } from 'react';
import { useService } from '@/store/AppStore';
import { supabase } from '@/lib/supabase';
import { menuNavApi, navStats, type MenuNavigation } from '@/services/navigation/menuNavApi';

/** Indicadores da navegação do BEELIE em menus de atendimento automático (últimos 30 dias). */
export function MenuNavStats() {
  const service = useService();
  const [list, setList] = useState<MenuNavigation[] | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const since = new Date(service.now().getTime() - 30 * 864e5).toISOString();
    const load = () => void menuNavApi.since(since).then((r) => alive && setList(r)).catch(() => alive && setList([]));
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [service]);
  // Sem nenhum menu no período, o card não aparece (o dashboard fica como está).
  if (!list || !list.length) return null;
  const s = navStats(list);
  const items: [string, string][] = [
    ['Menus detectados', String(s.menus)],
    ['Etapas navegadas', String(s.steps)],
    ['Chegou a uma pessoa', `${s.humanRate}%`],
    ['Responsáveis identificados', String(s.responsible)],
    ['Conversas comerciais', String(s.started)],
    ['Bloqueados por chatbot', `${s.blockedRate}%`],
  ];
  return (
    <section className="card px-5 py-4" aria-labelledby="nav-title">
      <h2 id="nav-title" className="text-[15px] font-bold">Atendimentos automáticos <span className="font-normal text-ink-faint">· 30 dias</span></h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12.5px] font-semibold text-ink-faint">{label}</dt>
            <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
