import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '@/store/AppStore';
import { Spinner } from '@/components/ui';
import { AppShell } from './AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { SearchPage } from '@/features/search/SearchPage';
import { LeadsPage } from '@/features/leads/LeadsPage';
import { LeadPage } from '@/features/leads/LeadPage';
import { PipelinePage } from '@/features/pipeline/PipelinePage';
import { ListsPage } from '@/features/lists/ListsPage';
import { ListDetailPage } from '@/features/lists/ListDetailPage';
import { SavedSearchesPage } from '@/features/saved-searches/SavedSearchesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CampaignDetailPage, CampaignsPage } from '@/features/campaigns/CampaignsPage';
import { CadenceEditorPage, CadencesPage } from '@/features/cadences/CadencesPage';
import { TasksPage } from '@/features/tasks/TasksPage';

export function App() {
  const { session, loading, loadError, service, signOut } = useApp();
  if (session && loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6">
          <h1 className="text-lg font-extrabold">Não foi possível abrir seus dados</h1>
          <p className="mt-2 text-sm text-ink-soft">{loadError || 'Tente entrar novamente.'}</p>
          <p className="mt-2 text-xs text-ink-faint">Confira se a migration do Supabase foi aplicada e se a conexão está ativa.</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Tentar de novo</button>
            <button type="button" className="btn-ghost" onClick={signOut}>Sair</button>
          </div>
        </div>
      </div>
    );
  }
  if (loading || (session && !service)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="buscar" element={<SearchPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:leadId" element={<LeadPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="listas" element={<ListsPage />} />
        <Route path="listas/:listId" element={<ListDetailPage />} />
        <Route path="buscas" element={<SavedSearchesPage />} />
        <Route path="campanhas" element={<CampaignsPage />} />
        <Route path="campanhas/:campaignId" element={<CampaignDetailPage />} />
        <Route path="cadencias" element={<CadencesPage />} />
        <Route path="cadencias/:cadenceId" element={<CadenceEditorPage />} />
        <Route path="tarefas" element={<TasksPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
