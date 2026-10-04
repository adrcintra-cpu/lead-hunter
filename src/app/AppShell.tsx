import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Bookmark, Kanban, LayoutDashboard, List, LogOut, Rows3, Settings, Sparkles } from 'lucide-react';
import { useApp } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { cx, ThemeSwitcher, Toasts } from '@/components/ui';
import { LeadDrawer } from '@/features/leads/LeadDrawer';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/buscar', label: 'Buscar Leads', icon: Sparkles },
  { to: '/leads', label: 'Leads', icon: Rows3 },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/listas', label: 'Listas', icon: List },
  { to: '/buscas', label: 'Buscas', icon: Bookmark },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export function AppShell() {
  const { session, signOut } = useApp();
  const [params] = useSearchParams();
  const leadId = params.get('lead');

  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-subtle md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6" />
              <path d="M20 20l-4.2-4.2" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-tight">Lead Hunter</div>
            <div className="hidden text-[11.5px] text-ink-faint md:block">Copiloto de prospecção</div>
          </div>
        </div>
        <nav aria-label="Navegação principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0 md:pt-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[40px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
                  isActive ? 'bg-muted font-bold text-ink' : 'font-medium text-ink-soft hover:bg-muted hover:text-ink',
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden flex-col gap-3 p-3 md:flex">
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
          <div className="flex items-center justify-between gap-2 rounded-lg px-1">
            <span className="truncate text-xs text-ink-faint" title={session?.email}>{session?.email}</span>
            <button type="button" onClick={signOut} className="btn-ghost min-h-[32px] px-2" aria-label="Sair" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 pb-20 pt-6 md:px-10 md:pt-8">
        <div className="mb-4 flex justify-end md:hidden">
          <ThemeSwitcher compact />
        </div>
        <Outlet />
      </main>
      {leadId && <LeadDrawer leadId={leadId} />}
      <Toasts />
    </div>
  );
}
