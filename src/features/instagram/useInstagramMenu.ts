import { useEffect, useState } from 'react';
import { dataMode, supabase } from '@/lib/supabase';

/**
 * Mostrar o item "Instagram Agent" no menu? Admin sempre vê (para configurar e ligar);
 * o resto da equipe só depois que o módulo for ligado. Qualquer falha esconde o item, sem afetar o menu.
 */
export function useInstagramMenu(isAdmin: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (isAdmin || dataMode !== 'supabase' || !supabase) return;
    let alive = true;
    supabase
      .from('instagram_settings')
      .select('enabled')
      .maybeSingle()
      .then(
        ({ data }) => alive && setEnabled(!!data?.enabled),
        () => alive && setEnabled(false),
      );
    return () => {
      alive = false;
    };
  }, [isAdmin]);
  return isAdmin || enabled;
}
