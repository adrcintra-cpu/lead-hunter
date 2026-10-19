// Lista de segmentos para prospecção B2B (busca no Google). Usada pelo app (campo Segmento)
// e pela busca automática do BEELIE no servidor.

/** Segmentos comuns para prospecção B2B (busca no Google). Dá para digitar outro. */
export const SEGMENTS: { group: string; items: string[] }[] = [
  { group: 'Indústria', items: ['Indústria', 'Metalúrgica', 'Usinagem', 'Fundição', 'Indústria de plásticos', 'Indústria química', 'Indústria alimentícia', 'Indústria têxtil', 'Indústria moveleira', 'Indústria de embalagens', 'Máquinas e equipamentos', 'Máquinas agrícolas', 'Autopeças', 'Gráfica', 'Cerâmica', 'Vidraçaria', 'Serralheria'] },
  { group: 'Agronegócio', items: ['Agronegócio', 'Cooperativa agrícola', 'Revenda de insumos agrícolas', 'Usina de açúcar e etanol', 'Cafeicultura', 'Pecuária', 'Granja', 'Viveiro de mudas'] },
  { group: 'Comércio e distribuição', items: ['Comércio', 'Distribuidora', 'Atacadista', 'Supermercado', 'Loja de materiais de construção', 'Loja de móveis', 'Loja de roupas', 'Ótica', 'Joalheria', 'Farmácia', 'Pet shop', 'Loja de informática', 'Concessionária de veículos', 'Loja de autopeças', 'Papelaria'] },
  { group: 'Logística e transporte', items: ['Transportadora', 'Logística', 'Despachante aduaneiro', 'Armazém', 'Mudanças', 'Locadora de veículos'] },
  { group: 'Construção e imóveis', items: ['Construtora', 'Incorporadora', 'Imobiliária', 'Arquitetura', 'Engenharia', 'Paisagismo', 'Energia solar', 'Ar-condicionado e climatização'] },
  { group: 'Saúde e bem-estar', items: ['Clínica médica', 'Clínica odontológica', 'Laboratório de análises clínicas', 'Clínica de estética', 'Fisioterapia', 'Psicologia', 'Clínica veterinária', 'Academia', 'Nutricionista', 'Hospital'] },
  { group: 'Serviços profissionais', items: ['Contabilidade', 'Advocacia', 'Consultoria', 'Recursos humanos', 'Seguros', 'Corretora de seguros', 'Segurança patrimonial', 'Limpeza e conservação', 'Terceirização de serviços', 'Despachante'] },
  { group: 'Educação', items: ['Escola particular', 'Escola de idiomas', 'Curso profissionalizante', 'Faculdade', 'Escola de programação e robótica', 'Autoescola'] },
  { group: 'Alimentação e hospitalidade', items: ['Restaurante', 'Pizzaria', 'Hamburgueria', 'Cafeteria', 'Padaria', 'Açaiteria', 'Bar', 'Hotel', 'Pousada', 'Buffet e eventos'] },
  { group: 'Beleza', items: ['Salão de beleza', 'Barbearia', 'Estúdio de tatuagem', 'Spa'] },
  { group: 'Tecnologia e comunicação', items: ['Software house', 'Provedor de internet', 'Assistência técnica', 'Agência de marketing', 'Produtora de vídeo'] },
  { group: 'Automotivo', items: ['Oficina mecânica', 'Funilaria e pintura', 'Auto center', 'Lava-rápido'] },
];
