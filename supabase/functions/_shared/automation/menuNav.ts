// Navegação do BEELIE em menus de atendimento automático (WhatsApp).
// Objetivo: passar pelo robô da empresa, chegar a uma pessoa e pedir o responsável pelo marketing/comercial.
// O núcleo (classifyTurn, rankOptions, decide) é puro e testável; `navigate` persiste o estado em chatbot_navigations.

import { looksAutomated, menuOptions } from './replies.ts';

export type NavStatus =
  | 'MENU_DETECTADO'
  | 'NAVEGANDO_MENU'
  | 'AGUARDANDO_TRANSFERENCIA'
  | 'ATENDIMENTO_HUMANO_PROVAVEL'
  | 'RESPONSAVEL_IDENTIFICADO'
  | 'CONTATO_COMERCIAL_INICIADO'
  | 'BLOQUEADO_POR_CHATBOT'
  | 'SEM_RESPOSTA';

/** Status em que a tentativa termina (fica só como histórico). */
export const FINAL: NavStatus[] = ['RESPONSAVEL_IDENTIFICADO', 'CONTATO_COMERCIAL_INICIADO', 'BLOQUEADO_POR_CHATBOT', 'SEM_RESPOSTA'];

export type Opt = { n: string; label: string };
export interface NavStep {
  at: string;
  kind: 'menu' | 'rejeicao' | 'dados' | 'transferencia' | 'humano' | 'motivo' | 'bloqueio' | 'responsavel';
  menu?: Opt[];
  chosen?: Opt;
  sent?: string;
  reason: string;
  result: string;
}
export interface NavState {
  status: NavStatus;
  attendance: 'automatizado' | 'humano_provavel' | 'indefinido';
  steps: number;
  path: NavStep[];
  tried: { menu: string; n: string; how: 'numero' | 'texto' }[];
  human_evidence?: string | null;
  contact?: Record<string, string> | null;
  next_action?: string | null;
}

/** Primeira mensagem quando uma pessoa assume (o BEELIE sempre se apresenta como assistente virtual). */
export const APPROACH =
  'Olá, tudo bem? Sou o Beelie, assistente virtual da Oxycom. Você consegue me ajudar a falar com a pessoa responsável pelo marketing ou pela presença digital da empresa?';
/** Quando perguntam o motivo do contato. */
export const MOTIVE =
  'A Oxycom trabalha com soluções digitais para ajudar empresas a fortalecer sua presença no Google e gerar novas oportunidades comerciais. Queria entender com quem posso conversar sobre isso.';

// ---------------------------------------------------------------------------------------------
// Leitura da mensagem recebida

export type Turn =
  | { kind: 'menu'; options: Opt[]; buttons: boolean }
  | { kind: 'rejeicao' }
  | { kind: 'dados'; field: string; sensitive: boolean }
  | { kind: 'transferencia' }
  | { kind: 'robo' }
  | { kind: 'humano'; evidence: string }
  | { kind: 'livre' };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const REJECT = /nao (entendi|compreendi|consegui (entender|compreender)|reconheci)|opcao invalida|resposta invalida|nao (e|eh) uma opcao valida|escolha uma das opcoes|selecione uma das opcoes|digite (apenas |somente )?(o numero|uma das opcoes|uma opcao|um numero|a opcao)|responda (apenas |somente )?com (o numero|um numero)/;
const DATA =
  /\b(informe|informar|digite|envie|qual (e |eh )?(o |a )?(seu |sua )?|me (diga|informe|passe)|poderia (informar|me passar|me dizer)|preciso (do|da|de)|por favor,? (o|a|seu|sua))\b[^?.!\n]{0,40}?\b(nome completo|nome|cpf|cnpj|e-?mail|telefone|celular|empresa|razao social|assunto|motivo|cidade|documento|codigo|senha|data de nascimento|numero do pedido)\b/;
const SENSITIVE = /cpf|cnpj|documento|codigo|senha|nascimento|pedido|e-?mail|telefone|celular|cidade/;
const TRANSFER =
  /\b(transferi(ndo|do|da|r)|vou (te |lhe )?transferir|encaminhad[oa]|encaminhando|redirecionad[oa]|redirecionando|aguarde|em instantes|em breve (um|uma|o|a|nosso|nossa)|fila de atendimento|posicao na fila|(ja|logo) (vai|vao|ira|irao) (te |lhe )?atender|sera atendid[oa]|ira (te |lhe )?atender)\b/;
