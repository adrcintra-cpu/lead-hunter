import { normalize } from '@/core/utils';

import { SEGMENTS } from '../../../supabase/functions/_shared/automation/segments.ts';

export { SEGMENTS };

const ALL = SEGMENTS.flatMap((g) => g.items.map((name) => ({ name, group: g.group, key: normalize(name) })));

/** Sugestões de segmento: começa com o texto primeiro, depois contém (também pelo grupo). Vazio = lista toda. */
export function suggestSegments(query: string, extra: string[] = []): { name: string; group: string }[] {
  const mine = [...new Set(extra.map((s) => s.trim()).filter(Boolean))]
    .filter((s) => !ALL.some((a) => a.key === normalize(s)))
    .map((name) => ({ name, group: 'Já na sua base', key: normalize(name) }));
  const list = [...mine, ...ALL];
  const q = normalize(query);
  if (!q) return list;
  const score = (s: { key: string; group: string }) => (s.key.startsWith(q) ? 0 : s.key.split(' ').some((w) => w.startsWith(q)) ? 1 : s.key.includes(q) ? 2 : normalize(s.group).includes(q) ? 3 : 9);
  return list
    .map((s) => ({ s, v: score(s) }))
    .filter((x) => x.v < 9)
    .sort((a, b) => a.v - b.v || a.s.name.length - b.s.name.length)
    .map((x) => x.s);
}
