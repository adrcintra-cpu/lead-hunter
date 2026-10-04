import type { RawCompany } from '../../types';

/** Coordenadas aproximadas dos centros das cidades usadas no mock. */
export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Limeira: { lat: -22.564, lng: -47.401 },
  Campinas: { lat: -22.906, lng: -47.061 },
  Piracicaba: { lat: -22.725, lng: -47.649 },
  Americana: { lat: -22.739, lng: -47.331 },
  'Ribeirão Preto': { lat: -21.178, lng: -47.81 },
  Sorocaba: { lat: -23.501, lng: -47.458 },
};

export const MOCK_CITIES = Object.keys(CITY_COORDS);

type Seed = Omit<RawCompany, 'provider' | 'externalId' | 'lat' | 'lng' | 'state'> & { id: string; off?: [number, number] };

/**
 * 24 empresas FICTÍCIAS. Nomes, CNPJs, telefones e sites foram inventados
 * para teste e não correspondem a empresas reais.
 * A entrada mock-24 é uma duplicata proposital da mock-01 (mesmo site) para
 * exercitar a deduplicação.
 */
const SEEDS: Seed[] = [
  { id: 'mock-01', legalName: 'Agromaq Vale Verde Ltda', tradeName: 'Agromaq', segment: 'Máquinas agrícolas', city: 'Campinas', cnpj: '12.401.556/0001-79', address: 'Av. das Colheitas, 1200 — Campinas/SP', website: 'agromaqvaleverde.com.br', phone: '(19) 3201-4410', whatsapp: '(19) 99812-4410', whatsappStatus: 'confirmado', instagram: '@agromaq.valeverde', off: [0.02, 0.03] },
  { id: 'mock-02', legalName: 'Irrigar Sul Equipamentos Ltda', tradeName: 'Irrigar Sul', segment: 'Agronegócio', city: 'Limeira', address: 'Rua dos Pivôs, 455 — Limeira/SP', website: 'irrigarsul.com.br', phone: '(19) 3442-1180', whatsapp: '(19) 99701-1180', whatsappStatus: 'provavel', linkedin: 'linkedin.com/company/irrigarsul' },
  { id: 'mock-03', legalName: 'Metalúrgica Tamboré Paulista Ltda', segment: 'Indústria', city: 'Americana', cnpj: '33.410.227/0001-64', address: 'Rua do Aço, 88 — Americana/SP', phone: '(19) 3478-2205', whatsappStatus: 'desconhecido', employeesRange: '50–99', employeesMin: 50 },
  { id: 'mock-04', legalName: 'Clínica Sorriso Piracicabano Ltda', tradeName: 'Sorriso Piracicabano', segment: 'Clínicas', city: 'Piracicaba', address: 'Rua Governador, 310 — Piracicaba/SP', website: 'sorrisopiracicabano.com.br', phone: '(19) 3433-9021', whatsapp: '(19) 99633-9021', whatsappStatus: 'confirmado', instagram: '@sorrisopiracicabano' },
  { id: 'mock-05', legalName: 'RotaCampo Logística Ltda', tradeName: 'RotaCampo', segment: 'Logística', city: 'Ribeirão Preto', website: 'rotacampo.com.br', phone: '(16) 3610-7744', whatsapp: '(16) 99140-7744', whatsappStatus: 'provavel', linkedin: 'linkedin.com/company/rotacampo' },
  { id: 'mock-06', legalName: 'Nexo Dados Tecnologia Ltda', tradeName: 'Nexo Dados', segment: 'Tecnologia', city: 'Campinas', website: 'nexodados.com.br', phone: '(19) 3112-5008', whatsappStatus: 'desconhecido', linkedin: 'linkedin.com/company/nexodados', off: [-0.03, 0.01] },
  { id: 'mock-07', legalName: 'Plantare Sementes do Interior Ltda', tradeName: 'Plantare', segment: 'Agronegócio', city: 'Ribeirão Preto', address: 'Estrada do Campo, 2100 — Ribeirão Preto/SP', website: 'plantaresementes.com.br', phone: '(16) 3622-0391', whatsapp: '(16) 99288-0391', whatsappStatus: 'confirmado', instagram: '@plantaresementes' },
  { id: 'mock-08', legalName: 'Usinagem Precisa Sorocabana Ltda', tradeName: 'Usinagem Precisa', segment: 'Indústria', city: 'Sorocaba', cnpj: '41.008.735/0001-49', address: 'Av. Industrial, 940 — Sorocaba/SP', website: 'usinagemprecisa.com.br', phone: '(15) 3231-6650', whatsappStatus: 'desconhecido', employeesRange: '100–249', employeesMin: 100 },
  { id: 'mock-09', legalName: 'Odonto Vida Limeira Ltda', tradeName: 'Odonto Vida', segment: 'Clínicas', city: 'Limeira', phone: '(19) 3451-2290', whatsapp: '(19) 99410-2290', whatsappStatus: 'provavel', instagram: '@odontovidalimeira' },
  { id: 'mock-10', legalName: 'Consultoria Ponte B2B Ltda', tradeName: 'Ponte B2B', segment: 'Serviços B2B', city: 'Americana', website: 'pontebtob.com.br', phone: '(19) 3406-1170', whatsappStatus: 'desconhecido' },
  { id: 'mock-11', legalName: 'Tratorpeças Piracicaba Ltda', tradeName: 'Tratorpeças', segment: 'Máquinas', city: 'Piracicaba', cnpj: '27.615.902/0001-99', address: 'Rua das Engrenagens, 77 — Piracicaba/SP', website: 'tratorpecaspira.com.br', phone: '(19) 3402-8813', whatsapp: '(19) 99550-8813', whatsappStatus: 'confirmado' },
  { id: 'mock-12', legalName: 'Frio Norte Armazéns Gerais Ltda', tradeName: 'Frio Norte', segment: 'Logística', city: 'Sorocaba', phone: '(15) 3219-4402', whatsappStatus: 'desconhecido' },
  { id: 'mock-13', legalName: 'Campo Forte Implementos Agrícolas Ltda', tradeName: 'Campo Forte', segment: 'Máquinas agrícolas', city: 'Limeira', cnpj: '19.884.301/0001-53', address: 'Rod. dos Implementos, km 4 — Limeira/SP', website: 'campoforteimplementos.com.br', phone: '(19) 3445-7020', whatsapp: '(19) 99820-7020', whatsappStatus: 'confirmado', employeesRange: '20–49', employeesMin: 20, off: [-0.04, 0.03] },
  { id: 'mock-14', legalName: 'Semear Agro Insumos Ltda', tradeName: 'Semear Agro', segment: 'Agronegócio', city: 'Piracicaba', website: 'semearagro.com.br', phone: '(19) 3417-3355', whatsapp: '(19) 99177-3355', whatsappStatus: 'provavel', instagram: '@semearagro' },
  { id: 'mock-15', legalName: 'Polímeros Ipê Indústria e Comércio Ltda', tradeName: 'Polímeros Ipê', segment: 'Indústria', city: 'Limeira', cnpj: '08.552.914/0001-77', address: 'Distrito Industrial, Quadra 7 — Limeira/SP', website: 'polimerosipe.com.br', phone: '(19) 3446-9100', whatsappStatus: 'desconhecido', linkedin: 'linkedin.com/company/polimerosipe', employeesRange: '100–249', employeesMin: 100 },
  { id: 'mock-16', legalName: 'Fundição Serra Azul Ltda', segment: 'Indústria', city: 'Limeira', cnpj: '15.770.482/0001-36', phone: '(19) 3449-2010', whatsappStatus: 'desconhecido', employeesRange: '50–99', employeesMin: 50, off: [0.015, -0.02] },
  { id: 'mock-17', legalName: 'Clínica Vértebra Fisioterapia Ltda', tradeName: 'Vértebra Fisio', segment: 'Clínicas', city: 'Campinas', website: 'vertebrafisio.com.br', phone: '(19) 3254-6612', whatsapp: '(19) 99641-6612', whatsappStatus: 'confirmado', instagram: '@vertebrafisio' },
  { id: 'mock-18', legalName: 'Odonto Prime Americana Ltda', tradeName: 'Odonto Prime', segment: 'Clínicas', city: 'Americana', website: 'odontoprimeamericana.com.br', phone: '(19) 3461-4478', whatsapp: '(19) 99302-4478', whatsappStatus: 'confirmado' },
  { id: 'mock-19', legalName: 'Pátio Sul Transportes Ltda', tradeName: 'Pátio Sul', segment: 'Logística', city: 'Campinas', website: 'patiosultransportes.com.br', phone: '(19) 3227-8890', whatsapp: '(19) 99788-8890', whatsappStatus: 'provavel', off: [0.04, -0.05] },
  { id: 'mock-20', legalName: 'Codeval Sistemas Ltda', tradeName: 'Codeval', segment: 'Tecnologia', city: 'Ribeirão Preto', website: 'codeval.com.br', phone: '(16) 3519-2040', whatsappStatus: 'desconhecido', linkedin: 'linkedin.com/company/codeval' },
  { id: 'mock-21', legalName: 'Hidrotec Bombas Industriais Ltda', tradeName: 'Hidrotec', segment: 'Máquinas', city: 'Sorocaba', cnpj: '22.139.660/0001-90', website: 'hidrotecbombas.com.br', phone: '(15) 3228-1515', whatsapp: '(15) 99611-1515', whatsappStatus: 'provavel', employeesRange: '20–49', employeesMin: 20 },
  { id: 'mock-22', legalName: 'Contábil Horizonte Empresarial Ltda', tradeName: 'Horizonte Contábil', segment: 'Serviços B2B', city: 'Piracicaba', website: 'horizontecontabil.com.br', phone: '(19) 3422-0909', whatsapp: '(19) 99505-0909', whatsappStatus: 'confirmado', linkedin: 'linkedin.com/company/horizontecontabil' },
  { id: 'mock-23', legalName: 'Colheita Certa Máquinas Ltda', tradeName: 'Colheita Certa', segment: 'Máquinas agrícolas', city: 'Ribeirão Preto', website: 'colheitacerta.com.br', phone: '(16) 3627-4040', whatsapp: '(16) 99260-4040', whatsappStatus: 'confirmado', instagram: '@colheitacerta' },
  { id: 'mock-24', legalName: 'AGROMAQ VALE VERDE LTDA', segment: 'Máquinas agrícolas', city: 'Campinas', website: 'https://www.agromaqvaleverde.com.br/', phone: '(19) 3201-4410', whatsappStatus: 'desconhecido', off: [0.02, 0.03] },
];

export const MOCK_COMPANIES: RawCompany[] = SEEDS.map(({ id, off, ...s }, i) => {
  const c = CITY_COORDS[s.city];
  const [dLat, dLng] = off ?? [((i % 5) - 2) * 0.01, ((i % 3) - 1) * 0.012];
  return { ...s, provider: 'mock_search', externalId: id, state: 'SP', lat: c.lat + dLat, lng: c.lng + dLng };
});

/** Telefone fictício que já começa na lista de supressão (opt-out). */
export const MOCK_SUPPRESSED_PHONE = '(19) 3451-2290';