// Sinais de pessoa: apresentação pelo nome (nome com maiúscula no texto original), pergunta sobre o contato.
const NAME_INTRO = /\b(?:[Aa]qui (?:é|e) (?:[oa] )?|[Mm]eu nome (?:é|e) |[Ss]ou (?:[oa] )?|[Ff]ala (?:[oa] )?)\p{Lu}\p{Ll}{2,}/u;
const ASKS_US = /\b(do que se trata|sobre o que|qual (e |eh )?(o )?(assunto|motivo)|quem (fala|e voce|eh voce)|com quem (eu )?falo|o que (voce|vc) (precisa|deseja|gostaria)|em que posso (te |lhe )?ajudar|como posso (te |lhe )?ajudar|pois nao|pode falar|oxycom|beelie)\b/;
export const ASKS_MOTIVE = /\b(do que se trata|sobre o que (e|seria)|qual (e |eh |seria )?(o )?(assunto|motivo)|pra que|para que (seria|e)|qual (a )?finalidade|o que (voces|vcs) (fazem|oferecem))\b/;

export function classifyTurn(text: string): Turn {
  const raw = String(text ?? '');
  const t = norm(raw.replace(/^\[Áudio transcrito\]\s*/i, ''));
  const options = menuOptions(raw);
  const buttons = /^\[Botões\]/.test(raw);
  if (options.length >= 2 && (buttons || options.length >= 3 || looksAutomated(raw))) return { kind: 'menu', options, buttons };
  if (REJECT.test(t)) return { kind: 'rejeicao' };
  const d = DATA.exec(t);
  if (d) {
    const field = d[d.length - 1];
    return { kind: 'dados', field, sensitive: SENSITIVE.test(field) };
  }
  // Assinatura de atendente ("*Cinthia:* ...", plataformas de atendimento): é uma pessoa.
  const signed = /^[_*]{1,3}#?(\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?)[^:\n]{0,20}:[_*]{1,3}/u.exec(raw.trim());
  if (signed) return { kind: 'humano', evidence: `Mensagem assinada pela atendente ${signed[1]}` };
  if (TRANSFER.test(t) && !raw.includes('?')) return { kind: 'transferencia' };
  if (looksAutomated(raw)) return { kind: 'robo' };
  if (NAME_INTRO.test(raw)) return { kind: 'humano', evidence: `Apresentou-se pelo nome: “${raw.slice(0, 80)}”` };
  if (ASKS_US.test(t)) return { kind: 'humano', evidence: `Respondeu ao contexto: “${raw.slice(0, 80)}”` };
  return { kind: 'livre' };
}

// ---------------------------------------------------------------------------------------------
// Escolha da opção

const TIERS: { re: RegExp; why: string }[] = [
  { re: /portugu/, why: 'idioma português' },
  { re: /marketing|comunicacao|publicidade|propaganda|midia|branding|imprensa|redes sociais/, why: 'é a área de marketing' },
  { re: /comercial|vend(a|as|edor|edora|edores)\b|novos? (negocios|clientes)|parceri|negocios|representante comercial/, why: 'é a área comercial' },
  { re: /compras|suprimento|fornecedor|aquisic/, why: 'Compras costuma receber fornecedores e encaminhar' },
  { re: /administra|diretoria|gerencia|escritorio|institucional|gestao/, why: 'o administrativo costuma encaminhar ao responsável' },
  { re: /falar com (um |uma |o |a )?(atendente|pessoa|humano|consultor|especialista|colaborador)|atendente|atendimento|recepcao|relacionamento|\bsac\b|outros( assuntos)?|demais assuntos|duvidas|informac|contato|geral/, why: 'leva a um atendente' },
];
/** Nunca escolher: setores que não ajudam, sair/voltar, ou opções que exigiriam se passar por cliente. */
const NEVER =
  /financeir|cobranc|boleto|segunda via|2a via|contas a (pagar|receber)|faturamento|fiscal|nota fiscal|\brh\b|recursos humanos|curricul|vagas?\b|trabalhe|emprego|suporte|assistencia tecnica|garantia|ouvidoria|reclama|rastre|pedido|entrega|sair\b|voltar|encerrar|finalizar|menu (anterior|principal)|cancel|pagamento|\bpix\b|orcamento|cotacao|comprar|quero comprar|segunda-via/;

export type Ranked = Opt & { tier: number; why: string };

/** Opções em ordem de preferência (tier 0 = melhor; 6 = outro setor que pode encaminhar). */
export function rankOptions(options: Opt[], exclude: string[] = []): Ranked[] {
  const out: Ranked[] = [];
  for (const o of options) {
    if (exclude.includes(o.n)) continue;
    const l = norm(o.label);
    if (NEVER.test(l)) continue;
    const i = TIERS.findIndex((t) => t.re.test(l));
    out.push({ ...o, tier: i === -1 ? 6 : i, why: i === -1 ? 'outro setor que pode encaminhar' : TIERS[i].why });
  }
  return out.sort((a, b) => a.tier - b.tier || Number(a.n) - Number(b.n));
}

