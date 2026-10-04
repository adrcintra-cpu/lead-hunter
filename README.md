# Lead Hunter

Copiloto de prospecção B2B: **encontrar → entender → qualificar → priorizar → abordar → acompanhar**.

React + TypeScript + Vite + Tailwind, com tema claro e escuro. Roda 100% com dados fictícios (modo mock) e está pronto para Supabase e Claude API.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:5173, entre com qualquer e-mail e uma senha de 6+ caracteres e clique em **Carregar demonstração** no Dashboard (5 buscas prontas, listas e etapas do pipeline).

No modo mock tudo fica no `localStorage` do navegador, separado por usuário. Em Configurações há um botão para apagar os dados locais.

## Tema claro e escuro

- Alternância em três estados (Claro, Escuro, Sistema) na barra lateral, no login e em Configurações.
- A preferência fica salva; "Sistema" acompanha o sistema operacional em tempo real.
- As cores são tokens CSS em `src/index.css` (`:root` e `.dark`), expostos ao Tailwind em `tailwind.config.js`. Para ajustar a marca, mude só os tokens.

## O que funciona

| Área | Situação |
| --- | --- |
| Login | Mock local; Supabase Auth quando `VITE_DATA_MODE=supabase` |
| Dashboard | KPIs, buscas recentes, últimos leads, atividade, demonstração |
| Busca | Linguagem natural → critérios editáveis → providers → deduplicação → score |
| Leads | Tabela com 8 filtros, ordenação, seleção em massa para listas |
| Perfil | Proveniência por campo, análise da IA (fato × inferência × indisponível), score detalhado |
| Abordagem | WhatsApp, e-mail, LinkedIn; copiar, regenerar, editar; abre `wa.me` sem enviar nada |
| Pipeline | 9 etapas com arrastar e soltar (e seletor acessível por teclado) |
| Listas e buscas salvas | Criar, editar, excluir; reexecução manual |
| Opt-out | Lista de supressão bloqueia abordagem e link de WhatsApp |
| Auditoria | Toda ação vira atividade; atividades são somente inserção |

## Arquitetura

```text
src/
├─ core/                 # domínio puro, sem React
│  ├─ types.ts           # tipos (espelham as tabelas)
│  ├─ scoring.ts         # normalização, deduplicação, score por regras
│  ├─ ai/aiService.ts    # camada central de IA: valida, limita ajuste a ±15, audita
│  └─ providers/
│     ├─ types.ts        # contratos: companySearch, places, companyData, ai, whatsapp
│     ├─ registry.ts     # ÚNICO lugar que escolhe mock ou real
│     ├─ mock/           # 24 empresas fictícias + providers mock
│     └─ remote/         # providers que chamam as Edge Functions
├─ services/
│  ├─ leadHunterService.ts  # regras de negócio (busca, CRM, abordagem, listas)
│  ├─ db/                   # contrato Repository + LocalRepository + SupabaseRepository
│  └─ auth.ts
├─ store/                # contexto React, useDb, seletores
├─ features/             # telas
├─ components/ui/        # badges, estados vazios, modal, toasts, tema
└─ theme/                # ThemeProvider
supabase/
├─ migrations/           # schema, enums, triggers, RLS (+ Fase 2: campos da Receita)
└─ functions/
   ├─ ai/                # Claude API no servidor (prompts versionados em _shared/ai)
   ├─ providers/         # Google Places e BrasilAPI no servidor
   └─ _shared/providers/ # mapeamento puro dos dados de cada fonte
```

Os componentes React nunca chamam IA nem providers diretamente: tudo passa por `LeadHunterService` → `AIService` → provider.

### Regras que a IA não pode quebrar

- O score é **base de regras (0–100) + ajuste da IA limitado a ±15**, sempre com justificativa.
- Itens de análise marcados como fato sem campo de evidência são rebaixados para inferência automaticamente.
- A abordagem usa só dados encontrados; o que falta vira marcador entre colchetes (`[SEU SERVIÇO]`).

## Conectar as fontes reais (Fase 2)

No modo `supabase` o app usa:

| O quê | Fonte | Onde roda |
| --- | --- | --- |
| Login | Supabase Auth | Supabase |
| Dados (leads, listas, histórico) | Postgres com RLS | Supabase |
| Busca de empresas | Google Places API (New), Text Search | Edge Function `providers` |
| Dados oficiais pelo CNPJ | BrasilAPI (Receita Federal, gratuita) | Edge Function `providers` |
| IA | Claude API | Edge Function `ai` |

