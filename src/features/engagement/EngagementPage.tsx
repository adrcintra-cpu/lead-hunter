import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AtSign, Check, Copy, ExternalLink, Briefcase, Heart, Plus, RefreshCw, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { EmptyState, ErrorBox, PageHeader, Spinner, cx } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';
import {
  buildQueue,
  contextOf,
  discard,
  followUpOf,
  leadFromComment,
  likeNow,
  likesToday,
  linkedinLinks,
  loadQueue,
  replyComment,
  loadSettings,
  markDone,
  saveSettings,
  type EngItem,
  type EngSettings,
  type EngTheme,
} from '@/services/engagement';
import { AutomationsTab, ConversationsTab, MetaConfig, MetaLeadsTab, ReportsTab, useMetaLeads } from './MetaLeadsTabs';

const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const KIND_LABEL: Record<EngItem['kind'], string> = { comentario: 'Comentar no post', convite: 'Enviar convite', mensagem: 'Primeira mensagem', resposta: 'Responder comentário no post da Oxycom' };

const TABS = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'meta', label: 'Meta Leads' },
  { id: 'conversas', label: 'Conversas' },
  { id: 'automacoes', label: 'Automações' },
  { id: 'relatorios', label: 'Relatórios' },
  { id: 'config', label: 'Configurações' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Engajamento social: fila assistida (Visão geral) e Meta Leads (formulários de anúncio do Facebook/Instagram). */
export function EngagementPage() {
  const { team, session } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'visao') as Tab;
  const go = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'visao') next.delete('aba');
    else next.set('aba', t);
    setParams(next, { replace: true });
  };
  const meta = useMetaLeads();
  const isAdmin = !team || team.role === 'admin';
  const ownerId = team?.ownerId ?? session?.userId ?? '';
  const bar = (
    <div role="tablist" aria-label="Partes do Engajamento social" className="flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => go(t.id)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-bold', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink')}
        >
          {t.label}
          {t.id === 'meta' && meta.data && meta.data.leads.length > 0 && <span className="ml-1.5 text-ink-faint">{meta.data.leads.length}</span>}
        </button>
      ))}
    </div>
  );
  if (tab === 'visao') return <SocialQueue tabs={bar} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Engajamento social"
        subtitle="Leads dos formulários de anúncio do Facebook e do Instagram, pela API oficial da Meta, com o Beelie no primeiro contato."
      />
      {bar}
      {meta.error && <ErrorBox>{meta.error}</ErrorBox>}
      {tab === 'meta' && <MetaLeadsTab ctx={meta} goConfig={() => go('config')} />}
      {tab === 'conversas' && <ConversationsTab />}
      {tab === 'automacoes' && <AutomationsTab ctx={meta} goConfig={() => go('config')} />}
      {tab === 'relatorios' && <ReportsTab ctx={meta} />}
      {tab === 'config' && (
        <div className="space-y-6">
          <MetaConfig ctx={meta} isAdmin={isAdmin} ownerId={ownerId} />
          <QueueSettings ownerId={ownerId} canWrite={!team || team.role !== 'leitura'} />
        </div>
      )}
    </div>
  );
}

/** Ajustes da fila de engajamento (os mesmos do botão Ajustes da Visão geral). */
function QueueSettings({ ownerId, canWrite }: { ownerId: string; canWrite: boolean }) {
  const { toast } = useApp();
  const [settings, setSettings] = useState<EngSettings | null>(null);
  useEffect(() => {
    loadSettings().then(setSettings, () => setSettings(null));
  }, []);
  if (!settings) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-[15px] font-bold">Fila de engajamento (Instagram e LinkedIn)</h2>
      <SettingsCard initial={settings} ownerId={ownerId} canWrite={canWrite} onSaved={(s) => { setSettings(s); toast('Ajustes salvos.', 'success'); }} />
    </div>
  );
}