/** A IA só é consultada quando as regras não acham uma opção clara (nenhuma até "leva a um atendente"). */
export function needsAi(options: Opt[], exclude: string[] = []): boolean {
  const r = rankOptions(options, exclude);
  return !r.length || r[0].tier >= 6;
}

export const menuKey = (options: Opt[]) => options.map((o) => norm(o.label)).join('|').slice(0, 400);

// ---------------------------------------------------------------------------------------------
// Máquina de estados

export type Action =
  | { type: 'send'; text: string; template: 'menu' | 'humano' }
  | { type: 'wait' }
  | { type: 'block'; reason: string }
  | { type: 'pass' };

export interface DecideCtx {
  maxSteps: number;
  now?: Date;
  /** Última mensagem com menu nas mensagens anteriores (para quando o robô só diz "não entendi"). */
  lastMenuText?: string | null;
  /** Escolha da IA (já validada) para o menu desta mensagem. */
  aiPick?: { n: string; reason: string } | null;
  /** A mensagem chegou em segundos depois da última do BEELIE (sinal de máquina). */
  instant?: boolean;
}

export function freshState(): NavState {
  return { status: 'MENU_DETECTADO', attendance: 'automatizado', steps: 0, path: [], tried: [], human_evidence: null, contact: null, next_action: null };
}

const DATA_ANSWER: Record<string, string> = {
  nome: 'Beelie, assistente virtual da Oxycom',
  'nome completo': 'Beelie, assistente virtual da Oxycom',
  empresa: 'Oxycom',
  'razao social': 'Oxycom',
  assunto: 'Presença digital e Google: gostaria de falar com o responsável pelo marketing ou comercial.',
  motivo: 'Presença digital e Google: gostaria de falar com o responsável pelo marketing ou comercial.',
};

