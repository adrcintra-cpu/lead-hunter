// Navegação do BEELIE em menus de atendimento automático (leitura; quem grava é o servidor).
import { supabase } from '@/lib/supabase';

export type NavStatus =
  | 'MENU_DETECTADO'
  | 'NAVEGANDO_MENU'
  | 'AGUARDANDO_TRANSFERENCIA'
  | 'ATENDIMENTO_HUMANO_PROVAVEL'
  | 'RESPONSAVEL_IDENTIFICADO'
  | 'CONTATO_COMERCIAL_INICIADO'
  | 'BLOQUEADO_POR_CHATBOT'
  | 'SEM_RESPOSTA';

export interface NavStep {
  at: string;
  kind: string;
  chosen?: { n: string; label: string };
  sent?: string;
  reason: string;
  result: string;
}

export interface MenuNavigation {
  id: string;
  leadId: string;
  status: NavStatus;
  attendance: 'automatizado' | 'humano_provavel' | 'indefinido';
  steps: number;
  path: NavStep[];
  humanEvidence: string | null;
  contact: Record<string, string> | null;
  nextAction: string | null;
  startedAt: string;
  closedAt: string | null;
}

export const NAV_STATUS_LABEL: Record<NavStatus, string> = {
  MENU_DETECTADO: 'Menu detectado',
  NAVEGANDO_MENU: 'Navegando no menu',
  AGUARDANDO_TRANSFERENCIA: 'Aguardando atendente',
  ATENDIMENTO_HUMANO_PROVAVEL: 'Atendimento humano provável',
  RESPONSAVEL_IDENTIFICADO: 'Responsável identificado',
  CONTATO_COMERCIAL_INICIADO: 'Contato comercial iniciado',
  BLOQUEADO_POR_CHATBOT: 'Bloqueado por chatbot',
  SEM_RESPOSTA: 'Sem resposta',
};

export const ATTENDANCE_LABEL = { automatizado: 'Automatizado', humano_provavel: 'Humano provável', indefinido: 'Indefinido' } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map = (r: any): MenuNavigation => ({
  id: r.id,
  leadId: r.lead_id,
  status: r.status,
  attendance: r.attendance,
  steps: r.steps ?? 0,
  path: Array.isArray(r.path) ? r.path : [],
  humanEvidence: r.human_evidence ?? null,
  contact: r.contact ?? null,
  nextAction: r.next_action ?? null,
  startedAt: r.started_at,
  closedAt: r.closed_at ?? null,
});

const COLS = 'id, lead_id, status, attendance, steps, path, human_evidence, contact, next_action, started_at, closed_at';

export const menuNavApi = {
  /** Tentativa mais recente do lead (ou null). */
  async latest(leadId: string): Promise<MenuNavigation | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from('chatbot_navigations').select(COLS).eq('lead_id', leadId).order('started_at', { ascending: false }).limit(1);
    if (error || !data?.length) return null;
    return map(data[0]);
  },
  /** Tentativas desde uma data (para os indicadores). */
  async since(sinceIso: string): Promise<MenuNavigation[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('chatbot_navigations').select(COLS).gte('started_at', sinceIso).order('started_at', { ascending: false }).limit(2000);
    if (error) return [];
    return (data ?? []).map(map);
  },
};

const REACHED: NavStatus[] = ['ATENDIMENTO_HUMANO_PROVAVEL', 'CONTATO_COMERCIAL_INICIADO', 'RESPONSAVEL_IDENTIFICADO'];

/** Indicadores da navegação em menus. */
export function navStats(list: MenuNavigation[]) {
  const total = list.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const human = list.filter((n) => REACHED.includes(n.status)).length;
  const blocked = list.filter((n) => n.status === 'BLOQUEADO_POR_CHATBOT').length;
  return {
    menus: total,
    steps: list.reduce((a, n) => a + n.steps, 0),
    humanRate: pct(human),
    responsible: list.filter((n) => n.status === 'RESPONSAVEL_IDENTIFICADO').length,
    started: list.filter((n) => n.status === 'CONTATO_COMERCIAL_INICIADO' || n.status === 'RESPONSAVEL_IDENTIFICADO').length,
    blockedRate: pct(blocked),
  };
}
