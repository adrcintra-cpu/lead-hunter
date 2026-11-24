import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Bookmark, CheckSquare, Kanban, LayoutDashboard, List, LogOut, Megaphone, Rows3, Settings, Sparkles, Workflow, Send, AtSign, HeartHandshake, Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { SimClock } from './SimClock';
import { useApp, useDb } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { cx, ThemeSwitcher, Toasts } from '@/components/ui';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { useInstagramMenu } from '@/features/instagram/useInstagramMenu';
import { OxyhubSwitcherTop, OxyhubSystemsList } from '@/components/OxyhubSwitcher';
import { clearHubLoginAttempt, HUB_URL } from '@/lib/oxyhub';

type Item = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };
/** Menu lateral no padrão Oxyhub: seções em maiúsculas. */
const GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Visão geral', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Prospecção',
    items: [
      { to: '/buscar', label: 'Buscar Leads', icon: Sparkles },
      { to: '/leads', label: 'Leads', icon: Rows3 },
      { to: '/pipeline', label: 'Pipeline', icon: Kanban },
      { to: '/listas', label: 'Listas', icon: List },
      { to: '/buscas', label: 'Buscas', icon: Bookmark },
    ],
  },
  {
    label: 'Engajamento',
    items: [
      { to: '/campanhas', label: 'Campanhas', icon: Megaphone },
      { to: '/cadencias', label: 'Cadências', icon: Workflow },
      { to: '/envios', label: 'Envios', icon: Send },
      { to: '/instagram', label: 'Instagram Agent', icon: AtSign },
      { to: '/engajamento', label: 'Engajamento social', icon: HeartHandshake },
    ],
  },
  { label: 'Operação', items: [{ to: '/tarefas', label: 'Tarefas', icon: CheckSquare }] },
  { label: 'Sistema', items: [{ to: '/configuracoes', label: 'Configurações', icon: Settings }] },
];
const NAV = GROUPS.flatMap((g) => g.items);

/** Atalhos da barra inferior (só no celular). */
const DOCK = ['/', '/buscar', '/pipeline', '/instagram'];
const DOCK_LABEL: Record<string, string> = { '/': 'Dashboard', '/buscar': 'Buscar', '/pipeline': 'Pipeline', '/instagram': 'Instagram' };

