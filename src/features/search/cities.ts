import { normalize } from '@/core/utils';
import { MOCK_CITIES } from '@/core/providers/mock/mockCompanies';

export interface City {
  name: string;
  uf: string;
  key: string;
}

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
let cache: Promise<City[]> | null = null;

/** Municípios do Brasil (IBGE, dado público), carregados uma vez quando o campo é usado. Sem rede: cidades conhecidas de SP. */
export function loadCities(): Promise<City[]> {
  if (!cache) {
    cache = fetch(IBGE)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Record<string, unknown>[]) =>
        rows
          .map((r) => ({ name: String(r['municipio-nome'] ?? ''), uf: String(r['UF-sigla'] ?? '') }))
          .filter((c) => c.name && c.uf)
          .map((c) => ({ ...c, key: normalize(c.name) })),
      )
      .catch(() => {
        cache = null; // tenta de novo na próxima vez
        return MOCK_CITIES.map((name) => ({ name, uf: 'SP', key: normalize(name) }));
      });
  }
  return cache;
}

/** Sugestões: começa com o texto primeiro, depois contém; o estado escolhido vem antes. */
export function suggestCities(list: City[], query: string, uf: string | null, limit = 8): City[] {
  const q = normalize(query.replace(/\s*[/,\-–]\s*[A-Za-z]{2}$/, ''));
  if (q.length < 2) return [];
  const score = (c: City) => (c.key.startsWith(q) ? 0 : c.key.split(' ').some((w) => w.startsWith(q)) ? 1 : c.key.includes(q) ? 2 : 9) - (uf && c.uf === uf ? 0.5 : 0);
  return list
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name, 'pt-BR'))
    .slice(0, limit)
    .map((x) => x.c);
}
