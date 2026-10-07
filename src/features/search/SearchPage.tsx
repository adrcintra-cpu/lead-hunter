import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { buildLeadRows } from '@/store/selectors';
import type { CriteriaField, SearchCriteria } from '@/core/types';
import { unsupportedCriteria } from '@/core/providers/types';
import { MOCK_CITIES } from '@/core/providers/mock/mockCompanies';
import type { ParseResult, SearchStep } from '@/services/leadHunterService';
import { cx, EmptyState, ErrorBox, Modal, ScoreBadge, Spinner, WhatsappBadge } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import { AddToCampaign } from '../campaigns/AddToCampaign';
import { dataMode } from '@/lib/supabase';

const EXAMPLES = [
  'Empresas de máquinas agrícolas em Campinas',
  'Indústrias de Limeira com mais de 50 funcionários',
  'Clínicas odontológicas em Piracicaba com WhatsApp',
  'Empresas do agronegócio no interior de São Paulo',
];

const STEPS: { id: SearchStep; label: string }[] = [
  { id: 'providers', label: 'Consultando providers' },
  { id: 'enrich', label: 'Enriquecendo dados empresariais' },
  { id: 'dedupe', label: 'Removendo duplicados' },
  { id: 'score', label: 'Qualificando e calculando score' },
];

const FIELD_LABEL: Partial<Record<CriteriaField, string>> = {
  minEmployees: 'Porte mínimo',
  radiusKm: 'Raio',
  requireWebsite: 'Possui site',
  whatsapp: 'WhatsApp',
};

type Phase = 'idle' | 'parsing' | 'review' | 'running' | 'done';

