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
| Dashboard | KPIs de prospecção e campanhas, temperatura dos leads, leitura inteligente da IA, tarefas, atividade |
| Busca | Linguagem natural → critérios editáveis → providers → deduplicação → score |
| Leads | Tabela com 8 filtros, ordenação, seleção em massa para listas |
| Perfil | Proveniência por campo, análise da IA (fato × inferência × indisponível), score detalhado |
| Abordagem | Mensagem com IA (WhatsApp, e-mail, LinkedIn), editar, abrir `wa.me` ou o app de e-mail, **Marcar como enviado** e agendar o próximo contato (1, 3, 5, 7, 14, 30 dias ou data). Com contato anterior, a IA escreve um follow-up que continua a conversa |
| Pipeline | 11 etapas (Novo → Qualificado → Em cadência → Contatado → Respondeu → Interessado → Reunião → Proposta → Cliente, Não interessado, Sem resposta) com arrastar e soltar |
| CRM e perfil 360° | Contato, cargo, e-mail, tags, responsável, próxima ação, consentimento de WhatsApp, conversa, **Registrar resposta → Analisar com IA**, cadência e linha do tempo completa |
| Score | 0–100 por regras + ajuste da IA (±15). Quente 80+, morno 50–79, frio abaixo de 50; respostas mudam o score |
| Campanhas | Nome, objetivo, público (segmento, cidade, score, etapa, tags, lista), canal, cadência, responsável, status, métricas |
| Cadências | Editor visual de etapas: enviar (IA ou template), esperar, condição, tarefa, mudar etapa; nada fixo no código |
| Personalização | Mensagem preparada pela IA com dados reais, revisável e editável antes de ativar; contexto, data e modelo guardados |
| Respostas | Classificação pela IA (interesse, reunião, dúvida, recusa, opt-out, ausência) com ações automáticas |
| Tarefas | Atendimento humano: responder interessados, WhatsApp das cadências (link wa.me), tarefas das cadências |
| Follow-ups | Próximo contato de cada lead no Dashboard (hoje e atrasados) e no filtro da tela Leads |
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

## Ligar as APIs reais (atalho)

Com as contas criadas (Supabase, Claude, Google Places e, se quiser, Resend), rode na pasta do projeto:

```bash
bash scripts/configurar-apis.sh
```

O script entra no Supabase, aplica o banco, grava as chaves como secrets (digitadas sem aparecer na tela, nunca em arquivo), publica as funções e mostra o que falta fazer à mão (variáveis da Vercel, webhooks e o agendamento). Os detalhes de cada serviço estão nas seções abaixo.

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

## Automação: campanhas, cadências e respostas (Fase 3)

### Modo de teste (sem nenhuma conta)

Com `VITE_DATA_MODE=mock`, a automação roda no navegador com envios simulados. Carregue a demonstração no Dashboard, abra **Campanhas → Agro e indústria — outubro**, clique em **Preparar mensagens**, revise e **Ativar**. Use o relógio simulado na barra lateral (**+1 dia**, **+7 dias**) para ver as esperas, a janela de envio, os follow-ups e a cadência concluindo. No perfil do lead, **Registrar resposta** (em Mensagens e respostas) testa a classificação e as ações (pausar, tarefa, opt-out).

### Produção

**WhatsApp é sem API.** O sistema prepara a mensagem e abre o `wa.me`; quem envia é você, no seu WhatsApp, e depois clica em **Marcar como enviado**. Respostas de WhatsApp são registradas à mão no perfil do lead (**Registrar resposta**) e a IA classifica. Entregue/lido nunca são marcados, porque não dá para confirmar sem API.

Os e-mails das cadências saem pelo servidor (Resend):

| Peça | O que faz |
| --- | --- |
| `cadence-runner` | Executa as etapas vencidas (agendado a cada 5 min). Usa o mesmo planejador do modo de teste (`_shared/automation/planner.ts`) |
| `email-webhook` | Recebe eventos do Resend (entregue, devolvido, spam, resposta), com assinatura svix |
| `_shared/automation/replies.ts` | Regras de reação às respostas, comuns ao app e ao servidor |

Passo a passo:

1. Aplique as migrations: `supabase db push` (inclui `…_automacao_enums.sql` e `…_automacao.sql`; nada é apagado — as etapas antigas viram Qualificado e Não interessado).
2. **E-mail (Resend):** verifique o domínio do remetente no Resend; o e-mail em Configurações → Envio precisa ser desse domínio. Para receber respostas, configure o recebimento (Inbound) do Resend no domínio usado no Reply-To.
3. Secrets (nunca no frontend):

   ```bash
   supabase secrets set RESEND_API_KEY=... RESEND_WEBHOOK_SECRET=whsec_... \
     CRON_SECRET=<texto aleatório longo>
   # opcional: EMAIL_FROM_FALLBACK=contato@seudominio.com.br
   ```

4. Publique as funções (os webhooks e o runner usam a própria verificação, não o JWT do usuário):

   ```bash
   supabase functions deploy ai
   supabase functions deploy cadence-runner --no-verify-jwt
   supabase functions deploy email-webhook --no-verify-jwt
   ```

5. Webhook do e-mail:
   - Resend → Webhooks: URL `https://<PROJECT_REF>.supabase.co/functions/v1/email-webhook`, eventos `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.received`.
6. Agende o runner: veja `supabase/cron_cadence_runner.example.sql` (pg_cron + pg_net, segredo no Vault).

Regras da automação: nunca envia duas vezes a mesma etapa; para os follow-ups quando o lead responde; cancela tudo quando o lead vira Cliente ou Não interessado, ou entra na lista de supressão. Respostas automáticas de ausência não interrompem a cadência.

**API oficial do WhatsApp (desligada).** O código para a WhatsApp Business Platform (Meta) continua no projeto (`_shared/channels/metaWhatsapp.ts` e a função `whatsapp-webhook`), mas não é publicado nem usado. Só seria ativado com `WHATSAPP_AUTO=true`, as credenciais da Meta e opt-in de cada lead; as telas não mudam.

## Segurança e LGPD

- Nenhuma chave secreta no frontend: só `VITE_SUPABASE_URL` e a anon key (pública).
- RLS em todas as tabelas (`owner_id = auth.uid()`); `lead_activities` e `ai_runs` só aceitam leitura e inserção.
- Sem scraping, sem robôs e sem automação de WhatsApp Web. WhatsApp só por link `wa.me`, enviado manualmente pela pessoa.
- Todo e-mail automático leva o rodapé "Para não receber mais mensagens, responda PARAR." e o cabeçalho `List-Unsubscribe`. Responder PARAR, pedir para sair ou marcar como spam põe o contato na lista de supressão e encerra as cadências.
- Envios só dentro da janela configurada (padrão: dias úteis, 9h–18h, horário de Brasília).
- `lead_sources.expires_at` existe para respeitar limites de cache de providers como o Google Places.

## Fases

- **MVP:** fluxo completo com mocks, Claude opcional via Edge Function.
- **Fase 2 — núcleo:** Google Places, CNPJ via BrasilAPI, dados no Supabase, reexecução com só empresas novas.
- **Fase 2 — restante:** exportação CSV, webhooks para n8n/CRM, análise do site da empresa, lembretes de follow-up.
- **Fase 3 — automação (este código):** CRM, pipeline novo, campanhas, cadências visuais, WhatsApp por wa.me com envio manual, follow-ups, e-mail via Resend, classificação de respostas, tarefas, dashboard com leitura da IA.
- **Próximas:** exportação CSV, integrações de CRM, equipes com permissões, planos e cobrança.
