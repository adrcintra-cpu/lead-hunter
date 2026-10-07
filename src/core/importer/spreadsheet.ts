/**
 * Leitura de planilhas de contatos (Excel .xlsx ou CSV) no navegador, sem bibliotecas externas.
 * Lê só a primeira aba. Fórmulas, formatação e várias abas não importam aqui.
 */

import { normalize } from '../utils';

export type ImportField =
  | 'company'
  | 'tradeName'
  | 'contactName'
  | 'contactRole'
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'city'
  | 'state'
  | 'segment'
  | 'website'
  | 'ddd'
  | 'cnpj'
  | 'instagram';

export const IMPORT_FIELDS: { id: ImportField; label: string }[] = [
  { id: 'company', label: 'Empresa' },
  { id: 'tradeName', label: 'Nome fantasia' },
  { id: 'contactName', label: 'Contato (pessoa)' },
  { id: 'contactRole', label: 'Cargo' },
  { id: 'ddd', label: 'DDD' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'phone', label: 'Telefone' },
  { id: 'email', label: 'E-mail' },
  { id: 'city', label: 'Cidade' },
  { id: 'state', label: 'UF' },
  { id: 'segment', label: 'Segmento' },
  { id: 'website', label: 'Site' },
  { id: 'cnpj', label: 'CNPJ' },
  { id: 'instagram', label: 'Instagram' },
];

export type ImportRow = Partial<Record<ImportField, string>>;

/** Nomes de coluna reconhecidos (comparados sem acento, em minúsculas). Ordem importa: o primeiro que casa ganha. */
const ALIASES: [ImportField, string[]][] = [
  ['whatsapp', ['whatsapp', 'whats', 'wpp', 'zap', 'celular whatsapp', 'whatsapp comercial']],
  ['tradeName', ['nome fantasia', 'fantasia']],
  ['company', ['empresa', 'nome da empresa', 'razao social', 'company', 'cliente', 'organizacao', 'loja', 'estabelecimento']],
  ['contactRole', ['cargo', 'funcao', 'role', 'posicao']],
  ['contactName', ['contato', 'nome do contato', 'responsavel', 'pessoa', 'decisor', 'nome']],
  ['email', ['email', 'e mail', 'mail']],
  ['phone', ['telefone', 'fone', 'tel', 'celular', 'phone', 'contato telefonico']],
  ['city', ['cidade', 'municipio', 'city']],
  ['state', ['uf', 'estado', 'state']],
  ['segment', ['segmento', 'ramo', 'setor', 'atividade', 'categoria', 'nicho', 'area de atuacao']],
  ['website', ['site', 'website', 'url', 'pagina', 'homepage']],
  ['ddd', ['ddd', 'cod area', 'codigo de area', 'cod de area', 'prefixo', 'area code']],
  ['cnpj', ['cnpj']],
  ['instagram', ['instagram', 'insta']],
];

const norm = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Coluna → campo, pelo nome do cabeçalho. Colunas não reconhecidas ficam de fora (null). */
export function guessMapping(headers: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>();
  // Nos nomes parciais ("E-mail do contato", "Telefone do responsável"), dado de contato vem antes de pessoa.
  const PARTIAL: ImportField[] = ['ddd', 'whatsapp', 'email', 'phone', 'cnpj', 'website', 'instagram', 'city', 'state', 'segment', 'tradeName', 'company', 'contactRole', 'contactName'];
  const partialOrder = [...ALIASES].sort((a, b) => PARTIAL.indexOf(a[0]) - PARTIAL.indexOf(b[0]));
  const pick = (h: string, exact: boolean): ImportField | null => {
    const n = norm(h);
    for (const [field, names] of exact ? ALIASES : partialOrder) {
      if (used.has(field)) continue;
      if (names.some((a) => (exact ? n === a : n.startsWith(`${a} `) || n.endsWith(` ${a}`) || n.includes(` ${a} `)))) return field;
    }
    return null;
  };
  const out: (ImportField | null)[] = headers.map(() => null);
  // Primeiro os nomes exatos, depois os que só contêm o termo ("Telefone comercial").
  for (const exact of [true, false]) {
    headers.forEach((h, i) => {
      if (out[i]) return;
      const f = pick(h, exact);
      if (f) {
        out[i] = f;
        used.add(f);
      }
    });
  }
  // Sem coluna de empresa: a coluna "Nome" é o nome da empresa.
  if (!out.includes('company') && !out.includes('tradeName')) {
    const i = out.indexOf('contactName');
    if (i >= 0 && norm(headers[i]) === 'nome') out[i] = 'company';
  }
  return out;
}

/** Linhas da planilha → contatos, pelo mapeamento escolhido. Linhas vazias são ignoradas. */
export function toImportRows(rows: string[][], mapping: (ImportField | null)[]): ImportRow[] {
  const out: ImportRow[] = [];
  for (const r of rows) {
    const row: ImportRow = {};
    mapping.forEach((f, i) => {
      const v = (r[i] ?? '').trim();
      if (f && v && !row[f]) row[f] = v.slice(0, 300);
    });
    if (Object.keys(row).length) out.push(row);
  }
  return out;
}

