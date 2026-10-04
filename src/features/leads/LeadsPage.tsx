import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ListPlus, Search as SearchIcon, X } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { useLeadRows, type LeadRow } from '@/store/selectors';
import { STAGES, stageLabel, type LeadStage } from '@/core/types';
import { formatDate, normalize } from '@/core/utils';
import { EmptyState, PageHeader, ScoreBadge, WhatsappBadge, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';

type SortKey = 'empresa' | 'segmento' | 'cidade' | 'estado' | 'score' | 'status' | 'origem' | 'data';

interface Filters {
  text: string;
  city: string;
  state: string;
  segment: string;
  minScore: string;
  stage: string;
  site: '' | 'sim' | 'nao';
  wa: '' | 'sim' | 'nao';
  origin: string;
}

const EMPTY: Filters = { text: '', city: '', state: '', segment: '', minScore: '', stage: '', site: '', wa: '', origin: '' };

const uniq = (xs: string[]) => Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b, 'pt-BR'));

export function LeadsTable({ rows, emptyText }: { rows: LeadRow[]; emptyText?: string }) {
  const drawer = useLeadDrawer();
  const service = useService();
  const db = useDb();
  const { toast } = useApp();
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listTarget, setListTarget] = useState('');

  const opts = useMemo(
    () => ({
      cities: uniq(rows.map((r) => r.company.city)),
      states: uniq(rows.map((r) => r.company.state)),
      segments: uniq(rows.map((r) => r.company.segment)),
      origins: uniq(rows.map((r) => r.lead.origin)),
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const t = normalize(f.text);
    const out = rows.filter(({ lead, company: c }) => {
      if (t && !normalize(`${c.legalName} ${c.tradeName ?? ''} ${c.website ?? ''}`).includes(t)) return false;
      if (f.city && c.city !== f.city) return false;
      if (f.state && c.state !== f.state) return false;
      if (f.segment && c.segment !== f.segment) return false;
      if (f.minScore && lead.currentScore < Number(f.minScore)) return false;
      if (f.stage && lead.stage !== f.stage) return false;
      if (f.site === 'sim' && !c.website) return false;
      if (f.site === 'nao' && c.website) return false;
      if (f.wa === 'sim' && !c.whatsapp) return false;
      if (f.wa === 'nao' && c.whatsapp) return false;
      if (f.origin && lead.origin !== f.origin) return false;
      return true;
    });
    const val = (r: LeadRow): string | number => {
      switch (sort.key) {
        case 'empresa': return normalize(r.company.tradeName ?? r.company.legalName);
        case 'segmento': return normalize(r.company.segment);
        case 'cidade': return normalize(r.company.city);
        case 'estado': return r.company.state;
        case 'score': return r.lead.currentScore;
        case 'status': return STAGES.findIndex((s) => s.id === r.lead.stage);
        case 'origem': return r.lead.origin;
        case 'data':
        default: return r.lead.discoveredAt;
      }
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, f, sort]);

  const activeFilters = Object.entries(f).filter(([, v]) => v).length;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === 'score' || key === 'data' }));
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.lead.id));

  const Th = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th scope="col" className={cx('px-3 py-2.5 text-left', className)} aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 text-[11.5px] font-bold uppercase tracking-wide text-ink-soft hover:text-ink">
        {children}
        {sort.key === k && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  const select = 'input min-h-[38px] w-auto py-1.5 pr-8 text-[13px]';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <label htmlFor="lt-text" className="sr-only">Buscar empresa</label>
          <input id="lt-text" className="input min-h-[38px] pl-9 text-[13px]" placeholder="Buscar empresa ou site" value={f.text} onChange={(e) => set('text', e.target.value)} />
        </div>
        <select aria-label="Cidade" className={select} value={f.city} onChange={(e) => set('city', e.target.value)}>
          <option value="">Cidade</option>
          {opts.cities.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Estado" className={select} value={f.state} onChange={(e) => set('state', e.target.value)}>
          <option value="">UF</option>
          {opts.states.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Segmento" className={select} value={f.segment} onChange={(e) => set('segment', e.target.value)}>
          <option value="">Segmento</option>
          {opts.segments.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Score mínimo" className={select} value={f.minScore} onChange={(e) => set('minScore', e.target.value)}>
          <option value="">Score</option>
          <option value="75">75+ (alta)</option>
          <option value="50">50+ (média)</option>
        </select>
        <select aria-label="Status" className={select} value={f.stage} onChange={(e) => set('stage', e.target.value)}>
          <option value="">Status</option>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Possui site" className={select} value={f.site} onChange={(e) => set('site', e.target.value as Filters['site'])}>
          <option value="">Site</option>
          <option value="sim">Com site</option>
          <option value="nao">Sem site</option>
        </select>
        <select aria-label="Possui WhatsApp" className={select} value={f.wa} onChange={(e) => set('wa', e.target.value as Filters['wa'])}>
          <option value="">WhatsApp</option>
          <option value="sim">Com WhatsApp</option>
          <option value="nao">Sem WhatsApp</option>
        </select>
        <select aria-label="Origem" className={select} value={f.origin} onChange={(e) => set('origin', e.target.value)}>
          <option value="">Origem</option>
          {opts.origins.map((x) => <option key={x}>{x}</option>)}
        </select>
        {activeFilters > 0 && (
          <button type="button" className="btn-ghost min-h-[38px] px-2 text-[13px]" onClick={() => setF(EMPTY)}>
            <X className="h-4 w-4" /> Limpar ({activeFilters})
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-semibold text-accent-strong">{selected.size} selecionados</span>
          <select aria-label="Lista de destino" className={select} value={listTarget} onChange={(e) => setListTarget(e.target.value)}>
            <option value="">Escolha uma lista</option>
            {db.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button
            type="button"
            className="btn-primary min-h-[36px]"
            disabled={!listTarget}
            onClick={() => {
              selected.forEach((id) => service.addToList(id, listTarget));
              toast(`${selected.size} leads adicionados à lista.`, 'success');
              setSelected(new Set());
            }}
          >
            <ListPlus className="h-4 w-4" /> Adicionar
          </button>
          {db.lists.length === 0 && <Link to="/listas" className="text-accent underline">Criar uma lista</Link>}
          <button type="button" className="btn-ghost ml-auto min-h-[36px]" onClick={() => setSelected(new Set())}>Cancelar</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-[13.5px]">
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className="w-10 px-3">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.lead.id)))}
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                />
              </th>
              <Th k="empresa">Empresa</Th>
              <Th k="segmento">Segmento</Th>
              <Th k="cidade">Cidade</Th>
              <Th k="estado">UF</Th>
              <th scope="col" className="px-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">Website</th>
              <th scope="col" className="px-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">Telefone</th>
              <th scope="col" className="px-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">WhatsApp</th>
              <Th k="score">Score</Th>
              <Th k="status">Status</Th>
              <Th k="origem">Origem</Th>
              <Th k="data">Descoberta</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ lead, company: c }) => (
              <tr key={lead.id} className="border-b border-line last:border-b-0 hover:bg-subtle">
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${c.tradeName ?? c.legalName}`}
                    checked={selected.has(lead.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(lead.id)) n.delete(lead.id);
                        else n.add(lead.id);
                        return n;
                      })
                    }
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <button type="button" onClick={() => drawer.open(lead.id)} className="text-left font-bold underline decoration-line-strong underline-offset-[3px] hover:text-accent">
                    {c.tradeName ?? c.legalName}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3">{c.segment}</td>
                <td className="px-3">{c.city}</td>
                <td className="px-3">{c.state}</td>
                <td className={cx('max-w-[180px] truncate px-3', !c.website && 'text-ink-faint')}>{c.website ?? '—'}</td>
                <td className="whitespace-nowrap px-3 font-mono text-[12.5px]">{c.phone ?? '—'}</td>
                <td className="px-3"><WhatsappBadge status={c.whatsappStatus} hasNumber={!!c.whatsapp} /></td>
                <td className="px-3"><ScoreBadge score={lead.currentScore} tier={lead.scoreTier} /></td>
                <td className="whitespace-nowrap px-3">{stageLabel(lead.stage as LeadStage)}</td>
                <td className="whitespace-nowrap px-3 text-[12.5px] text-ink-soft">{lead.origin}</td>
                <td className="px-3 font-mono text-[12.5px] text-ink-soft">{formatDate(lead.discoveredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <EmptyState title={rows.length === 0 ? 'Nenhum lead ainda' : 'Nenhum lead com esses filtros'}>
            {rows.length === 0 ? emptyText ?? 'Faça uma busca para encontrar empresas.' : 'Remova algum filtro para ver mais resultados.'}
          </EmptyState>
        )}
      </div>
      <div className="text-xs text-ink-faint">{filtered.length} de {rows.length} leads</div>
    </div>
  );
}

export function LeadsPage() {
  const rows = useLeadRows();
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const searchId = params.get('search');
  const search = searchId ? db.searches.find((s) => s.id === searchId) : null;
  const scoped = useMemo(() => {
    if (!searchId) return rows;
    const ids = new Set(db.searchResults.filter((r) => r.searchId === searchId).map((r) => r.leadId));
    return rows.filter((r) => ids.has(r.lead.id));
  }, [rows, db.searchResults, searchId]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <PageHeader
        title="Leads"
        subtitle={
          search ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              Resultados da busca “{search.rawQuery}”
              <button
                type="button"
                className="text-accent underline"
                onClick={() => {
                  const n = new URLSearchParams(params);
                  n.delete('search');
                  setParams(n);
                }}
              >
                ver todos
              </button>
            </span>
          ) : (
            'Clique no nome da empresa para abrir o perfil.'
          )
        }
        actions={<Link to="/buscar" className="btn-primary">Nova busca</Link>}
      />
      <LeadsTable rows={scoped} />
    </div>
  );
}
