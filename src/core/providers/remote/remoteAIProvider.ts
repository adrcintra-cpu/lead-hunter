import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProvider } from '../types';

/**
 * Chama a Edge Function `ai`, que fala com a Claude API no servidor.
 * A chave da Claude nunca chega ao navegador.
 */
export function createRemoteAIProvider(client: SupabaseClient): AIProvider {
  async function call<T>(fn: string, input: unknown): Promise<T> {
    const { data, error } = await client.functions.invoke('ai', { body: { fn, input } });
    if (error) {
      // A função devolve o motivo no corpo da resposta; mostramos ele em vez do erro genérico.
      let detail = error.message;
      try {
        const ctx = (error as { context?: Response }).context;
        const payload = ctx ? await ctx.json() : null;
        if (payload?.error) detail = payload.error;
      } catch {
        /* mantém a mensagem genérica */
      }
      if (/ANTHROPIC_API_KEY/.test(detail)) {
        throw new Error('A IA ainda não está ligada: cadastre a chave da Claude no Supabase (secret ANTHROPIC_API_KEY).');
      }
      throw new Error(`Falha na IA: ${detail}`);
    }
    return data as T;
  }
  return {
    id: 'claude',
    model: 'claude (via Edge Function)',
    promptVersion: 'v2',
    parseSearchQuery: (text) => call('parseSearchQuery', { text }),
    analyzeCompany: (company, icp) => call('analyzeCompany', { company, icp }),
    summarizeCompany: (company) => call('summarizeCompany', { company }),
    adjustScore: (company, ruleScore, icp) => call('adjustScore', { company, ruleScore, icp }),
    generateApproach: (company, channel, options) => call('generateApproach', { company, channel, options }),
    classifyReply: (text, context) => call('classifyReply', { text, context }),
    summarizeResults: (snapshot) => call('summarizeResults', { snapshot }),
  };
}
