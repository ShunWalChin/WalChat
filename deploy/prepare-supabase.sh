#!/usr/bin/env bash
# Materializa uma cópia exclusiva do Supabase e remapeia portas/domínios da homologação.
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/wal-chat}"
APP_DOMAIN="${APP_DOMAIN:-wal-chat.64.181.178.125.nip.io}"
API_DOMAIN="${API_DOMAIN:-api-wal-chat.64.181.178.125.nip.io}"
INSTANCE_ROOT="$DEPLOY_ROOT/supabase-instance"
SOURCE_ROOT="$DEPLOY_ROOT/app/supabase"
TARGET_ROOT="$INSTANCE_ROOT/supabase"

# Impede que um valor acidental escreva fora da raiz de implantação aprovada.
if [[ "$DEPLOY_ROOT" != "/opt/wal-chat" ]]; then
  printf 'DEPLOY_ROOT inesperado: %s\n' "$DEPLOY_ROOT" >&2
  exit 1
fi

install -d -m 750 "$INSTANCE_ROOT" "$TARGET_ROOT" "$TARGET_ROOT/migrations"
install -m 640 "$SOURCE_ROOT/config.toml" "$TARGET_ROOT/config.toml"
install -m 640 "$SOURCE_ROOT/seed.sql" "$TARGET_ROOT/seed.sql"
cp -f "$SOURCE_ROOT"/migrations/*.sql "$TARGET_ROOT/migrations/"

sed -i \
  -e 's/project_id = ".*"/project_id = "wal_chat_prod"/' \
  -e 's/port = 54321/port = 54351/' \
  -e 's/port = 54322/port = 54352/' \
  -e 's/shadow_port = 54320/shadow_port = 54350/' \
  -e 's/port = 54329/port = 54359/' \
  -e 's/port = 54323/port = 54353/' \
  -e 's/port = 54324/port = 54354/' \
  -e 's/port = 54327/port = 54357/' \
  -e 's/inspector_port = 8083/inspector_port = 8074/' \
  -e "s|site_url = \".*\"|site_url = \"https://$APP_DOMAIN\"|" \
  -e "s|# external_url = \"\"|external_url = \"https://$API_DOMAIN\"|" \
  -e "s|additional_redirect_urls = \[.*\]|additional_redirect_urls = [\"https://$APP_DOMAIN\"]|" \
  "$TARGET_ROOT/config.toml"

chmod 750 "$INSTANCE_ROOT" "$TARGET_ROOT" "$TARGET_ROOT/migrations"
printf 'Supabase isolado preparado em %s\n' "$INSTANCE_ROOT"