/** Engajamento social assistido: o OxySDR encontra e escreve; você envia na rede e marca como feito. */
function SocialQueue({ tabs }: { tabs: ReactNode }) {
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
  const [liked, setLiked] = useState(0);

  const load = useCallback(async () => {
    try {
      const [q, s, l] = await Promise.all([loadQueue(today()), loadSettings(), likesToday(today()).catch(() => 0)]);
      setLiked(l);
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
        subtitle="O OxySDR encontra os perfis e posts e escreve o texto no tom do Beelie. Comentários e convites você envia na rede e marca como feito. Curtir pode ser automático (API oficial da Meta, nos Ajustes)."
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
      {tabs}

      {error && <ErrorBox>{error}</ErrorBox>}
      {notes.length > 0 && (
        <div className="card space-y-1 p-4 text-sm text-ink-2">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {settings?.autoLike && (
        <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
          <Heart size={18} className="text-accent" />
          <span>
            <b>Curtida automática ligada:</b> {liked} de {settings.dailyLikes} curtidas hoje. O OxySDR curte um post por vez, com intervalo, entre 8h e 21h.
          </span>
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
  const li = item.channel === 'linkedin' ? linkedinLinks(item) : null;
  const url = item.targetUrl || li?.linkedin || item.profileUrl;
  const isSearch = !!li?.isSearch;
  const canLike = item.channel === 'instagram' && !item.likedAt && (item.kind === 'resposta' ? !!item.externalId : !!item.mediaId);

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
        {item.likedAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-0.5 text-[12px] font-bold text-good">
            <Heart size={12} /> Curtido
          </span>
        )}
        {item.forDate < today() && <span className="text-[12px] font-semibold text-warn">desde {item.forDate.split('-').reverse().slice(0, 2).join('/')}</span>}
      </div>

      {item.likeError && !item.likedAt && <p className="mt-1 text-[12px] text-warn">Não curtiu: {item.likeError}</p>}
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
      {item.kind === 'convite' && (
        <p className="mt-1 text-[12px] text-ink-faint">
          {text.length}/300 caracteres. No perfil, clique em <b>Conectar</b> (às vezes dentro de <b>Mais</b>) → <b>Adicionar nota</b> e cole. Não use o botão <b>Mensagem</b>: para quem não é conexão ele pede o Premium (InMail). Depois do convite, a primeira mensagem entra na fila em 3 dias.
        </p>
      )}
      {item.kind === 'mensagem' && (
        <p className="mt-1 text-[12px] text-ink-faint">Envie só se o convite foi aceito: aí o botão Mensagem funciona sem Premium.</p>
      )}
      {item.kind === 'convite' && followUpOf(item) && <p className="mt-1 text-[12px] text-ink-faint">Mensagem preparada para depois: “{followUpOf(item).slice(0, 140)}…”</p>}

      {isSearch && (
        <label className="mt-3 block text-[13px]">
          <span className="text-ink-2">
            O botão abre a busca pelo nome no LinkedIn. Não achou?{' '}
            <a className="font-semibold text-accent hover:underline" href={li!.google} target="_blank" rel="noopener noreferrer">
              Procurar o perfil no Google
            </a>
            . Achou o perfil? Cole aqui para guardar (opcional):
          </span>
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
          {canLike && (
            <button className="btn btn-ghost" disabled={!canWrite || busy} onClick={() => void run(() => likeNow(item.id), 'Curtido no Instagram.')}>
              <Heart size={16} /> Curtir {item.kind === 'resposta' ? 'o comentário' : 'agora'}
            </button>
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
        {canLike && (
          <button className="btn btn-ghost" disabled={!canWrite || busy} onClick={() => void run(() => likeNow(item.id), 'Curtido no Instagram.')}>
            <Heart size={16} /> Curtir agora
          </button>
        )}
        <button className="btn btn-ghost" disabled={!canWrite || busy} onClick={() => void run(() => discard(item.id), 'Sugestão descartada.')}>
          <X size={18} /> Descartar
        </button>
      </div>
      )}
    </li>
  );
}

const THEME_IDEAS: EngTheme[] = [
  { name: 'Agentes de IA e automação', hashtags: ['inteligenciaartificial', 'automacao', 'agentesdeia'], enabled: true },
  { name: 'Gestão comercial', hashtags: ['vendasb2b', 'gestaocomercial', 'crm'], enabled: true },
  { name: 'Marketing digital', hashtags: ['marketingdigital', 'trafegopago', 'brandingempresarial'], enabled: true },
];
const tagsOf = (v: string) => [...new Set(v.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 8);

function SettingsCard({ initial, ownerId, canWrite, onSaved }: { initial: EngSettings; ownerId: string; canWrite: boolean; onSaved: (s: EngSettings) => void }) {
  const { toast } = useApp();
  // Temas: migra as hashtags avulsas antigas para um tema "Nicho" na primeira edição
  const [themes, setThemes] = useState<{ name: string; tags: string; enabled: boolean }[]>(() =>
    (initial.themes.length ? initial.themes : initial.hashtags.length ? [{ name: 'Nicho', hashtags: initial.hashtags, enabled: true }] : []).map((t) => ({
      name: t.name,
      tags: t.hashtags.map((h) => '#' + h.replace(/^#/, '')).join(' '),
      enabled: t.enabled,
    })),
  );
  const [share, setShare] = useState(initial.themeShare);
  const [ig, setIg] = useState(initial.dailyInstagram);
  const [li, setLi] = useState(initial.dailyLinkedin);
  const [roles, setRoles] = useState(initial.linkedinRoles);
  const [autoLike, setAutoLike] = useState(initial.autoLike);
  const [likes, setLikes] = useState(initial.dailyLikes);
  const [busy, setBusy] = useState(false);
  const totalTags = new Set(themes.filter((t) => t.enabled).flatMap((t) => tagsOf(t.tags))).size;
  const save = async () => {
    const list: EngTheme[] = themes
      .map((t) => ({ name: t.name.trim().slice(0, 60), hashtags: tagsOf(t.tags), enabled: t.enabled }))
      .filter((t) => t.name && t.hashtags.length)
      .slice(0, 10);
    const s: EngSettings = {
      hashtags: [],
      themes: list,
      themeShare: Math.min(100, Math.max(0, share)),
      dailyInstagram: Math.min(40, Math.max(0, ig)),
      dailyLinkedin: Math.min(40, Math.max(0, li)),
      linkedinRoles: roles.trim() || initial.linkedinRoles,
      autoLike,
      dailyLikes: Math.min(60, Math.max(0, likes)),
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
      <div className="md:col-span-2">
        <span className="label">Temas para comentar no Instagram</span>
        <p className="mb-2 text-[13px] text-ink-faint">
          Cada tema tem algumas hashtags. Todo dia o OxySDR sorteia os temas e as hashtags, pega posts recentes e escreve um comentário sobre o assunto de cada post. Você só cola e marca como feito (a curtida pode ser automática).
        </p>
        <div className="grid gap-2">
          {themes.map((t, i) => (
            <div key={i} className="grid gap-2 rounded-[14px] bg-ink/[0.03] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center">
              <input
                className="input"
                value={t.name}
                disabled={!canWrite}
                placeholder="Nome do tema"
                aria-label="Nome do tema"
                onChange={(e) => setThemes(themes.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className="input"
                value={t.tags}
                disabled={!canWrite}
                placeholder="#automacao #inteligenciaartificial"
                aria-label={`Hashtags do tema ${t.name}`}
                onChange={(e) => setThemes(themes.map((x, k) => (k === i ? { ...x, tags: e.target.value } : x)))}
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft">
                  <input type="checkbox" checked={t.enabled} disabled={!canWrite} onChange={(e) => setThemes(themes.map((x, k) => (k === i ? { ...x, enabled: e.target.checked } : x)))} />
                  Ativo
                </label>
                <button className="btn btn-ghost" disabled={!canWrite} aria-label={`Remover o tema ${t.name}`} onClick={() => setThemes(themes.filter((_, k) => k !== i))}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn btn-outline" disabled={!canWrite || themes.length >= 10} onClick={() => setThemes([...themes, { name: '', tags: '', enabled: true }])}>
            <Plus size={16} /> Adicionar tema
          </button>
          {!themes.length ? (
            <button
              className="btn btn-ghost"
              disabled={!canWrite}
              onClick={() => setThemes(THEME_IDEAS.map((t) => ({ name: t.name, tags: t.hashtags.map((h) => '#' + h).join(' '), enabled: true })))}
            >
              <Sparkles size={16} /> Usar sugestões de temas
            </button>
          ) : null}
          <span className={`text-[12px] ${totalTags > 30 ? 'font-semibold text-bad' : 'text-ink-faint'}`}>
            {totalTags} hashtags ativas · a Meta permite buscar até 30 hashtags diferentes por semana
          </span>
        </div>
      </div>
      <label className="block md:col-span-2">
        <span className="label">Divisão dos posts do Instagram: {100 - share}% leads · {share}% temas</span>
        <input type="range" min={0} max={100} step={10} value={share} disabled={!canWrite} onChange={(e) => setShare(Number(e.target.value))} className="w-full accent-[#4700ff]" />
        <span className="mt-1 block text-[12px] text-ink-faint">Leads: o último post de empresas da sua base. Temas: posts das hashtags acima. A busca por hashtag precisa do recurso "Instagram Public Content Access" aprovado pela Meta.</span>
      </label>
      <label className="block">
        <span className="label">Posts do Instagram por dia</span>
        <input className="input" type="number" min={0} max={40} value={ig} disabled={!canWrite} onChange={(e) => setIg(Number(e.target.value))} />
      </label>
      <div className="rounded-[14px] bg-ink/[0.03] p-3 md:col-span-2">
        <label className="flex items-center gap-2 text-[14px] font-semibold">
          <input type="checkbox" checked={autoLike} disabled={!canWrite} onChange={(e) => setAutoLike(e.target.checked)} />
          <Heart size={16} className="text-accent" /> Curtir automaticamente os posts da fila
        </label>
        <p className="mt-1 text-[13px] text-ink-faint">
          Usa a API oficial da Meta (permissão “Curtir posts e comentários”). Curte um post por vez, com intervalo de pelo menos 9 minutos, entre 8h e 21h, e também os comentários que deixarem nos posts da Oxycom. Não curte Stories nem contas privadas. Comentários continuam com você: a Meta não permite comentar automaticamente em posts de outras contas.
        </p>
        <label className="mt-2 block max-w-[240px]">
          <span className="label">Limite de curtidas por dia</span>
          <input className="input" type="number" min={0} max={60} value={likes} disabled={!canWrite || !autoLike} onChange={(e) => setLikes(Number(e.target.value))} />
          <span className="mt-1 block text-[12px] text-ink-faint">Recomendado: 20 a 30.</span>
        </label>
      </div>
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
