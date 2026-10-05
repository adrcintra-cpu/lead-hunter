import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { ConfirmDialog, ErrorBox, Spinner, cx } from '@/components/ui';
import { DEFAULT_ASSISTANT, loadAssistant, resetAssistant, saveAssistant, type AssistantSettings } from '@/services/assistant/assistantSettings';

type Tab = 'persona' | 'knowledge' | 'playbooks';

const TABS: { id: Tab; label: string; hint: string; rows: number }[] = [
  { id: 'persona', label: 'Persona', hint: 'Só comportamento: como a assistente conversa, o que procura entender e quando convida para a conversa. Muda raramente.', rows: 16 },
  { id: 'knowledge', label: 'Base de conhecimento', hint: 'Tudo sobre a empresa: quem somos, serviços, perguntas frequentes, objeções, processo comercial. Atualize sempre que a empresa evoluir. A IA nunca recomenda o que não estiver aqui.', rows: 18 },
  { id: 'playbooks', label: 'Playbooks', hint: 'Raciocínio por tipo de pedido: o que perguntar, o que considerar e quando passar para um especialista.', rows: 16 },
];

/** Configurações → Assistente de IA: persona, base de conhecimento e playbooks usados na resposta sugerida. */
export function AssistantCard() {
  const { toast } = useApp();
  const [s, setS] = useState<AssistantSettings | null>(null);
  const [custom, setCustom] = useState(false);
  const [available, setAvailable] = useState(true);
  const [tab, setTab] = useState<Tab>('persona');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const reload = () =>
    loadAssistant()
      .then((r) => {
        setS(r.settings);
        setCustom(r.custom);
        setAvailable(r.available);
      })
      .catch(() => setS(DEFAULT_ASSISTANT));

  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      await saveAssistant(s);
      setCustom(true);
      toast('Assistente salvo. As próximas respostas sugeridas já usam este texto.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetAssistant();
      await reload();
      setCustom(false);
      toast('Texto padrão da OXYCOM restaurado.');
    } finally {
      setBusy(false);
    }
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><Bot className="h-4 w-4" /> Assistente de IA</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            Quando um lead responde, a assistente escreve a próxima mensagem seguindo este texto. Você sempre revisa antes de enviar.
          </p>
        </div>
        <span className={cx('rounded-md px-2 py-1 text-xs font-bold', custom ? 'bg-accent-soft text-accent-strong' : 'bg-muted text-ink-soft')}>
          {custom ? 'Personalizado' : 'Padrão OXYCOM'}
        </span>
      </div>

      {!available && (
        <div className="mt-3">
          <ErrorBox>Falta aplicar a migration do assistente no banco (npx supabase db push). Até lá, a IA usa o texto padrão.</ErrorBox>
        </div>
      )}

      {!s ? (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-faint"><Spinner /> Carregando…</div>
      ) : (
        <>
          <div className="mt-4 max-w-xs">
            <label htmlFor="as-name" className="label">Nome da assistente</label>
            <input id="as-name" className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
            <p className="mt-1 text-xs text-ink-faint">Se perguntarem se é robô, ela se apresenta com esse nome e diz que você continua a conversa.</p>
          </div>

          <div role="tablist" aria-label="Partes do assistente" className="mt-4 flex flex-wrap gap-1 border-b border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-bold', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">{current.hint}</p>
          <label htmlFor={`as-${tab}`} className="sr-only">{current.label}</label>
          <textarea
            id={`as-${tab}`}
            rows={current.rows}
            className="input mt-2 py-2.5 font-mono text-[12.5px] leading-relaxed"
            value={s[tab]}
            onChange={(e) => setS({ ...s, [tab]: e.target.value })}
          />
          <p className="mt-1 text-right text-[11px] text-ink-faint">{s[tab].length.toLocaleString('pt-BR')} caracteres</p>

          {error && <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} Salvar assistente</button>
            {custom && <button type="button" className="btn-ghost" onClick={() => setConfirmReset(true)} disabled={busy}>Restaurar padrão</button>}
          </div>
        </>
      )}

      {confirmReset && (
        <ConfirmDialog title="Restaurar o texto padrão?" confirmLabel="Restaurar" onClose={() => setConfirmReset(false)} onConfirm={() => void reset()}>
          O seu texto da persona, da base de conhecimento e dos playbooks será substituído pelo padrão da OXYCOM.
        </ConfirmDialog>
      )}
    </section>
  );
}
