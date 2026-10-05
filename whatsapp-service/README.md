# Serviço de WhatsApp (QR code) do Lead Hunter

Servidor Node que mantém a sessão do WhatsApp de cada usuário, usando a biblioteca **Baileys**. Os usuários conectam com QR code, sem a API oficial da Meta.

```
Site (Vercel) ──HTTPS + token de login──▶ este serviço ──▶ SessionManager ──▶ Baileys ──▶ WhatsApp Web
```

**Por que Baileys, e não whatsapp-web.js:** o Baileys fala direto com o protocolo do WhatsApp Web, sem abrir um navegador. O whatsapp-web.js precisa de um Chromium rodando por usuário (mais memória, imagem maior, mais instável). Isso torna o Baileys o mais adequado para um servidor pequeno e para vários usuários.

**Por que um servidor separado:** a conexão com o WhatsApp precisa ficar aberta o tempo todo. Vercel e Edge Functions do Supabase encerram as execuções em segundos, então não conseguem manter essa conexão.

## Segurança

- Toda rota `/whatsapp/*` exige o token de login do Supabase do usuário.
  - O usuário é identificado pelo token, nunca por um parâmetro, então ninguém acessa a sessão de outra pessoa.
- As chaves da sessão do WhatsApp ficam na tabela `whatsapp_auth`, criptografadas com AES-256-GCM (`WA_ENCRYPTION_KEY`).
  - A tabela tem RLS sem nenhuma policy: só o serviço, com a secret key, consegue ler.
  - O site só lê `whatsapp_connections` (número, status e datas), e só a linha do próprio usuário.
- Nada da sessão vai para o navegador nem para o localStorage.
- CORS: só aceita chamadas dos endereços listados em `ALLOWED_ORIGINS`.
- Limites:
  - por minuto, por usuário e por rota;
  - envio individual, com intervalo mínimo entre mensagens (`SEND_MIN_INTERVAL_SECONDS`) e limite diário (`SEND_DAILY_LIMIT`).
  - Não existe envio em massa.
- Logs técnicos em JSON registram: QR gerado, sessão iniciada / conectada / restaurada / desconectada, erro de autenticação, erro de envio e reconexão. Não registram o texto das mensagens, e os telefones aparecem mascarados.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | Verificação de vida (sem login) |
| GET | `/whatsapp/status` | Status, QR (enquanto aguarda), número e datas |
| POST | `/whatsapp/connect` | Inicia a sessão; sem sessão salva, gera QR |
| POST | `/whatsapp/test` | Confirma que a sessão responde |
| POST | `/whatsapp/disconnect` | Sai do WhatsApp, apaga a sessão salva |
| POST | `/whatsapp/send` | `{ phone, message }`: envia uma mensagem |

## Publicar no Railway

1. **Banco:** aplique a migration `supabase/migrations/20261005000400_whatsapp_qr.sql` (na pasta do projeto: `npx supabase db push`).
2. **Gere a chave de criptografia** no terminal, com um destes comandos:

   ```
   openssl rand -hex 32
   ```

   ou

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Guarde a chave no gerenciador de senhas. Se ela for perdida, as sessões salvas deixam de abrir e é preciso ler o QR de novo.
3. **Crie o serviço:** railway.com → New Project → Deploy from GitHub repo → `lead-hunter`.
4. **Configure o serviço:**
   - em Settings → Root Directory, use `whatsapp-service` (o Railway usa o `Dockerfile` daqui);
   - em Settings → Deploy, deixe **1 réplica**, porque as sessões ficam na memória do processo.
5. **Variáveis** (em Variables):

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://<seu-projeto>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → Secret key (`sb_secret_...`) |
   | `WA_ENCRYPTION_KEY` | a chave gerada no passo 2 |
   | `ALLOWED_ORIGINS` | `https://lead-hunter-beige-chi.vercel.app` |
   | `SEND_MIN_INTERVAL_SECONDS` | `8` (opcional) |
   | `SEND_DAILY_LIMIT` | `60` (opcional) |

6. **Gere o endereço público:** Settings → Networking → Generate Domain. Teste abrindo `https://<endereço>/health`; deve aparecer `{"ok":true}`.
7. **Ligue o site ao serviço:**
   - na Vercel, adicione a variável `VITE_WHATSAPP_SERVICE_URL` com o endereço do passo 6, sem barra no final;
   - faça o redeploy.
8. **Conecte:** no Lead Hunter, vá em Configurações → WhatsApp → **CONECTAR WHATSAPP** e leia o QR code com o celular.

O mesmo `Dockerfile` funciona no Render (Web Service, com Root Directory `whatsapp-service`) e em qualquer servidor com Docker.

## Rodar localmente

```
cd whatsapp-service
cp .env.example .env   # preencha os valores
npm install
npm run dev
```

## Avisos

- Conectar o WhatsApp por fora da API oficial vai contra os termos do WhatsApp e pode levar ao bloqueio do número.
  - Prefira um número comercial dedicado.
  - Envie só para quem faz sentido, em volume baixo.
  - Respeite os pedidos de descadastro (a lista de supressão do Lead Hunter bloqueia o envio).
- O WhatsApp muda o protocolo de tempos em tempos. Se a conexão parar de funcionar, atualize a biblioteca (`npm install @whiskeysockets/baileys@latest`) e publique de novo.

## Próximos passos (estrutura já preparada)

O `SessionManager.sendMessage` é o único ponto de envio. Uma fila futura (agendamentos, follow-ups, campanhas) deve chamar esse método, um envio por vez, respeitando o intervalo e o limite diário, com pausa e cancelamento por campanha. Não deve haver disparos simultâneos.