export function SearchPage() {
  const service = useService();
  const db = useDb();
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [step, setStep] = useState<SearchStep>('providers');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const searchId = params.get('search');

  // Abrir uma busca existente (?search=id) ou um texto pré-preenchido (?q=...).
  useEffect(() => {
    const q = params.get('q');
    const savedId = params.get('saved');
    const saved = savedId ? db.savedSearches.find((s) => s.id === savedId) : null;
    if (saved) {
      // Busca salva: reaproveita os critérios já confirmados, sem nova interpretação.
      setQuery(saved.rawQuery);
      setParsed({ criteria: saved.criteria, confidence: {}, unsupported: unsupportedCriteria(saved.criteria, service.providers) });
      setCriteria(saved.criteria);
      setPhase('review');
      return;
    }
    if (q) {
      setQuery(q);
      setPhase('idle');
    }
    if (searchId) {
      const s = db.searches.find((x) => x.id === searchId);
      if (s) {
        setQuery(s.rawQuery);
        setPhase('done');
      }
    }
  }, [searchId, params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function interpret() {
    const text = query.trim();
    if (!text) {
      setError('Descreva o tipo de empresa que você procura.');
      return;
    }
    setError('');
    setPhase('parsing');
    try {
      const r = await service.parseQuery(text);
      setParsed(r);
      setCriteria(r.criteria);
      setPhase('review');
      const saved = params.get('saved');
      setParams(saved ? { saved } : {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível interpretar a busca.');
      setPhase('idle');
    }
  }

  async function run() {
    if (!criteria || !parsed) return;
    setPhase('running');
    setStep('providers');
    try {
      const s = await service.runSearch(query.trim(), parsed.criteria, criteria, setStep, params.get('saved') ?? undefined);
      setParams({ search: s.id });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A busca falhou.');
      setPhase('review');
    }
  }

  function reset() {
    setPhase('idle');
    setParsed(null);
    setCriteria(null);
    setQuery('');
    setError('');
    setParams({});
  }

  const ignored = useMemo(() => (criteria ? unsupportedCriteria(criteria, service.providers) : []), [criteria, service.providers]);

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5 pt-2 md:pt-6">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong">
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Pesquisador comercial com IA
        </span>
        <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight md:text-[34px]">
          Descreva as empresas que você quer encontrar
        </h1>
        <p className="mt-2 text-[15px] text-ink-faint">A IA transforma o pedido em critérios. Você confere antes de qualquer busca.</p>
      </div>

      <form
        className="rounded-2xl border-[1.5px] border-line-strong bg-surface p-4 shadow-sm focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          interpret();
        }}
      >
        <label htmlFor="q" className="sr-only">Descrição da busca</label>
        <textarea
          id="q"
          rows={3}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) interpret();
          }}
          placeholder="Que tipo de empresa você está procurando?"
          className="w-full resize-none border-0 bg-transparent text-lg leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:outline-none focus-visible:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-faint">Segmento, cidade, porte, canais de contato… · Ctrl/⌘ + Enter</span>
          <button type="submit" className="btn-dark h-11" disabled={phase === 'parsing' || phase === 'running'}>
            {phase === 'parsing' ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            {phase === 'parsing' ? 'Interpretando…' : 'Interpretar'}
          </button>
        </div>
      </form>

      {error && <ErrorBox>{error}</ErrorBox>}

      {phase === 'idle' && (
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setQuery(ex)} className="min-h-[40px] rounded-full border border-line bg-surface px-4 text-[13.5px] text-ink-soft hover:border-accent hover:text-ink">
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase === 'parsing' && (
        <div className="card flex items-center gap-3 px-5 py-4 text-sm text-ink-soft">
          <Spinner /> Interpretando o pedido em critérios estruturados…
        </div>
      )}

      {phase === 'review' && criteria && parsed && (
        <CriteriaReview
          criteria={criteria}
          confidence={parsed.confidence}
          ignored={ignored}
          onChange={setCriteria}
          onRun={run}
          onSave={() => setSaving(true)}
          onReset={reset}
        />
      )}

      {phase === 'running' && (
        <section className="card flex flex-col gap-3 px-5 py-5" aria-live="polite">
          <h2 className="text-[17px] font-extrabold">Buscando empresas…</h2>
          {STEPS.map((s, i) => {
            const cur = STEPS.findIndex((x) => x.id === step);
            const done = i < cur || step === 'done';
            const active = i === cur;
            return (
              <div key={s.id} className={cx('flex items-center gap-3 text-sm', done || active ? 'text-ink' : 'text-ink-faint', active && 'font-bold')}>
                <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs', done ? 'bg-accent text-accent-ink' : active ? 'bg-inverse text-inverse-ink' : 'bg-muted')}>
                  {done ? <Check className="h-3.5 w-3.5" /> : active ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {s.label}
              </div>
            );
          })}
        </section>
      )}

      {phase === 'done' && searchId && <SearchResults key={searchId} searchId={searchId} onNew={reset} />}

      {saving && criteria && (
        <SaveSearchModal
          onClose={() => setSaving(false)}
          onSave={(name) => {
            service.saveSearch(name, query.trim(), criteria);
            setSaving(false);
            toast(`Busca “${name}” salva. Ela não roda sozinha no MVP.`, 'success');
          }}
        />
      )}
    </div>
  );
}

function Field({ label, htmlFor, low, children, note }: { label: string; htmlFor: string; low?: boolean; children: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
        {low && <span className="ml-1.5 font-semibold text-warn">· confira</span>}
      </label>
      {children}
      {note && <div className="mt-1 text-xs text-warn">{note}</div>}
    </div>
  );
}