export function decide(prev: NavState | null, text: string, ctx: DecideCtx): { state: NavState | null; action: Action } {
  const at = (ctx.now ?? new Date()).toISOString();
  const turn = classifyTurn(text);
  if (!prev) {
    // Começa num menu, ou quando o robô recusa uma resposta em texto logo depois de mandar um menu.
    const rejectedText = turn.kind === 'rejeicao' && !!ctx.lastMenuText && menuOptions(ctx.lastMenuText).length >= 2;
    if (turn.kind !== 'menu' && !rejectedText) return { state: null, action: { type: 'pass' } };
    prev = freshState();
  }
  const s: NavState = { ...prev, path: [...prev.path], tried: [...prev.tried] };
  const block = (reason: string) => {
    s.status = 'BLOQUEADO_POR_CHATBOT';
    s.next_action = 'Tentar contato por outro canal (telefone, e-mail ou Instagram)';
    s.path.push({ at, kind: 'bloqueio', reason, result: 'Navegação encerrada' });
    return { state: s, action: { type: 'block', reason } as Action };
  };

  // Uma pessoa já assumiu: o BEELIE volta à conversa normal; a navegação termina.
  if (s.status === 'ATENDIMENTO_HUMANO_PROVAVEL' && turn.kind !== 'menu') {
    if (turn.kind === 'robo' || turn.kind === 'transferencia') return { state: s, action: { type: 'wait' } };
    s.status = 'CONTATO_COMERCIAL_INICIADO';
    s.next_action = 'Conversa com a pessoa: identificar o responsável pelo marketing';
    if (ASKS_MOTIVE.test(norm(text))) {
      s.path.push({ at, kind: 'motivo', sent: MOTIVE, reason: 'A pessoa perguntou o motivo do contato', result: 'Motivo explicado' });
      return { state: s, action: { type: 'send', text: MOTIVE, template: 'humano' } };
    }
    s.path.push({ at, kind: 'humano', reason: 'A pessoa respondeu', result: 'Conversa comercial iniciada' });
    return { state: s, action: { type: 'pass' } };
  }

  const chooseIn = (options: Opt[], buttons: boolean, why?: string) => {
    if (s.steps >= ctx.maxSteps) return block(`Limite de ${ctx.maxSteps} etapas atingido sem chegar a uma pessoa`);
    const key = menuKey(options);
    const triedHere = s.tried.filter((x) => x.menu === key);
    const triedNs = [...new Set(triedHere.map((x) => x.n))];
    // Mesmo menu de novo: a opção anterior não andou. Tenta outra no máximo uma vez.
    if (triedNs.length >= 2) return block('O mesmo menu voltou depois de duas opções diferentes (sem progresso)');
    const ranked = rankOptions(options, triedNs);
    let pick: Ranked | undefined = ranked[0] && ranked[0].tier < 6 ? ranked[0] : undefined;
    if (!pick && ctx.aiPick) {
      const o = ranked.find((r) => r.n === ctx.aiPick!.n);
      if (o) pick = { ...o, why: ctx.aiPick.reason || o.why };
    }
    pick ??= ranked[0];
    if (!pick) return block(triedNs.length ? 'Nenhuma outra opção do menu leva ao comercial' : 'Nenhuma opção do menu leva ao comercial ou a um atendente');
    const sent = buttons ? pick.label : pick.n;
    const reason = triedNs.length
      ? `O menu voltou depois da opção ${triedNs[0]}; tentando ${pick.label} (${pick.why})`
      : why ?? `${pick.label}: ${pick.why}`;
    s.tried.push({ menu: key, n: pick.n, how: buttons ? 'texto' : 'numero' });
    s.steps += 1;
    s.status = 'NAVEGANDO_MENU';
    s.next_action = 'Aguardar a resposta do atendimento';
    s.path.push({ at, kind: 'menu', menu: options.slice(0, 20), chosen: { n: pick.n, label: pick.label }, sent, reason, result: `Respondeu “${sent}”` });
    return { state: s, action: { type: 'send', text: sent, template: 'menu' } as Action };
  };

  switch (turn.kind) {
    case 'menu':
      return chooseIn(turn.options, turn.buttons);
    case 'rejeicao': {
      const last = [...s.path].reverse().find((p) => p.kind === 'menu' && p.menu && p.chosen);
      if (!last) {
        // O BEELIE tinha respondido com texto: responde agora a opção do menu anterior.
        const opts = ctx.lastMenuText ? menuOptions(ctx.lastMenuText) : [];
        if (!opts.length) return block('O robô recusou a resposta e não há menu para escolher');
        return chooseIn(opts, /^\[Botões\]/.test(ctx.lastMenuText ?? ''), undefined);
      }
      const key = menuKey(last.menu!);
      const asText = s.tried.some((x) => x.menu === key && x.n === last.chosen!.n && x.how === 'texto');
      if (asText || s.steps >= ctx.maxSteps) return block('O robô recusou a opção escolhida, inclusive escrita por extenso');
      // Não repete o que foi recusado: manda a mesma opção escrita por extenso.
      s.tried.push({ menu: key, n: last.chosen!.n, how: 'texto' });
      s.steps += 1;
      s.path.push({ at, kind: 'rejeicao', chosen: last.chosen, sent: last.chosen!.label, reason: 'O robô não aceitou o número; enviando o nome da opção', result: `Respondeu “${last.chosen!.label}”` });
      return { state: s, action: { type: 'send', text: last.chosen!.label, template: 'menu' } };
    }
    case 'dados': {
      if (turn.sensitive) return block(`O atendimento pediu ${turn.field}: o BEELIE não informa dados pessoais nem passa por identificação`);
      const answer = DATA_ANSWER[turn.field];
      if (!answer) return block(`O atendimento pediu ${turn.field}`);
      if (s.path.some((p) => p.kind === 'dados' && p.reason.includes(turn.field))) return block(`O atendimento pediu ${turn.field} de novo (sem progresso)`);
      if (s.steps >= ctx.maxSteps) return block(`Limite de ${ctx.maxSteps} etapas atingido sem chegar a uma pessoa`);
      s.steps += 1;
      s.status = 'NAVEGANDO_MENU';
      s.path.push({ at, kind: 'dados', sent: answer, reason: `O atendimento pediu ${turn.field}`, result: `Respondeu “${answer}”` });
      return { state: s, action: { type: 'send', text: answer, template: 'menu' } };
    }
    case 'transferencia':
      if (s.status !== 'AGUARDANDO_TRANSFERENCIA') s.path.push({ at, kind: 'transferencia', reason: 'O atendimento avisou que vai transferir', result: 'Aguardando um atendente' });
      s.status = 'AGUARDANDO_TRANSFERENCIA';
      s.next_action = 'Aguardar o atendente';
      return { state: s, action: { type: 'wait' } };
    case 'robo':
      return { state: s, action: { type: 'wait' } };
    case 'humano':
    case 'livre': {
      if (turn.kind === 'livre' && ctx.instant) return { state: s, action: { type: 'wait' } };
      s.status = 'ATENDIMENTO_HUMANO_PROVAVEL';
      s.attendance = 'humano_provavel';
      s.human_evidence = turn.kind === 'humano' ? turn.evidence : `Mensagem escrita livremente depois da navegação: “${String(text).slice(0, 80)}”`;
      s.next_action = 'Identificar o responsável pelo marketing';
      const motive = ASKS_MOTIVE.test(norm(text));
      const sent = motive ? MOTIVE : APPROACH;
      s.path.push({ at, kind: 'humano', sent, reason: s.human_evidence, result: motive ? 'Motivo explicado' : 'Abordagem enviada' });
      return { state: s, action: { type: 'send', text: sent, template: 'humano' } };
    }
  }
}
