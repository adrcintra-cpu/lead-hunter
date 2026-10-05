#!/usr/bin/env bash
# Lead Hunter — liga o projeto às APIs reais (Supabase, Claude, Google Places, Resend).
# WhatsApp é sem API (link wa.me): não precisa de configuração.
#
# Rode no Terminal, na pasta do projeto:   bash scripts/configurar-apis.sh
#
# As chaves são digitadas aqui (sem aparecer na tela) e vão direto para os secrets do Supabase.
# Nada é gravado em arquivo nem enviado para o GitHub. Pode rodar de novo quando quiser:
# deixe em branco o que não quer mudar.

set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
ask() { local v; read -r -p "  $1: " v; printf '%s' "$v"; }
ask_secret() { local v; read -r -s -p "  $1 (não aparece na tela; Enter para pular): " v; echo >&2; printf '%s' "$v"; }
confirm() { local v; read -r -p "  $1 [s/N]: " v; [[ "$v" == "s" || "$v" == "S" ]]; }

if command -v supabase >/dev/null 2>&1; then SB=(supabase); else SB=(npx -y supabase@latest); fi

bold "1/6 · Entrar no Supabase"
echo "  Vai abrir o navegador para você autorizar."
"${SB[@]}" login
ok "Conectado"

bold "2/6 · Projeto"
echo "  O código do projeto está na URL do painel: supabase.com/dashboard/project/<CÓDIGO>"
REF="$(ask 'Código do projeto')"
[[ -z "$REF" ]] && { echo "Código obrigatório."; exit 1; }
"${SB[@]}" link --project-ref "$REF"
ok "Projeto ligado"

bold "3/6 · Banco de dados"
echo "  Aplica as tabelas e a segurança por usuário (não apaga dados)."
"${SB[@]}" db push
ok "Banco atualizado"

bold "4/6 · Chaves dos serviços"
SECRETS=()
CLAUDE="$(ask_secret 'Chave da Claude API (sk-ant-...)')"
[[ -n "$CLAUDE" ]] && SECRETS+=("ANTHROPIC_API_KEY=$CLAUDE")
GOOGLE="$(ask_secret 'Chave do Google Places')"
SEARCH=mock
if [[ -n "$GOOGLE" ]]; then SECRETS+=("GOOGLE_PLACES_API_KEY=$GOOGLE"); SEARCH=google_places; fi

RESEND=""
if confirm "Configurar e-mail (Resend) agora?"; then
  RESEND="$(ask_secret 'Chave do Resend (re_...)')"
  RESEND_WH="$(ask_secret 'Signing secret do webhook do Resend (whsec_...)')"
  [[ -n "$RESEND" ]] && SECRETS+=("RESEND_API_KEY=$RESEND")
  [[ -n "$RESEND_WH" ]] && SECRETS+=("RESEND_WEBHOOK_SECRET=$RESEND_WH")
fi

CRON_SECRET=""
if confirm "Primeira vez configurando a automação? (gera o segredo do agendador)"; then
  CRON_SECRET="$(openssl rand -hex 32)"
  SECRETS+=("CRON_SECRET=$CRON_SECRET")
fi

if [[ ${#SECRETS[@]} -gt 0 ]]; then
  "${SB[@]}" secrets set "${SECRETS[@]}" >/dev/null
  ok "${#SECRETS[@]} secrets gravados no Supabase"
else
  warn "Nenhuma chave nova informada"
fi
unset CLAUDE GOOGLE RESEND_WH SECRETS

bold "5/6 · Publicar as funções"
"${SB[@]}" functions deploy ai
"${SB[@]}" functions deploy providers
"${SB[@]}" functions deploy cadence-runner --no-verify-jwt
[[ -n "$RESEND" ]] && "${SB[@]}" functions deploy email-webhook --no-verify-jwt
unset RESEND
ok "Funções publicadas"

URL="https://$REF.supabase.co"
bold "6/6 · O que falta fazer à mão"

echo
echo "  A) Vercel → lead-hunter → Settings → Environment Variables:"
echo "       VITE_DATA_MODE        = supabase"
echo "       VITE_SUPABASE_URL     = $URL"
echo "       VITE_SUPABASE_ANON_KEY= (a chave 'anon' abaixo — é pública)"
echo "       VITE_SEARCH_PROVIDER  = $SEARCH"
"${SB[@]}" projects api-keys --project-ref "$REF" 2>/dev/null | grep -i anon || warn "Copie a chave anon em Project Settings → API."
echo "     Depois: Deployments → Redeploy."
echo
echo "  B) Supabase → Authentication → URL Configuration → Site URL:"
echo "       https://lead-hunter-beige-chi.vercel.app"

echo
echo "  C) Resend → Webhooks (se usar e-mail):"
echo "       URL: $URL/functions/v1/email-webhook"
echo
if [[ -n "$CRON_SECRET" ]]; then
echo "  D) Agendar a automação (só na primeira vez; se já fez, pule), a cada 5 min. Supabase → Database → Extensions: ative pg_cron e pg_net."
echo "     Depois, no SQL Editor, cole e rode:"
echo
cat <<SQL
select vault.create_secret('$CRON_SECRET', 'cron_secret');
select cron.schedule('lead-hunter-cadence-runner', '*/5 * * * *', \$\$
  select net.http_post(
    url := '$URL/functions/v1/cadence-runner',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb);
\$\$);
SQL
echo
fi
ok "Pronto. Faça um teste controlado antes de usar com clientes (guia, Etapa 7)."
