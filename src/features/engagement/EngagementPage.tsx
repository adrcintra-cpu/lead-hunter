import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtSign, Check, Copy, ExternalLink, Briefcase, RefreshCw, Settings2, Sparkles, X } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { EmptyState, ErrorBox, PageHeader, Spinner, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import {
  buildQueue,
  contextOf,
  discard,
  followUpOf,
  leadFromComment,
  loadQueue,
  replyComment,
  loadSettings,
  markDone,
  saveSettings,
  type EngItem,
  type EngSettings,
} from '@/services/engagement';

const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const KIND_LABEL: Record<EngItem['kind'], string> = { comentario: 'Comentar no post', convite: 'Enviar convite', mensagem: 'Primeira mensagem', resposta: 'Responder comentário no post da Oxycom' };

/** Engajamento social assistido: o OxySDR encontra e escreve; você envia na rede e marca como feito. */
export function EngagementPage() {
  const { team, session, toast } = useApp();
  const canWrite = !team || team.role !== 'leitura';
  const ownerId = team?.ownerId ?? session?.userId ?? '';
  const [items, setItems] = useState<EngItem[] | null>(null);
  const [done, setDone] = useState<EngItem[]>([]);
  const [settings, setSettings] = useState<EngSettings | null>(null);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<'todos' | 'instagram' | 'linkedin'>('todos');

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([loadQueue(today()), loadSettings()]);
      setItems(q.pending);
      setDone(q.done);
      setSettings(s);
      setError('');
    } catch (e) {
      setError(/engagement_|does not exist|schema cache/i.test((e as Error).message) ? 'As tabelas do engajamento social ainda não existem no banco.' : (e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const build = async () => {
    setBuilding(true);
    setNotes([]);
    try {
      const r = await buildQueue();
      setNotes(r.notes ?? []);
      toast(r.created ? `${r.created} ${r.created === 1 ? 'interação preparada' : 'interações preparadas'} para hoje.` : 'Nada novo para preparar agora.', r.created ? 'success' : undefined);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const visible = useMemo(() => (items ?? []).filter((i) => filter === 'todos' || i.channel === filter), [items, filter]);
  const count = (ch: EngItem['channel']) => (items ?? []).filter((i) => i.channel === ch).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engajamento social"
        subtitle="O OxySDR encontra os perfis e posts e escreve o texto no tom do Beelie. Você abre, envia na rede e marca como feito: nada é publicado sozinho (Instagram e LinkedIn proíbem robôs)."
        actions={
          <>
            <button className="btn btn-outline" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 size={18} /> Ajustes
            </button>
            <button className="btn btn-primary" disabled={!canWrite || building} onClick={() => void build()}>
              {building ? <Spinner /> : <Sparkles size={18} />} {building ? 'Preparando…' : 'Preparar fila de hoje'}
            </button>
          </>
        }
      />

      {error && <ErrorBox>{error}</ErrorBox>}
      {notes.length > 0 && (
        <div className="card space-y-1 p-4 text-sm text-ink-2">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {showSettings && settings && <SettingsCard initial={settings} ownerId={ownerId} canWrite={canWrite} onSaved={(s) => { setSettings(s); setShowSettings(false); toast('Ajustes salvos.', 'success'); }} />}

      <div className="flex flex-wrap items-center gap-2">
        {(['todos', 'instagram', 'linkedin'] as const).map((f) => (
          <button key={f} className={cx('btn', filter === f ? 'btn-dark' : 'btn-outline')} onClick={() => setFilter(f)}>
            {f === 'todos' ? `Todos · ${items?.length ?? 0}` : f === 'instagram' ? `Instagram · ${count('instagram')}` : `LinkedIn · ${count('linkedin')}`}
          </button>
        ))}
        <button className="btn btn-ghost ml-auto" onClick={() => void load()} title="Atualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      {items === null && !error ? (
        <div className="card p-10 text-center"><Spinner /></div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Sparkles size={28} />}
            title="Nenhuma interação pendente"
            action={canWrite && <button className="btn btn-primary" disabled={building} onClick={() => void build()}><Sparkles size={18} /> Preparar fila de hoje</button>}
          >
            Clique em Preparar fila: o OxySDR separa até {settings?.dailyInstagram ?? 10} posts do Instagram e {settings?.dailyLinkedin ?? 10} decisores no LinkedIn, já com o texto pronto.
          </EmptyState>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((i) => (
            <QueueCard key={i.id} item={i} canWrite={canWrite} onChange={load} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <section className="card p-5">
          <h2 className="text-[15px] font-extrabold">Feitas nos últimos 7 dias · {done.length}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {done.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-ink-2">
                <Check size={16} className="text-good" />
                <span className="font-semibold">{d.channel === 'instagram' ? 'Instagram' : 'LinkedIn'}</span> · {KIND_LABEL[d.kind]} · {d.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QueueCard({ item, canWrite, onChange }: { item: EngItem; canWrite: boolean; onChange: () => Promise<void> }) {
  const { toast } = useApp();
  const drawer = useLeadDrawer();
  const [text, setText] = useState(item.suggestion);
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const url = item.targetUrl || item.profileUrl;
  const isSearch = item.channel === 'linkedin' && !!item.profileUrl?.includes('/search/');

  const copyOpen = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Texto copiado. Cole na rede e envie.', 'success');
    } catch {
      toast('Não foi possível copiar: selecione o texto e copie.');
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg, 'success');
      await onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold">
          {item.channel === 'instagram' ? <AtSign size={14} /> : <Briefcase size={14} />} {item.channel === 'instagram' ? 'Instagram' : 'LinkedIn'}
        </span>
        <span className="text-[13px] font-semibold text-ink-faint">{KIND_LABEL[item.kind]}</span>
        <h3 className="text-[15px] font-bold">{item.title}</h3>
        {item.leadId && (
          <button className="text-[13px] font-semibold text-accent hover:underline" onClick={() => drawer.open(item.leadId!)}>
            Ver lead
          </button>
        )}
        {item.kind === 'resposta' && contextOf(item).startsWith('Possível cliente') && (
          <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-[12px] font-bold text-good">Possível cliente</span>
        )}
        {item.forDate < today() && <span className="text-[12px] font-semibold text-warn">desde {item.forDate.split('-').reverse().slice(0, 2).join('/')}</span>}
      </div>

      <button className="mt-2 text-[13px] text-ink-faint hover:text-ink" onClick={() => setShowCtx((v) => !v)}>
        {showCtx ? 'Esconder contexto' : 'Ver o que a IA leu'}
      </button>
      {showCtx && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{contextOf(item)}</p>}

      <label className="mt-3 block">
        <span className="glass-chip mb-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold text-accent">
          <Sparkles size={12} /> Sugestão de IA
        </span>
        <textarea className="input min-h-[84px] py-2" value={text} disabled={!canWrite || busy} onChange={(e) => setText(e.target.value)} maxLength={item.kind === 'convite' ? 300 : 3000} />
      </label>
      {item.kind === 'convite' && <p className="mt-1 text-[12px] text-ink-faint">{text.length}/300 caracteres (limite do convite no LinkedIn). Depois do convite, a primeira mensagem entra na fila em 3 dias.</p>}
      {item.kind === 'convite' && followUpOf(item) && <p className="mt-1 text-[12px] text-ink-faint">Mensagem preparada para depois: “{followUpOf(item).slice(0, 140)}…”</p>}

      {isSearch && (
        <label className="mt-3 block text-[13px]">
          <span className="text-ink-2">O link abre a busca de pessoas da empresa no LinkedIn. Achou o perfil? Cole aqui para guardar (opcional):</span>
          <input className="input mt-1" placeholder="https://www.linkedin.com/in/…" value={profile} disabled={!canWrite || busy} onChange={(e) => setProfile(e.target.value.trim())} />
        </label>
      )}

      {item.kind === 'resposta' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!canWrite || busy || !text.trim()} onClick={() => void run(() => replyComment(item.id, text), 'Resposta publicada no Instagram.')}>
            <Check size={18} /> Responder no Instagram
          </button>
          {!item.leadId && (
            <button className="btn btn-outline" disabled={!canWrite || busy} onClick={() => void run(() => leadFromComment(item.id), 'Lead criado a partir do comentário.')}>
              <Sparkles size={18} /> Criar lead
            </button>
          )}
          {item.targetUrl && (
            <a className="btn btn-ghost" href={item.targetUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} /> Ver o post
            </a>
          )}
          <button className="btn btn-ghost" disabled={!canWrite || busy} onClick={() => void run(() => discard(item.id), 'Comentário ignorado.')}>
            <X size={18} /> Ignorar
          </button>
        </div>
      ) : (
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void copyOpen()}>
          <Copy size={18} /> Copiar e abrir {item.channel === 'instagram' ? 'o post' : isSearch ? 'a busca' : 'o perfil'} <ExternalLink size={14} />
        </button>
        <button className="btn btn-outline" disabled={!canWrite || busy || !text.trim()} onClick={() => void run(() => markDone(item.id, text, profile || undefined), 'Marcado como feito e registrado no lead.')}>
          <Check size={18} /> Marcar como feito
        </button>
        <button className="btn btn-ghost" disabled={!canWrite || busy} onClick={() => void run(() => discard(item.id), 'Sugestão descartada.')}>
          <X size={18} /> Descartar
        </button>
      </div>
      )}
    </li>
  );
}

function SettingsCard({ initial, ownerId, canWrite, onSaved }: { initial: EngSettings; ownerId: string; canWrite: boolean; onSaved: (s: EngSettings) => void }) {
  const { toast } = useApp();
  const [tags, setTags] = useState(initial.hashtags.map((t) => '#' + t.replace(/^#/, '')).join(' '));
  const [ig, setIg] = useState(initial.dailyInstagram);
  const [li, setLi] = useState(initial.dailyLinkedin);
  const [roles, setRoles] = useState(initial.linkedinRoles);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const s: EngSettings = {
      hashtags: [...new Set(tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 10),
      dailyInstagram: Math.min(40, Math.max(0, ig)),
      dailyLinkedin: Math.min(40, Math.max(0, li)),
      linkedinRoles: roles.trim() || initial.linkedinRoles,
    };
    setBusy(true);
    try {
      await saveSettings(ownerId, s);
      onSaved(s);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card grid gap-4 p-5 md:grid-cols-2">
      <label className="block md:col-span-2">
        <span className="label">Hashtags do nicho (Instagram)</span>
        <input className="input" value={tags} disabled={!canWrite} onChange={(e) => setTags(e.target.value)} placeholder="#marketingdigital #agronegocio #clinicaodontologica" />
        <span className="mt-1 block text-[12px] text-ink-faint">Até 3 são usadas por dia. A busca por hashtag precisa do recurso "Instagram Public Content Access" aprovado pela Meta.</span>
      </label>
      <label className="block">
        <span className="label">Posts do Instagram por dia</span>
        <input className="input" type="number" min={0} max={40} value={ig} disabled={!canWrite} onChange={(e) => setIg(Number(e.target.value))} />
      </label>
      <label className="block">
        <span className="label">Pessoas no LinkedIn por dia</span>
        <input className="input" type="number" min={0} max={40} value={li} disabled={!canWrite} onChange={(e) => setLi(Number(e.target.value))} />
        <span className="mt-1 block text-[12px] text-ink-faint">Recomendado até 20 convites por dia para não chamar atenção do LinkedIn.</span>
      </label>
      <label className="block md:col-span-2">
        <span className="label">Cargos a procurar no LinkedIn</span>
        <input className="input" value={roles} disabled={!canWrite} onChange={(e) => setRoles(e.target.value)} />
      </label>
      <div className="md:col-span-2">
        <button className="btn btn-primary" disabled={!canWrite || busy} onClick={() => void save()}>
          {busy ? <Spinner /> : <Check size={18} />} Salvar ajustes
        </button>
      </div>
    </section>
  );
}