### Passo a passo

1. **Supabase.** Crie um projeto e aplique as migrations:
   ```bash
   supabase link --project-ref SEU_PROJETO
   supabase db push
   ```
2. **Google Places.** No Google Cloud: crie um projeto, ative a cobrança, ative a **Places API (New)** e crie uma chave restrita a essa API.
3. **Segredos no servidor** (nunca no `.env` do frontend):
   ```bash
   supabase secrets set GOOGLE_PLACES_API_KEY=...
   supabase secrets set ANTHROPIC_API_KEY=...
   supabase functions deploy providers
   supabase functions deploy ai
   ```
4. **Frontend.** Copie `.env.example` para `.env.local`:
   ```
   VITE_DATA_MODE=supabase
   VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   VITE_SEARCH_PROVIDER=google_places
   ```
   Sem chave do Google ainda? Use `VITE_SEARCH_PROVIDER=mock`: o banco e a IA ficam reais e a busca usa as empresas fictícias.

### Como cada fonte é usada

- **Google Places** devolve nome comercial, endereço, telefone, site e localização. O raio é aplicado a partir do centro da cidade, e empresas fechadas são descartadas. Até 60 resultados por busca (3 páginas).
- **WhatsApp:** o Google não informa. Celular (9 dígitos começando com 9) vira **provável**; fixo fica **desconhecido**. Nada é marcado como confirmado sem prova.
- **Razão social:** o nome do Google é nome comercial. A razão social só aparece como "Dado encontrado" depois do CNPJ.
- **CNPJ:** o Google não informa. No perfil do lead, informe o CNPJ e o app traz razão social, situação cadastral, CNAE, porte da Receita (ME/EPP/Demais) e data de abertura, e recalcula o score. CNPJ inativo zera os pontos de "Dados empresariais". O quadro de sócios não é guardado.
- **Porte em funcionários:** nenhuma das duas fontes informa. O critério "mais de 50 funcionários" aparece como não suportado até haver um provedor pago com essa informação.
- **Buscas salvas:** ao reexecutar, o resultado abre filtrado em **Só empresas novas**, e a lista de buscas mostra quantas novas a última execução trouxe.

### Custos e termos

- O Text Search com telefone e site é cobrado pelo Google por chamada, e cada página de 20 resultados conta como uma chamada. Confira a tabela de preços vigente da Places API antes de usar em volume e configure limites de cota no Google Cloud.
- Os termos do Google Maps Platform limitam o armazenamento dos dados. Cada consulta fica registrada em `lead_sources` com `expires_at` de 30 dias; depois disso, rode a busca de novo para atualizar. Revise os termos vigentes antes de produção.
- A BrasilAPI é gratuita e comunitária, sem garantia de disponibilidade. Para volume, considere um provedor contratado: basta implementar outro `CompanyDataProvider`.

### Como os dados são salvos

`SupabaseRepository` carrega os dados do usuário ao entrar e grava cada mudança no banco, em ordem. A interface continua instantânea; se uma gravação falhar, aparece um aviso. A mudança de etapa é registrada pelo trigger do banco, e as chamadas de IA pela Edge Function, para que nenhum caminho escape da auditoria.

## Segurança e LGPD

- Nenhuma chave secreta no frontend: só `VITE_SUPABASE_URL` e a anon key (pública).
- RLS em todas as tabelas (`owner_id = auth.uid()`); `lead_activities` e `ai_runs` só aceitam leitura e inserção.
- Sem scraping, sem robôs de navegador e sem envio automático. WhatsApp no MVP é apenas o link `wa.me`.
- `lead_sources.expires_at` existe para respeitar limites de cache de providers como o Google Places.

## Fases

- **MVP:** fluxo completo com mocks, Claude opcional via Edge Function.
- **Fase 2 — núcleo (este código):** Google Places, CNPJ via BrasilAPI, dados no Supabase, reexecução com só empresas novas.
- **Fase 2 — restante:** exportação CSV, webhooks para n8n/CRM, análise do site da empresa, lembretes de follow-up.
- **Fase 3:** WhatsApp Business Platform oficial (templates + opt-in), integrações de CRM, equipes, planos e cobrança.
