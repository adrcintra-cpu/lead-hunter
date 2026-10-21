// Descobre o WhatsApp das empresas encontradas no Google, que só informa o telefone:
// 1) consulta no WhatsApp conectado do usuário se o telefone (inclusive fixo com WhatsApp Business)
//    tem WhatsApp — só consulta, não manda mensagem;
// 2) quem tem site: procura no site o link do WhatsApp (wa.me / api.whatsapp.com) e o e-mail de contato
//    (mailto, texto, Cloudflare; abre a página de contato se a inicial não tiver).

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
const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|example|sentry|wixpress|domain\.|dominio\.|seu-?email|youremail|email\.com$|teste?@|no-?reply|nao-?responda|@2x|@3x|godaddy|wordpress|w3\.org|schema\.org/i;
const GOOD_BOX = /^(contato|comercial|vendas|atendimento|faleconosco|fale|sac|orcamento|orcamentos|compras|financeiro|adm|administrativo|diretoria|rh|marketing|info|contact)\b/i;

/** E-mails escondidos pela proteção do Cloudflare (data-cfemail="…"). */
function cfDecode(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.includes('@') ? out : null;
}

/** Todos os e-mails de uma página (mailto, texto e Cloudflare), sem lixo de imagens e exemplos. */
export function emailsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const text = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, '@');
  for (const m of text.matchAll(EMAIL)) found.add(m[0].toLowerCase().replace(/^(?:mailto:|u003e|x40)/, ''));
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const e = cfDecode(m[1] ?? m[2]);
    if (e) found.add(e.toLowerCase());
  }
  return [...found].filter((e) => e.length <= 80 && !JUNK_EMAIL.test(e));
}

/** O melhor e-mail para falar com a empresa: do domínio do site e de caixa comercial primeiro. */
export function pickEmail(emails: string[], host: string): string | null {
  const base = host.replace(/^www\./, '').toLowerCase();
  const root = base.split('.')[0];
  const rank = (e: string) => {
    const [box, dom] = e.split('@');
    return (dom === base || dom.endsWith(`.${base}`) || dom.split('.')[0] === root ? 0 : 2) + (GOOD_BOX.test(box) ? 0 : 1);
  };
  return [...emails].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

async function getPage(url: string, fetchImpl: Fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadHunter/1.0)' } });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  }
}

/** Contatos publicados no site da empresa: WhatsApp (wa.me / api.whatsapp.com) e e-mail. Abre a página de contato se a inicial não tiver e-mail. */
export async function scanSite(site: string, fetchImpl: Fetch = fetch): Promise<{ whatsapp: string | null; email: string | null }> {
  const host = site.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  if (!host || !host.includes('.')) return { whatsapp: null, email: null };
  const html = await getPage(`https://${host}`, fetchImpl);
  if (!html) return { whatsapp: null, email: null };
  const wa = WA_LINK.exec(html);
  let whatsapp = wa ? nationalPhone(wa[1]) : null;
  let emails = emailsFromHtml(html);
  if (!emails.length) {
    const link = /href="([^"]*(?:contato|contact|fale-conosco|faleconosco|atendimento)[^"]*)"/i.exec(html)?.[1];
    if (link && !/^(mailto|tel|javascript|https?:\/\/(?:wa\.me|api\.whatsapp))/i.test(link)) {
      let url: string | null = null;
      try {
        const u = new URL(link, `https://${host}/`);
        if (u.hostname.replace(/^www\./, '') === host.replace(/^www\./, '')) url = u.toString();
      } catch { /* link inválido */ }
      const page = url ? await getPage(url, fetchImpl) : null;
      if (page) {
        emails = emailsFromHtml(page);
        if (!whatsapp) {
          const w = WA_LINK.exec(page);
          whatsapp = w ? nationalPhone(w[1]) : null;
        }
      }
    }
  }
  return { whatsapp, email: pickEmail(emails, host) };
}

/** WhatsApp publicado no site da empresa (link wa.me ou api.whatsapp.com). */
export async function whatsappFromSite(site: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  return (await scanSite(site, fetchImpl)).whatsapp;
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
export const newBudget = (sites = 24, ms = 20_000): EnrichBudget => ({ sites, until: Date.now() + ms });

export async function enrichWhatsapp(list: RawCompany[], ownerId: string | null, fetchImpl: Fetch = fetch, budget: EnrichBudget = newBudget()): Promise<{ confirmed: number; fromSite: number; emails: number }> {
  const out = { confirmed: 0, fromSite: 0, emails: 0 };
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
  // Site da empresa: WhatsApp (para quem ainda não tem) e e-mail (até 16 por vez, 6 em paralelo).
  const take = Date.now() < budget.until ? Math.max(0, Math.min(16, budget.sites)) : 0;
  const toScan = list.filter((c) => c.website && (!c.whatsapp || !c.email)).sort((x, y) => Number(!!x.whatsapp) - Number(!!y.whatsapp)).slice(0, take);
  budget.sites -= toScan.length;
  const sites: RawCompany[] = [];
  await pool(toScan, 6, async (c) => {
    if (Date.now() > budget.until) return;
    const r = await scanSite(c.website!, fetchImpl);
    if (r.email && !c.email) {
      c.email = r.email;
      out.emails++;
    }
    if (r.whatsapp && !c.whatsapp) {
      c.whatsapp = formatPhone(r.whatsapp);
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
