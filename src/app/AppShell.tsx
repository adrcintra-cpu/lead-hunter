import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Bookmark, CheckSquare, Kanban, LayoutDashboard, List, LogOut, Megaphone, Rows3, Settings, Sparkles, Workflow, Send, AtSign, Menu, X } from 'lucide-react';
import { SimClock } from './SimClock';
import { useApp, useDb } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { cx, ThemeSwitcher, Toasts } from '@/components/ui';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { OxyhubLogo, OxyhubMark } from '@/components/OxyhubLogo';
import { useInstagramMenu } from '@/features/instagram/useInstagramMenu';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/buscar', label: 'Buscar Leads', icon: Sparkles },
  { to: '/leads', label: 'Leads', icon: Rows3 },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/campanhas', label: 'Campanhas', icon: Megaphone },
  { to: '/cadencias', label: 'Cadências', icon: Workflow },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { to: '/envios', label: 'Envios', icon: Send },
  { to: '/instagram', label: 'Instagram Agent', icon: AtSign },
  { to: '/listas', label: 'Listas', icon: List },
  { to: '/buscas', label: 'Buscas', icon: Bookmark },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

/** Atalhos da barra inferior (só no celular). */
const DOCK = ['/', '/buscar', '/pipeline', '/instagram'];
const DOCK_LABEL: Record<string, string> = { '/': 'Dashboard', '/buscar': 'Buscar', '/pipeline': 'Pipeline', '/instagram': 'Instagram' };

export function AppShell() {
  const { session, signOut, team } = useApp();
  const [params] = useSearchParams();
  const leadId = params.get('lead');
  const openTasks = useDb().tasks.filter((t) => t.status === 'aberta').length;
  const showInstagram = useInstagramMenu(!team || team.role === 'admin');
  const nav = NAV.filter((n) => n.to !== '/instagram' || showInstagram);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
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

  const navLinks = (onPick?: () => void) =>
    nav.map(({ to, label, icon: Icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        onClick={onPick}
        className={({ isActive }) =>
          cx(
            'flex min-h-[38px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
            isActive ? 'bg-muted font-bold text-ink' : 'font-medium text-ink-soft hover:bg-muted hover:text-ink',
          )
        }
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
        {label}
        {to === '/tarefas' && openTasks > 0 && (
          <span className="ml-auto rounded-full bg-warn-soft px-1.5 text-[11px] font-bold text-warn">{openTasks}</span>
        )}
      </NavLink>
    ));

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
    <div className="min-h-screen overflow-x-clip md:grid md:grid-cols-[236px_minmax(0,1fr)] md:overflow-x-visible">
      {/* Celular: topo fixo com o símbolo e o menu */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-subtle/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden" style={{ boxSizing: 'content-box' }}>
        <NavLink to="/" aria-label="Ir para o Dashboard" className="-ml-1 rounded-lg p-1">
          <OxyhubMark className="h-8 w-8" />
        </NavLink>
        <button type="button" onClick={() => setMenuOpen(true)} className="btn-ghost -mr-1 min-h-[40px] px-2" aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="menu-celular">
          <Menu className="h-6 w-6" />
        </button>
      </header>

      {/* Celular: gaveta do menu (todas as páginas, tema e conta) */}
      <div className={cx('fixed inset-0 z-50 md:hidden', menuOpen ? '' : 'pointer-events-none')} aria-hidden={!menuOpen}>
        <div className={cx('absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity', menuOpen ? 'opacity-100' : 'opacity-0')} onClick={() => setMenuOpen(false)} />
        <aside
          id="menu-celular"
          aria-label="Menu"
          className={cx(
            'absolute inset-y-0 right-0 flex w-[min(84vw,320px)] flex-col overflow-y-auto border-l border-line bg-subtle pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl transition-transform duration-200',
            menuOpen ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex h-14 items-center justify-between px-4">
            <OxyhubLogo className="h-6 w-auto" />
            <button type="button" onClick={() => setMenuOpen(false)} className="btn-ghost -mr-1 min-h-[40px] px-2" aria-label="Fechar menu">
              <X className="h-6 w-6" />
            </button>
          </div>
          <nav aria-label="Navegação" className="flex flex-col gap-1 px-3 pt-2">{navLinks(() => setMenuOpen(false))}</nav>
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
        <div className="mx-auto flex max-w-[440px] items-stretch justify-around gap-1 rounded-2xl border border-line/70 bg-surface/70 p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl backdrop-saturate-150">
          {nav.filter((n) => DOCK.includes(n.to)).map(({ to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-colors',
                  isActive ? 'bg-muted font-bold text-[#3E00FF] dark:text-ink' : 'font-medium text-ink-soft',
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {DOCK_LABEL[to]}
            </NavLink>
          ))}
        </div>
      </nav>

      <aside className="hidden border-line bg-subtle md:sticky md:top-0 md:flex md:h-screen md:flex-col md:overflow-y-auto md:border-r">
        <div className="px-5 pb-3 pt-5">
          <OxyhubLogo className="h-7 w-auto" />
          <div className="mt-1.5 text-[11.5px] text-ink-faint">Lead Hunter</div>
        </div>
        <nav aria-label="Navegação principal" className="flex flex-col gap-1 px-3 pt-3">{navLinks()}</nav>
        <div className="mt-auto flex flex-col gap-3 p-3">
          <SimClock />
          {dataMode === 'mock' && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="h-2 w-2 rounded-full bg-warn" />
                Modo mock
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">Dados fictícios. Nenhuma API externa conectada.</p>
            </div>
          )}
          <ThemeSwitcher compact />
          {account}
        </div>
      </aside>
      <main className="min-w-0 px-4 pb-[calc(112px+env(safe-area-inset-bottom))] pt-[calc(80px+env(safe-area-inset-top))] md:px-10 md:pb-20 md:pt-8">
        {team?.role === 'leitura' && (
          <div role="status" className="mb-4 rounded-lg bg-warn-soft px-4 py-2.5 text-[13px] text-ink-soft">
            Seu acesso é <b>só de leitura</b>: você vê tudo, mas alterações não são salvas.
          </div>
        )}
        <Outlet />
      </main>
      {leadId && <LeadDrawer leadId={leadId} />}
      <Toasts />
    </div>
  );
}
