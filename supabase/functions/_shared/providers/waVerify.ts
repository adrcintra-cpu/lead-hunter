// Descobre o WhatsApp das empresas encontradas no Google, que só informa o telefone:
// 1) consulta no WhatsApp conectado do usuário se o telefone (inclusive fixo com WhatsApp Business)
//    tem WhatsApp — só consulta, não manda mensagem;
// 2) quem continua sem WhatsApp e tem site: procura o link do WhatsApp no site (wa.me / api.whatsapp.com).

import type { RawCompany } from './types.ts';

type Fetch = typeof fetch;

const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k) ?? '';

/** DDD + número (10 ou 11 dígitos), sem 55 e sem 0. */
export function nationalPhone(raw?: string | null): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? d : null;
}

export function formatPhone(d: string): string {
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

/** Pergunta ao serviço do WhatsApp quais telefones têm WhatsApp. null = não deu para consultar. */
export async function checkViaService(ownerId: string, phones: string[], fetchImpl: Fetch = fetch): Promise<{ found: Set<string>; unchecked: Set<string> } | null> {
  const url = env('WHATSAPP_SERVICE_URL').trim().replace(/\/+$/, '');
  const secret = env('WHATSAPP_INBOUND_SECRET').trim();
  if (!url || !secret || !phones.length) return null;
  try {
    const res = await fetchImpl(`${url}/internal/wa-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
      body: JSON.stringify({ ownerId, phones }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { found?: string[]; unchecked?: string[] };
    return { found: new Set(j.found ?? []), unchecked: new Set(j.unchecked ?? []) };
  } catch {
    return null;
  }
}

const WA_LINK = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s]*&)?phone=|whatsapp\.com\/send\/?\?(?:[^"'\s]*&)?phone=)\+?(\d{10,13})/i;

/** WhatsApp publicado no site da empresa (link wa.me ou api.whatsapp.com). */
export async function whatsappFromSite(site: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const host = site.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  if (!host || !host.includes('.')) return null;
  try {
    const res = await fetchImpl(`https://${host}`, { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadHunter/1.0)' } });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 600_000);
    const m = WA_LINK.exec(html);
    const d = m ? nationalPhone(m[1]) : null;
    return d;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Completa o WhatsApp das empresas (altera a lista). Com o WhatsApp conectado, o resultado da consulta
 * vale como confirmado: celular sem WhatsApp deixa de contar como WhatsApp.
 */
/** Limite por busca: quantos sites abrir e até quando (o restante da busca não pode demorar demais). */
export interface EnrichBudget {
  sites: number;
  until: number;
}
export const newBudget = (sites = 20, ms = 45_000): EnrichBudget => ({ sites, until: Date.now() + ms });

export async function enrichWhatsapp(list: RawCompany[], ownerId: string | null, fetchImpl: Fetch = fetch, budget: EnrichBudget = newBudget()): Promise<{ confirmed: number; fromSite: number }> {
  const out = { confirmed: 0, fromSite: 0 };
  const pending = list.filter((c) => c.whatsappStatus !== 'confirmado' && nationalPhone(c.phone ?? c.whatsapp));
  const check = ownerId ? await checkViaService(ownerId, pending.map((c) => (c.phone ?? c.whatsapp)!), fetchImpl) : null;
  if (check) {
    for (const c of pending) {
      const raw = (c.phone ?? c.whatsapp)!;
      if (check.found.has(raw)) {
        c.whatsapp = formatPhone(nationalPhone(raw)!);
        c.whatsappStatus = 'confirmado';
        out.confirmed++;
      } else if (!check.unchecked.has(raw)) {
        c.whatsapp = undefined;
        c.whatsappStatus = 'desconhecido';
      }
    }
  }
  // Sem WhatsApp ainda e com site: procura o link no site (até 12 por vez, 4 em paralelo).
  const take = Date.now() < budget.until ? Math.max(0, Math.min(12, budget.sites)) : 0;
  const noWa = list.filter((c) => !c.whatsapp && c.website).slice(0, take);
  budget.sites -= noWa.length;
  const sites: RawCompany[] = [];
  await pool(noWa, 4, async (c) => {
    if (Date.now() > budget.until) return;
    const d = await whatsappFromSite(c.website!, fetchImpl);
    if (d) {
      c.whatsapp = formatPhone(d);
      c.whatsappStatus = 'provavel';
      sites.push(c);
    }
  });
  // O número do site também é conferido, quando dá.
  if (sites.length && ownerId) {
    const again = await checkViaService(ownerId, sites.map((c) => c.whatsapp!), fetchImpl);
    for (const c of sites) {
      if (again?.found.has(c.whatsapp!)) c.whatsappStatus = 'confirmado';
      else if (again && !again.unchecked.has(c.whatsapp!)) {
        c.whatsapp = undefined;
        c.whatsappStatus = 'desconhecido';
      }
    }
  }
  out.fromSite = sites.filter((c) => c.whatsapp).length;
  return out;
}
