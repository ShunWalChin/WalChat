#!/usr/bin/env bash
# Gera o ambiente do backend a partir das chaves da instância Supabase isolada.
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/wal-chat}"
APP_DOMAIN="${APP_DOMAIN:-wal-chat.64.181.178.125.nip.io}"
API_DOMAIN="${API_DOMAIN:-api-wal-chat.64.181.178.125.nip.io}"
STATUS_ENV="$DEPLOY_ROOT/supabase-instance/status.env"
OUTPUT_ENV="$DEPLOY_ROOT/app/.env.production"

if [[ "$DEPLOY_ROOT" != "/opt/wal-chat" ]]; then
  printf 'DEPLOY_ROOT inesperado: %s\n' "$DEPLOY_ROOT" >&2
  exit 1
fi

if [[ ! -f "$STATUS_ENV" ]]; then
  printf 'Arquivo de status do Supabase não encontrado.\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$STATUS_ENV"
set +a

if [[ -z "${PUBLISHABLE_KEY:-}" || -z "${SECRET_KEY:-}" ]]; then
  printf 'As chaves publishable/secret do Supabase não foram encontradas.\n' >&2
  exit 1
fi

# Todos os arquivos criados neste bloco ficam privados para o usuário do deploy.
umask 077
META_SECRET="$(openssl rand -hex 32)"
META_VERIFY="$(openssl rand -hex 24)"
CREDENTIALS_KEY="$(openssl rand -base64 32 | tr -d '\n')"
TEST_PASSWORD="Wal-$(openssl rand -hex 8)!"

{
  printf 'PUBLIC_SUPABASE_URL=https://%s\n' "$API_DOMAIN"
  printf 'SUPABASE_PUBLISHABLE_KEY=%s\n' "$PUBLISHABLE_KEY"
  printf 'VITE_SUPABASE_URL=https://%s\n' "$API_DOMAIN"
  printf 'VITE_SUPABASE_ANON_KEY=%s\n' "$PUBLISHABLE_KEY"
  # O backend usa a rede Docker privada compartilhada com o Supabase isolado.
  # A API pública continua exposta somente pelo Nginx no domínio configurado.
  printf 'SUPABASE_URL=http://api.supabase.internal:8000\n'
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SECRET_KEY"
  printf 'REDIS_URL=redis://redis:6379\n'
  printf 'META_APP_ID=\n'
  printf 'META_APP_SECRET=%s\n' "$META_SECRET"
  printf 'META_ACCESS_TOKEN=\n'
  printf 'META_PUBLISH_TOKEN=\n'
  printf 'META_VERIFY_TOKEN=%s\n' "$META_VERIFY"
  printf 'META_GRAPH_VERSION=v25.0\n'
  printf 'META_OAUTH_REDIRECT_URI=https://%s/api/integrations/meta/callback\n' "$APP_DOMAIN"
  printf 'OPENAI_API_KEY=\n'
  printf 'OPENAI_MODEL=gpt-5.6-sol\n'
  printf 'OPENAI_PROJECT=\n'
  printf 'OPENAI_ORGANIZATION=\n'
  printf 'GOOGLE_GENERATIVE_AI_API_KEY=\n'
  printf 'CREDENTIALS_ENCRYPTION_KEY=%s\n' "$CREDENTIALS_KEY"
  printf 'APP_ORIGIN=https://%s\n' "$APP_DOMAIN"
  printf 'DEMO_MODE=true\n'
  printf 'SMOKE_AUTH_EMAIL=demo@walchat.local\n'
  printf 'SMOKE_AUTH_PASSWORD=%s\n' "$TEST_PASSWORD"
} > "$OUTPUT_ENV"

chmod 600 "$OUTPUT_ENV"
printf 'Ambiente de produção criado com permissões restritas.\n'
