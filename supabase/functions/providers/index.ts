// Edge Function `providers` — fontes de dados reais, no servidor.
//   { action: 'search', criteria }  → { companies: RawCompany[], center }   (Google Places)
//   { action: 'cnpj', cnpj }        → { company: Partial<RawCompany> | null } (BrasilAPI)
// A chave GOOGLE_PLACES_API_KEY existe só aqui: supabase secrets set GOOGLE_PLACES_API_KEY=...

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { searchPlaces } from '../_shared/providers/googlePlaces.ts';
import { lookupCnpj } from '../_shared/providers/brasilApi.ts';
import type { SearchCriteria } from '../_shared/providers/types.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: 'Não autenticado' }, 401);

  let body: { action?: string; criteria?: SearchCriteria; cnpj?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  try {
    if (body.action === 'search') {
      const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
      if (!key) return json({ error: 'GOOGLE_PLACES_API_KEY não configurada no servidor.' }, 500);
      const c = body.criteria;
      if (!c?.segment?.trim()) return json({ error: 'Informe um segmento.' }, 400);
      return json(await searchPlaces(key, c));
    }
    if (body.action === 'cnpj') {
      if (!body.cnpj) return json({ error: 'Informe o CNPJ.' }, 400);
      return json({ company: await lookupCnpj(body.cnpj) });
    }
    return json({ error: `Ação desconhecida: ${body.action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, msg === 'CNPJ inválido.' ? 400 : 502);
  }
});