// ---------- CSV ----------

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ---------- XLSX (zip + XML) ----------

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Arquivos de um .zip (só os pedidos), já descompactados como texto. */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo não é uma planilha .xlsx válida.');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, string>();
  const dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const csize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (data) out.set(name, dec.decode(data));
  }
  return out;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? '',
  );
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Número do Excel como texto, sem notação científica (telefones, CNPJ). */
function numText(v: string): string {
  if (!/e/i.test(v)) return v.replace(/\.0+$/, '');
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? BigInt(Math.round(n)).toString() : v;
}

export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  // Primeira aba do arquivo (pela ordem do workbook).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (rid && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([n]) => n.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new Error('Não encontrei nenhuma aba na planilha.');
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textOf(inner);
      else if (t === 'str' || t === 'e') val = v ? unxml(v) : '';
      else if (t === 'b') val = v === '1' ? 'VERDADEIRO' : 'FALSO';
      else val = v ? numText(unxml(v)) : '';
      row[idx] = val;
    }
    rows.push(Array.from(row, (c) => c ?? ''));
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Lê o arquivo escolhido (xlsx ou csv) e devolve cabeçalho + linhas. */
/**
 * Sem linha de cabeçalho: adivinha o campo pelo conteúdo das primeiras linhas
 * (e-mail, site, DDD de 2 dígitos, telefone/celular, UF, CNPJ; o 1º texto vira empresa).
 */
export function guessByContent(rows: string[][]): (ImportField | null)[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.slice(0, 30);
  const out: (ImportField | null)[] = [];
  const used = new Set<ImportField>();
  const share = (i: number, re: RegExp) => {
    const vals = sample.map((r) => (r[i] ?? '').trim()).filter(Boolean);
    return vals.length ? vals.filter((v) => re.test(v)).length / vals.length : 0;
  };
  const take = (f: ImportField) => (used.has(f) ? null : (used.add(f), f));
  for (let i = 0; i < width; i++) {
    let f: ImportField | null = null;
    if (share(i, /^[^@\s]+@[^@\s]+\.[^@\s]+$/) > 0.6) f = take('email');
    else if (share(i, /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/) > 0.6) f = take('cnpj');
    else if (share(i, /^\(?0?\d{2}\)?$/) > 0.6) f = take('ddd');
    else if (share(i, /^[+\d\s().-]{8,20}$/) > 0.6) {
      const mobile = share(i, /(^|\D)9\d{4}-?\d{4}$/) > 0.5;
      f = take(mobile ? 'whatsapp' : 'phone') ?? take(mobile ? 'phone' : 'whatsapp');
    } else if (share(i, /^(www\.|https?:\/\/)|\.(com|br|net)(\/|$)/i) > 0.6) f = take('website');
    else if (share(i, /^[A-Za-z]{2}$/) > 0.8) f = take('state');
    else if (share(i, /[A-Za-zÀ-ú]/) > 0.6) f = take('company') ?? take('contactName') ?? take('city');
    out.push(f);
  }
  return out;
}

/** O cabeçalho parece ser uma linha de dados (números, e-mails, nenhum nome de coluna conhecido)? */
export function looksLikeData(headers: string[]): boolean {
  if (guessMapping(headers).some(Boolean)) return false;
  return headers.some((h) => /\d{4,}|@|^\d{2}$/.test(h.trim()));
}

export async function readSpreadsheet(file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ headers: string[]; rows: string[][] }> {
  const buf = await file.arrayBuffer();
  const isXlsx = /\.xlsx$/i.test(file.name) || new Uint8Array(buf.slice(0, 2))[0] === 0x50;
  if (/\.xls$/i.test(file.name)) throw new Error('Formato .xls antigo não é aceito: no Excel, use "Salvar como" → .xlsx ou .csv.');
  const all = isXlsx ? await readXlsx(buf) : parseCsv(new TextDecoder('utf-8').decode(buf));
  if (!all.length) throw new Error('A planilha está vazia.');
  const [headers, ...rows] = all;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Modelo para baixar: CSV com ";" (abre direto no Excel em português). */
export function templateCsv(): string {
  const head = ['Empresa', 'Contato', 'Cargo', 'WhatsApp', 'Telefone', 'E-mail', 'Cidade', 'UF', 'Segmento', 'Site', 'CNPJ'];
  const ex = ['Indústria Exemplo Ltda', 'Maria Souza', 'Gerente de Marketing', '(19) 99999-0000', '(19) 3451-0000', 'maria@exemplo.com.br', 'Limeira', 'SP', 'Indústria', 'exemplo.com.br', ''];
  return `﻿${head.join(';')}\r\n${ex.join(';')}\r\n`;
}
