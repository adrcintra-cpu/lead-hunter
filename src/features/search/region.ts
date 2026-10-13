import type { SearchCriteria } from '@/core/types';

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const STATE_NAMES: Record<string, string> = { SP: 'São Paulo', RJ: 'Rio de Janeiro', MG: 'Minas Gerais', PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul', BA: 'Bahia', GO: 'Goiás', DF: 'Distrito Federal', ES: 'Espírito Santo', PE: 'Pernambuco', CE: 'Ceará' };

/**
 * Cidade digitada livremente ("Curitiba", "Curitiba/PR", "Curitiba - PR") + UF.
 * A busca real localiza qualquer cidade do Brasil pelo Google.
 */
export function withRegion(c: SearchCriteria, rawCity: string, rawState: string | null): SearchCriteria {
  let city = rawCity.trim();
  let state = rawState;
  const m = /^(.*?)[\s]*[/,\-–][\s]*([A-Za-z]{2})$/.exec(city);
  if (m && UFS.includes(m[2].toUpperCase())) {
    city = m[1].trim();
    state = m[2].toUpperCase();
  }
  if (city) {
    const cityName = city.replace(/\s+/g, ' ').replace(/(^|\s)\p{Ll}/gu, (x) => x.toUpperCase());
    return { ...c, city: cityName, state, regionLabel: `${cityName}${state ? `/${state}` : ''}`, radiusKm: c.radiusKm ?? 50 };
  }
  if (state) return { ...c, city: null, state, regionLabel: `Estado ${STATE_NAMES[state] ? `de ${STATE_NAMES[state]}` : state}`, radiusKm: null };
  return { ...c, city: null, state: null, regionLabel: 'Qualquer região', radiusKm: null };
}
