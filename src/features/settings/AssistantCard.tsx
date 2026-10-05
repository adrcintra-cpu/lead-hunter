import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { ConfirmDialog, ErrorBox, Spinner, cx } from '@/components/ui';
import { DEFAULT_ASSISTANT, DEFAULT_PREFS, VOICES, loadAssistant, resetAssistant, saveAssistant, savePrefs, type AssistantPrefs, type AssistantSettings } from '@/services/assistant/assistantSettings';
import { whatsappQrAvailable } from '@/lib/whatsappClient';
import { useWhatsAppConnection } from '@/services/whatsapp/useWhatsAppConnection';

type Tab = 'persona' | 'knowledge' | 'playbooks';

const TABS: { id: Tab; label: string; hint: string; rows: number }[] = [
  { id: 'persona', label: 'Persona', hint: 'Só comportamento: como o assistente conversa, o que procura entender e quando convida para a conversa. Muda raramente.', rows: 16 },
  { id: 'knowledge', label: 'Base de conhecimento', hint: 'Tudo sobre a empresa: quem somos, serviços, perguntas frequentes, objeções, processo comercial. Atualize sempre que a empresa evoluir. A IA nunca recomenda o que não estiver aqui.', rows: 18 },
  { id: 'playbooks', label: 'Playbooks', hint: 'Raciocínio por tipo de pedido: o que perguntar, o que considerar e quando passar para um especialista.', rows: 16 },
];

/** Configurações → Assistente de IA: persona, base de conhecimento e playbooks usados na resposta sugerida. */
export function AssistantCard() {
  const { toast } = useApp();
  const [s, setS] = useState<AssistantSettings | null>(null);
  const [prefs, setPrefs] = useState<AssistantPrefs>(DEFAULT_PREFS);
  const [prefsAvailable, setPrefsAvailable] = useState(true);
  const conn = useWhatsAppConnection();
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
        setPrefs(r.prefs);
        setPrefsAvailable(r.prefsAvailable);
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
      await saveAssistant(s, prefsAvailable ? prefs : undefined);
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

  async function updatePrefs(next: AssistantPrefs) {
    if (!s) return;
    const prev = prefs;
    setPrefs(next);
    try {
      await savePrefs(s, next, custom);
      toast(next.autoReply !== prev.autoReply ? (next.autoReply ? `O ${s.name || 'assistente'} vai responder sozinho.` : `Respostas automáticas desligadas: o ${s.name || 'assistente'} só sugere.`) : 'Preferência salva.', 'success');
    } catch (e) {
      setPrefs(prev);
      toast(e instanceof Error ? e.message : 'Não foi possível salvar.', 'error');
    }
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><Bot className="h-4 w-4" /> Assistente de IA</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            Quando um lead responde, o assistente escreve a próxima mensagem seguindo este texto.
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
          <div className="mt-4 rounded-xl border border-line p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]"
                checked={prefs.autoReply}
                disabled={!prefsAvailable}
                onChange={(e) => void updatePrefs({ ...prefs, autoReply: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-bold">O {s.name || 'assistente'} conversa sozinho no WhatsApp conectado</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                  Quando o lead responde, ele responde em cerca de 15 a 30 segundos, buscando entender o cenário e marcar uma conversa com você. Responde das 8h às 21h, todos os dias (ou no horário de Envio das campanhas, se for mais amplo), no máximo 15 vezes por lead em 24 h, e para se você escrever para o lead pelo celular. Pedido de reunião, proposta ou preço vira tarefa para você. Desligado: ele só sugere e você envia.
                </span>
              </span>
            </label>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <span className="label">Formato das respostas</span>
                <div role="radiogroup" aria-label="Formato" className="flex rounded-lg border border-line p-0.5">
                  {(['texto', 'audio'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={prefs.replyFormat === f}
                      disabled={!prefsAvailable}
                      onClick={() => void updatePrefs({ ...prefs, replyFormat: f })}
                      className={cx('min-h-[32px] rounded-md px-3 text-xs font-bold', prefs.replyFormat === f ? 'bg-inverse text-inverse-ink' : 'text-ink-soft hover:bg-muted')}
                    >
                      {f === 'texto' ? 'Texto' : 'Áudio (voz da IA)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="as-voice" className="label">Voz</label>
                <select id="as-voice" className="input w-auto" value={prefs.voice} disabled={!prefsAvailable} onChange={(e) => void updatePrefs({ ...prefs, voice: e.target.value })}>
                  {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-faint">O formato é o padrão. Em cada conversa, o {s.name || 'assistente'} responde em áudio quando o lead pede ou manda áudio, e volta ao texto se o lead pedir. Se a voz falhar, a resposta sai em texto.</p>
            {prefs.replyFormat === 'audio' && whatsappQrAvailable && conn && conn.audio === false && (
              <p className="mt-2 text-xs text-warn">A voz da IA ainda não está configurada no servidor: adicione OPENAI_API_KEY nas variáveis do Railway. Até lá, as respostas automáticas em áudio falham e ficam prontas para você enviar.</p>
            )}
            {!prefsAvailable && <p className="mt-2 text-xs text-warn">Falta aplicar a migration da conversa automática (npx supabase db push). Até lá, vale o padrão: o {s.name || 'assistente'} responde sozinho, em texto.</p>}
          </div>

          <div className="mt-4 max-w-xs">
            <label htmlFor="as-name" className="label">Nome do assistente</label>
            <input id="as-name" className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
            <p className="mt-1 text-xs text-ink-faint">Se perguntarem se é robô, ele se apresenta com esse nome e diz que você continua a conversa.</p>
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