function CriteriaReview({
  criteria: c,
  confidence,
  ignored,
  onChange,
  onRun,
  onSave,
  onReset,
}: {
  criteria: SearchCriteria;
  confidence: ParseResult['confidence'];
  ignored: CriteriaField[];
  onChange: (c: SearchCriteria) => void;
  onRun: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof SearchCriteria>(k: K, v: SearchCriteria[K]) => onChange({ ...c, [k]: v });
  const low = (k: CriteriaField) => (confidence[k] ?? 1) < 0.5;
  const regionValue = c.city ?? (c.state ? 'SP' : '');
  const lowInput = (k: CriteriaField) => cx('input', low(k) && 'border-warn bg-warn-soft/40');

  return (
    <section className="card px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-extrabold">Critérios interpretados</h2>
        <span className="text-[12.5px] text-ink-faint">Confira e edite antes de buscar</span>
      </div>
      <div className="mt-4 grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <Field label="Segmento" htmlFor="c-seg" low={low('segment')}>
          <input id="c-seg" className={lowInput('segment')} value={c.segment} placeholder="Ex.: Máquinas agrícolas" onChange={(e) => set('segment', e.target.value)} />
        </Field>
        <Field label="Localização" htmlFor="c-loc" low={low('regionLabel')}>
          <select
            id="c-loc"
            className={lowInput('regionLabel')}
            value={regionValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) onChange({ ...c, city: null, state: null, regionLabel: 'Qualquer região', radiusKm: null });
              else if (v === 'SP') onChange({ ...c, city: null, state: 'SP', regionLabel: 'Estado de São Paulo', radiusKm: null });
              else onChange({ ...c, city: v, state: 'SP', regionLabel: `${v}/SP`, radiusKm: c.radiusKm ?? 50 });
            }}
          >
            <option value="">Qualquer região</option>
            <option value="SP">Estado de São Paulo (todo)</option>
            {MOCK_CITIES.map((city) => (
              <option key={city} value={city}>{city}/SP</option>
            ))}
          </select>
        </Field>
        <Field label="Raio" htmlFor="c-radius">
          <div className="flex items-center gap-2">
            <input
              id="c-radius"
              type="number"
              min={1}
              max={500}
              className="input"
              disabled={!c.city}
              value={c.radiusKm ?? ''}
              placeholder={c.city ? '50' : 'Escolha uma cidade'}
              onChange={(e) => set('radiusKm', e.target.value ? Number(e.target.value) : null)}
            />
            <span className="text-sm text-ink-faint">km</span>
          </div>
        </Field>
        <Field label="Leads novos (máx.)" htmlFor="c-qty">
          <input id="c-qty" type="number" min={1} max={200} className="input" value={c.quantity} onChange={(e) => set('quantity', Number(e.target.value) || 1)} />
        </Field>
        <Field label="Possui site" htmlFor="c-site">
          <select id="c-site" className="input" value={c.requireWebsite} onChange={(e) => set('requireWebsite', e.target.value as SearchCriteria['requireWebsite'])}>
            <option value="sim">Sim</option>
            <option value="indiferente">Indiferente</option>
          </select>
        </Field>
        <Field label="Possui telefone" htmlFor="c-phone">
          <select id="c-phone" className="input" value={c.requirePhone} onChange={(e) => set('requirePhone', e.target.value as SearchCriteria['requirePhone'])}>
            <option value="sim">Sim</option>
            <option value="indiferente">Indiferente</option>
          </select>
        </Field>
        <Field label="Possui WhatsApp" htmlFor="c-wa">
          <select id="c-wa" className="input" value={c.whatsapp} onChange={(e) => set('whatsapp', e.target.value as SearchCriteria['whatsapp'])}>
            <option value="obrigatorio">Obrigatório</option>
            <option value="preferencial">Preferencial</option>
            <option value="indiferente">Indiferente</option>
          </select>
        </Field>
        <Field
          label="Porte mínimo (funcionários)"
          htmlFor="c-emp"
          note={ignored.includes('minEmployees') ? 'Nenhum provider ativo informa porte: este critério será ignorado.' : c.minEmployees ? 'Empresas sem porte conhecido continuam no resultado.' : undefined}
        >
          <input id="c-emp" type="number" min={1} className="input" value={c.minEmployees ?? ''} placeholder="Opcional" onChange={(e) => set('minEmployees', e.target.value ? Number(e.target.value) : null)} />
        </Field>
      </div>
      {ignored.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Critérios sem provider capaz: {ignored.map((f) => FIELD_LABEL[f] ?? f).join(', ')}.
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-primary h-11" onClick={onRun} disabled={!c.segment.trim()}>
          Confirmar e buscar <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" className="btn-outline h-11" onClick={onSave}>
          <Save className="h-4 w-4" /> Salvar busca
        </button>
        <button type="button" className="btn-ghost h-11" onClick={onReset}>
          <RotateCcw className="h-4 w-4" /> Recomeçar
        </button>
      </div>
      {!c.segment.trim() && <p className="mt-2 text-xs text-warn">Informe um segmento para buscar.</p>}
    </section>
  );
}

