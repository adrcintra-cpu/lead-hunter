import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Abre/fecha o painel do lead preservando a página atual (?lead=id). */
export function useLeadDrawer() {
  const [params, setParams] = useSearchParams();
  const open = useCallback(
    (leadId: string) => {
      const next = new URLSearchParams(params);
      next.set('lead', leadId);
      setParams(next);
    },
    [params, setParams],
  );
  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('lead');
    setParams(next);
  }, [params, setParams]);
  return { open, close };
}
