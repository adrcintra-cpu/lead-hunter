// Antes de mandar e-mail de prospecção: o endereço tem cara de válido, o domínio recebe e-mail (MX)
// e nunca voltou como devolvido. Assim a campanha não queima a reputação do domínio com endereços mortos.

// deno-lint-ignore no-explicit-any
type Db = any;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const mxCache = new Map<string, boolean | null>();

/**
 * O domínio recebe e-mail? Consulta o DNS público (registros MX).
 * true = tem MX; false = domínio não existe ou não tem MX; null = não deu para consultar (não bloqueia).
 */
export async function domainReceivesEmail(domain: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const d = domain.trim().toLowerCase();
  if (mxCache.has(d)) return mxCache.get(d)!;
  let result: boolean | null = null;
  try {
    const r = await fetcher(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const j = await r.json();
      if (j.Status === 3) result = false; // NXDOMAIN: o domínio não existe
      else if (j.Status === 0) result = Array.isArray(j.Answer) && j.Answer.some((a: { type?: number; data?: string }) => a.type === 15 && !/^0 \.?$/.test(String(a.data ?? '').trim()));
    }
  } catch {
    result = null;
  }
  mxCache.set(d, result);
  return result;
}

/** Motivo para NÃO mandar e-mail a este endereço, ou null se pode mandar. */
export async function emailProblem(db: Db, ownerId: string, email: string | null | undefined, fetcher: typeof fetch = fetch): Promise<string | null> {
  const addr = (email ?? '').trim().toLowerCase();
  if (!addr) return 'sem e-mail';
  if (!EMAIL_RE.test(addr)) return 'e-mail com formato inválido';
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('channel', 'email')
    .ilike('recipient', addr)
    .like('failure_reason', 'Devolvido%');
  if ((count ?? 0) > 0) return 'e-mail já voltou como devolvido';
  const mx = await domainReceivesEmail(addr.split('@')[1], fetcher);
  if (mx === false) return 'o domínio do e-mail não recebe mensagens';
  return null;
}
