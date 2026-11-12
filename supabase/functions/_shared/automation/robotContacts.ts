// Atendimento automático que indica outro canal ("para reuniões, use direcao@escola.com"):
// o BEELIE guarda os contatos e manda o e-mail de apresentação, uma vez, para o mais adequado.

import { emailProblem } from './emailCheck.ts';
import { log } from './engine.ts';
import { readIntel } from './beelie.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;

/** Preferência pela parte antes do @: quem decide ou cuida de marketing/comercial primeiro. */
const RANK: { re: RegExp; label: string }[] = [
  { re: /marketing|mkt|comunica/, label: 'Marketing' },
  { re: /diret|direc|diretoria|ceo|socio|gerencia|gerente/, label: 'Direção' },
  { re: /comercial|vendas|negocios|parceri/, label: 'Comercial' },
  { re: /contato|atendimento|faleconosco|fale|info|ola|hello/, label: 'Atendimento' },
  { re: /secretaria|administra|adm\b|recepcao|escritorio/, label: 'Secretaria' },
];
/** Endereços que não servem para prospecção. */
const SKIP = /financeiro|cobranca|boleto|nfe|nota|fiscal|rh|curriculo|vagas|trabalhe|suporte|sac|ouvidoria|noreply|no-reply|naoresponda|nao-responda|privacidade|lgpd|dpo|juridico|orientacao|pedagog|compras/;

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function robotEmails(body: string): { email: string; label: string; rank: number }[] {
  const all = [...new Set((String(body).match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/[.,;]+$/, '')))];
  const out: { email: string; label: string; rank: number }[] = [];
  for (const email of all) {
    const local = norm(email.split('@')[0]);
    if (SKIP.test(local)) continue;
    const i = RANK.findIndex((r) => r.re.test(local));
    out.push({ email, label: i === -1 ? 'Equipe' : RANK[i].label, rank: i === -1 ? RANK.length : i });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/**
 * Mensagem de robô com e-mail para contato: anota no lead (memória do BEELIE) como contato indicado.
 * A rotina de e-mails de indicação envia a apresentação dentro do horário, uma vez por destinatário.
 * Devolve true quando havia um canal alternativo (o BEELIE não insiste no WhatsApp).
 */
export async function robotRedirect(db: Row, ownerId: string, leadId: string, body: string): Promise<boolean> {
  const options = robotEmails(body);
  if (!options.length) return false;
  const { data: lead } = await db.from('leads').select('id, beelie').eq('id', leadId).eq('owner_id', ownerId).maybeSingle();
  if (!lead) return false;
  const intel = readIntel(lead.beelie);
  const phones = [...new Set(String(body).match(PHONE) ?? [])].slice(0, 3);
  const listed = options.map((o) => o.email).join(', ');

  // Já existe um contato indicado: só registra os outros canais.
  if (intel.facts.referred_contact?.value) {
    await log(db, ownerId, leadId, 'lead_updated', `O atendimento automático indicou outros contatos: ${listed}${phones.length ? `; telefone ${phones.join(', ')}` : ''}.`, { kind: 'robot_contacts', emails: options.map((o) => o.email) });
    return true;
  }
  let chosen: (typeof options)[number] | null = null;
  for (const o of options) {
    if (!(await emailProblem(db, ownerId, o.email))) {
      chosen = o;
      break;
    }
  }
  if (!chosen) {
    await log(db, ownerId, leadId, 'lead_updated', `O atendimento automático indicou ${listed}, mas nenhum desses e-mails recebe mensagens (ou já voltou).`, { kind: 'robot_contacts', emails: options.map((o) => o.email) });
    return true;
  }
  const at = new Date().toISOString();
  intel.facts.referred_name = { value: chosen.label, status: 'confirmado', source: 'conversa', at };
  intel.facts.referred_contact = { value: chosen.email, status: 'confirmado', source: 'conversa', at };
  await db.from('leads').update({ beelie: intel }).eq('id', leadId).eq('owner_id', ownerId);
  await log(
    db,
    ownerId,
    leadId,
    'lead_updated',
    `O atendimento automático indicou contatos por e-mail (${listed}${phones.length ? `; telefone ${phones.join(', ')}` : ''}). O BEELIE vai mandar a apresentação por e-mail para ${chosen.email} (${chosen.label}), uma vez, no horário de envio.`,
    { kind: 'robot_contacts', emails: options.map((o) => o.email), chosen: chosen.email },
  );
  return true;
}