function SearchResults({ searchId, onNew }: { searchId: string; onNew: () => void }) {
  const db = useDb();
  const drawer = useLeadDrawer();
  const search = db.searches.find((s) => s.id === searchId);
  // Ao reexecutar uma busca salva, o que interessa são as empresas que ainda não estavam na base.
  const [onlyNew, setOnlyNew] = useState(!!search?.savedSearchId);
  const allRows = useMemo(() => {
    const all = buildLeadRows(db);
    return db.searchResults
      .filter((r) => r.searchId === searchId)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ res: r, row: all.find((x) => x.lead.id === r.leadId) }))
      .filter((x) => x.row);
  }, [db, searchId]);
  const rows = onlyNew ? allRows.filter((x) => !x.res.wasDuplicate) : allRows;

  if (!search) return null;
  if (search.status === 'error') return <ErrorBox>A busca falhou: {search.error}</ErrorBox>;

  return (
    <section className="card px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-extrabold">
            {search.resultCount} {search.resultCount === 1 ? 'empresa encontrada' : 'empresas encontradas'}
          </h2>
          <div className="mt-0.5 text-[13px] text-ink-faint">
            {search.newCount} novas · {search.resultCount - search.newCount} já existiam · {search.duplicatesRemoved} {search.duplicatesRemoved === 1 ? 'duplicata removida' : 'duplicatas removidas'} · ordenadas por score
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            Só empresas novas
          </label>
          <button type="button" className="btn-ghost" onClick={onNew}>Nova busca</button>
          <Link to={`/leads?search=${search.id}`} className="btn-outline">Abrir na tabela</Link>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
          <span className="text-ink-soft">Colocar {onlyNew ? 'as novas' : 'estas empresas'} ({rows.length}) numa campanha:</span>
          <AddToCampaign leadIds={rows.map((x) => x.res.leadId)} />
        </div>
      )}
      {search.ignoredCriteria.length > 0 && (
        <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Ignorado por falta de provider: {search.ignoredCriteria.map((f) => FIELD_LABEL[f] ?? f).join(', ')}.
        </div>
      )}
      {rows.length === 0 ? (
        onlyNew && allRows.length > 0 ? (
          <EmptyState title="Nenhuma empresa nova desde a última vez">
            As {allRows.length} empresas encontradas já estavam na sua base. Desmarque “Só empresas novas” para vê-las.
          </EmptyState>
        ) : (
          dataMode === 'mock' ? (
            <EmptyState title="Nada encontrado nos dados de teste">
              O app está no modo de teste: a busca não vai à internet, só procura em 24 empresas fictícias. Elas cobrem os segmentos
              agronegócio, máquinas, indústria, tecnologia, clínicas, logística e serviços B2B, nas cidades de Campinas, Limeira,
              Piracicaba, Americana, Ribeirão Preto e Sorocaba. Para buscar qualquer empresa de verdade, é preciso ligar o Google Places
              (veja o README).
            </EmptyState>
          ) : (
            <EmptyState title="Nenhuma empresa com esses critérios">Tente ampliar o raio, mudar a cidade ou deixar o site como indiferente.</EmptyState>
          )
        )
      ) : (
        <ul className="mt-2">
          {rows.map(({ res, row }) => (
            <li key={res.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => drawer.open(row!.lead.id)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-bold">{row!.company.tradeName ?? row!.company.legalName}</span>
                  <span className="block truncate text-[12.5px] text-ink-faint">
                    {row!.company.segment} · {row!.company.city}/{row!.company.state} · {row!.company.website ?? 'sem site'}
                  </span>
                </span>
                <span className="hidden sm:inline">
                  <WhatsappBadge status={row!.company.whatsappStatus} hasNumber={!!row!.company.whatsapp} />
                </span>
                <span className={cx('hidden text-xs font-semibold sm:inline', res.wasDuplicate ? 'text-ink-faint' : 'text-accent')}>
                  {res.wasDuplicate ? 'Já existia' : 'Novo'}
                </span>
                <ScoreBadge score={row!.lead.currentScore} tier={row!.lead.scoreTier} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SaveSearchModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Modal
      title="Salvar busca"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Salvar</button>
        </>
      }
    >
      <label htmlFor="ss-name" className="label">Nome</label>
      <input id="ss-name" className="input" autoFocus value={name} placeholder="Ex.: Agro Campinas" onChange={(e) => setName(e.target.value)} />
      <p className="mt-2 text-xs text-ink-faint">Você poderá executar de novo em “Buscas”. No MVP nada roda automaticamente.</p>
    </Modal>
  );
}