export function AppShell() {
  const { session, signOut, team } = useApp();
  useEffect(() => {
    if (session) clearHubLoginAttempt();
  }, [session]);
  const [params] = useSearchParams();
  const leadId = params.get('lead');
  const openTasks = useDb().tasks.filter((t) => t.status === 'aberta').length;
  const showInstagram = useInstagramMenu(!team || team.role === 'admin');
  const nav = NAV.filter((n) => n.to !== '/instagram' || showInstagram);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sdr.sidebar') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('sdr.sidebar', c ? '0' : '1');
      } catch {
        /* ignora */
      }
      return !c;
    });
  const { pathname } = useLocation();
  // Nome da aba no padrão Oxyhub: "Página · OxySDR · Oxyhub"
  useEffect(() => {
    const all = GROUPS.flatMap((g) => g.items);
    const hit = all.find((i) => (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(i.to + '/')));
    document.title = `${hit?.label ?? 'OxySDR'}${hit ? ' · OxySDR' : ''} · Oxyhub`;
  }, [pathname]);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const link = ({ to, label, icon: Icon, end }: Item, onPick?: () => void, mini = false) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onPick}
      data-oxyhub-item={label}
      title={mini ? label : undefined}
      className={cx('oxy-nav-item', mini && '!justify-center !px-0')}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {!mini && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!mini && to === '/tarefas' && openTasks > 0 && (
        <span className="oxy-nav-badge">{openTasks}</span>
      )}
    </NavLink>
  );
  const navLinks = (onPick?: () => void, mini = false) =>
    GROUPS.map((g) => {
      const items = g.items.filter((i) => nav.includes(i));
      if (!items.length) return null;
      return (
        <div key={g.label} className="flex flex-col gap-1" data-oxyhub-section={g.label}>
          {!mini && <span className="oxy-nav-label">{g.label}</span>}
          {items.map((i) => link(i, onPick, mini))}
        </div>
      );
    });
  const logo = (
    <>
      <img src="/brand/oxyhub-logo.svg" alt="Oxyhub" className="h-[33px] w-auto dark:hidden" />
      <img src="/brand/oxyhub-logo-white.svg" alt="Oxyhub" className="hidden h-[33px] w-auto dark:block" />
    </>
  );

  const account = (
    <div className="flex items-center justify-between gap-2 rounded-lg px-1">
      <span className="min-w-0 text-xs text-ink-faint" title={session?.email}>
        <span className="block truncate">{session?.email}</span>
        {team && team.role !== 'admin' && <span className="block text-[11px] font-semibold">{team.role === 'vendedor' ? 'Vendedor' : 'Só leitura'}</span>}
      </span>
      <button type="button" onClick={signOut} className="btn-ghost min-h-[32px] px-2" aria-label="Sair" title="Sair">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-clip md:flex md:flex-col md:overflow-x-visible">
      {/* Celular: topo fixo com o símbolo e o menu */}
      <header className="fixed inset-x-0 top-0 z-30 glass-bar flex h-14 items-center gap-3 px-4 pt-[env(safe-area-inset-top)] md:hidden" style={{ boxSizing: 'content-box' }}>
        <button type="button" onClick={() => setMenuOpen(true)} className="glass-btn grid h-10 w-10 place-items-center rounded-full" aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="menu-celular">
          <Menu className="h-5 w-5" />
        </button>
        <a href={HUB_URL} aria-label="Oxyhub · tela inicial" className="flex items-center">
          <span className="flex [&_img]:h-7">{logo}</span>
        </a>
      </header>

      {/* Celular: gaveta do menu (todas as páginas, tema e conta) */}
      <div className={cx('fixed inset-0 z-50 md:hidden', menuOpen ? '' : 'pointer-events-none')} aria-hidden={!menuOpen}>
        <div className={cx('absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity', menuOpen ? 'opacity-100' : 'opacity-0')} onClick={() => setMenuOpen(false)} />
        <aside
          id="menu-celular"
          aria-label="Menu"
          className={cx(
            'absolute inset-y-0 right-0 glass-strong flex w-[min(84vw,320px)] flex-col overflow-y-auto rounded-l-[24px] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl transition-transform duration-200',
            menuOpen ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex h-14 items-center justify-between px-4">
            <span className="flex items-center gap-3 [&_img]:h-7">{logo}<span className="border-l border-ink/15 pl-3 text-sm font-semibold text-ink-soft">OxySDR</span></span>
            <button type="button" onClick={() => setMenuOpen(false)} className="btn-ghost -mr-1 min-h-[40px] px-2" aria-label="Fechar menu">
              <X className="h-6 w-6" />
            </button>
          </div>
          <nav aria-label="Navegação" className="flex flex-col gap-1 px-3 pt-2">{navLinks(() => setMenuOpen(false))}</nav>
          <div className="mx-3 mt-5 border-t border-ink/10 pt-3">
            <OxyhubSystemsList />
          </div>
          <div className="mt-auto flex flex-col gap-3 p-3 pt-6">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold text-ink-faint">Tema</span>
              <ThemeSwitcher compact />
            </div>
            {account}
          </div>
        </aside>
      </div>

      {/* Celular: palco suspenso com os atalhos principais */}
      <nav aria-label="Atalhos" className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-30 md:hidden">
        <div className="glass-strong flex w-full items-stretch justify-around gap-1 rounded-[24px] p-[7px]">
          {nav.filter((n) => DOCK.includes(n.to)).map(({ to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] text-[11px] transition-colors',
                  isActive ? 'glass-chip font-bold text-accent' : 'font-medium text-ink-soft',
                )
              }
            >
              <Icon className="h-[22px] w-[22px]" aria-hidden />
              {DOCK_LABEL[to]}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Computador: barra do topo no padrão Oxyhub */}
      <header className="glass-bar sticky top-0 z-30 hidden h-16 items-center gap-3 px-6 md:flex">
        <a href={HUB_URL} className="flex items-center" aria-label="Oxyhub · tela inicial" title="Tela inicial do Oxyhub">
          {logo}
        </a>
        <NavLink to="/" className="flex items-center" aria-label="Ir para o Dashboard do OxySDR">
          <span className="border-l border-ink/15 pl-4 text-sm font-semibold text-ink-soft">OxySDR</span>
        </NavLink>
        <div className="flex-1" />
        <OxyhubSwitcherTop />
        <ThemeSwitcher compact />
        <span className="hidden text-sm text-ink-soft lg:inline" title={session?.email}>
          {session?.email?.split('@')[0]}
          {team && team.role !== 'admin' && <span className="ml-1.5 text-[11px] font-semibold text-ink-faint">({team.role === 'vendedor' ? 'Vendedor' : 'Só leitura'})</span>}
        </span>
        <button type="button" onClick={signOut} className="glass-btn grid h-10 w-10 place-items-center rounded-full" aria-label="Sair" title="Sair">
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </header>

      {/* Menu suspenso a 12px da borda esquerda (padrão Oxyhub); o conteúdo tem o próprio respiro */}
      <div className="md:flex md:flex-1 md:items-start md:gap-6">
        <nav
          data-oxyhub-nav
          aria-label="Navegação principal"
          className={cx('glass oxy-sidenav hidden md:flex', collapsed ? 'w-[72px]' : 'w-[248px]')}
        >
          {navLinks(undefined, collapsed)}
          <button type="button" onClick={toggle} className={cx('oxy-nav-item mt-3', collapsed && '!justify-center !px-0')} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            {!collapsed && 'Recolher'}
          </button>
          {!collapsed && (
            <div className="mt-3 flex flex-col gap-3 border-t border-ink/10 px-1 pt-3">
              <SimClock />
              {dataMode === 'mock' && (
                <div className="glass-chip rounded-[10px] p-3">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="h-2 w-2 rounded-full bg-warn-fill" />
                    Modo mock
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">Dados fictícios. Nenhuma API externa conectada.</p>
                </div>
              )}
            </div>
          )}
        </nav>
        <main className="min-w-0 flex-1 px-4 pb-[calc(124px+env(safe-area-inset-bottom))] pt-[calc(80px+env(safe-area-inset-top))] md:pb-20 md:pl-0 md:pr-6 md:pt-6 2xl:pr-12">
          {team?.role === 'leitura' && (
            <div role="status" className="mb-4 rounded-lg bg-warn-soft px-4 py-2.5 text-[13px] text-ink-soft">
              Seu acesso é <b>só de leitura</b>: você vê tudo, mas alterações não são salvas.
            </div>
          )}
          <Outlet />
        </main>
      </div>
      {leadId && <LeadDrawer leadId={leadId} />}
      <Toasts />
    </div>
  );
}
