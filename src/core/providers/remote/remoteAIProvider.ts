import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProvider } from '../types';

/**
 * Chama a Edge Function `ai`, que fala com a Claude API no servidor.
 * A chave da Claude nunca chega ao navegador.
 */
export function createRemoteAIProvider(client: SupabaseClient): AIProvider {
  async function call<T>(fn: string, input: unknown): Promise<T> {
    const { data, error } = await client.functions.invoke('ai', { body: { fn, input } });
    if (error) throw new Error(`Falha na IA (${fn}): ${error.message}`);
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
