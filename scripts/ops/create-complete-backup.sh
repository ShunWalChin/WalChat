#!/usr/bin/env bash

set -Eeuo pipefail

# Cria um pacote restaurável do Wal Chat sem imprimir credenciais no terminal.
# O script deve ser executado como root no host de produção.

backup_id="${1:-}"

if [[ ! "${backup_id}" =~ ^[0-9]{8}T[0-9]{6}-pre-live$ ]]; then
  echo "Uso: $0 YYYYMMDDTHHMMSS-pre-live" >&2
  exit 2
fi

backup_parent="/var/backups/wal-chat"
backup_dir="${backup_parent}/${backup_id}"
archive_path="${backup_parent}/${backup_id}.tar.gz"
checksum_path="${archive_path}.sha256"

if [[ -e "${backup_dir}" || -e "${archive_path}" ]]; then
  echo "O destino do backup já existe: ${backup_id}" >&2
  exit 3
fi

umask 077
install -d -m 0700 "${backup_dir}" "${backup_dir}/database" \
  "${backup_dir}/runtime" "${backup_dir}/volumes"

cleanup_on_error() {
  local exit_code=$?

  if [[ ${exit_code} -ne 0 ]]; then
    echo "Backup interrompido; artefatos parciais preservados em ${backup_dir}" >&2
  fi
}

trap cleanup_on_error EXIT

echo "[1/8] Dump lógico completo do PostgreSQL"
docker exec supabase_db_wal_chat_prod pg_dumpall -U postgres \
  | gzip -9 > "${backup_dir}/database/postgres-all.sql.gz"
docker exec supabase_db_wal_chat_prod pg_dump -U postgres -d postgres -Fc \
  > "${backup_dir}/database/postgres.dump"
docker exec -i supabase_db_wal_chat_prod pg_restore --list \
  < "${backup_dir}/database/postgres.dump" \
  > "${backup_dir}/database/postgres.restore-list.txt"

echo "[2/8] Snapshot consistente do Redis"
docker exec wal-chat-redis-1 redis-cli SAVE > "${backup_dir}/runtime/redis-save.txt"
redis_mount="$(docker volume inspect -f '{{.Mountpoint}}' wal-chat-redis)"
tar -C "${redis_mount}" -czf "${backup_dir}/volumes/wal-chat-redis.tar.gz" .

echo "[3/8] Volumes de Storage e Edge Runtime"
for volume_name in supabase_storage_wal_chat_prod supabase_edge_runtime_wal_chat_prod; do
  volume_mount="$(docker volume inspect -f '{{.Mountpoint}}' "${volume_name}")"
  tar -C "${volume_mount}" -czf "${backup_dir}/volumes/${volume_name}.tar.gz" .
done

echo "[4/8] Aplicação, releases, migrations, configurações e secrets"
tar -C / -czf "${backup_dir}/wal-chat-opt.tar.gz" opt/wal-chat

echo "[5/8] Nginx e certificado TLS"
tar -C / -czf "${backup_dir}/edge-config.tar.gz" \
  etc/nginx/conf.d/wal-chat.conf \
  etc/nginx/conf.d/mano-chat.conf \
  etc/letsencrypt/live/wal-chat.64.181.178.125.nip.io \
  etc/letsencrypt/archive/wal-chat.64.181.178.125.nip.io \
  etc/letsencrypt/renewal/wal-chat.64.181.178.125.nip.io.conf

echo "[6/8] Inventário Docker e configurações de runtime"
mapfile -t container_ids < <(
  docker ps -aq --filter 'name=wal-chat-' --filter 'name=_wal_chat_prod'
)
docker inspect "${container_ids[@]}" > "${backup_dir}/runtime/docker-inspect.json"
docker image ls --digests --no-trunc > "${backup_dir}/runtime/docker-images.txt"
docker volume inspect \
  supabase_db_wal_chat_prod \
  supabase_edge_runtime_wal_chat_prod \
  supabase_storage_wal_chat_prod \
  wal-chat-redis > "${backup_dir}/runtime/docker-volumes.json"
docker network ls --no-trunc > "${backup_dir}/runtime/docker-networks.txt"

echo "[7/8] Imagens próprias do Wal Chat"
mapfile -t wal_chat_images < <(
  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | awk '/^wal-chat-app:/ && !seen[$0]++'
)
docker image save "${wal_chat_images[@]}" \
  | gzip -1 > "${backup_dir}/wal-chat-images.tar.gz"

cat > "${backup_dir}/RESTORE.txt" <<'EOF'
Wal Chat — roteiro mínimo de restauração

1. Restaure wal-chat-opt.tar.gz e edge-config.tar.gz preservando permissões.
2. Carregue as imagens com: gzip -dc wal-chat-images.tar.gz | docker image load
3. Restaure roles/bancos com postgres-all.sql.gz ou use postgres.dump para o
   banco postgres. O dump customizado deve ser inspecionado com pg_restore -l.
4. Restaure os volumes somente com os serviços correspondentes parados.
5. Suba primeiro Supabase/Redis; depois app, webhooks e scheduler.
6. Valide /api/health, /api/ready, autenticação, RLS, filas e webhooks antes de
   reabrir tráfego.

ATENÇÃO: este pacote contém secrets, hashes de autenticação e chave TLS.
Mantenha-o com acesso restrito e nunca o versione no Git.
EOF

echo "[8/8] Manifesto e pacote final"
(
  cd "${backup_dir}"
  find . -type f ! -name 'MANIFEST.sha256' -print0 \
    | sort -z \
    | xargs -0 sha256sum > MANIFEST.sha256
)
tar -C "${backup_parent}" -czf "${archive_path}" "${backup_id}"
sha256sum "${archive_path}" > "${checksum_path}"
chmod 0600 "${archive_path}" "${checksum_path}"

echo "BACKUP_PATH=${archive_path}"
echo "CHECKSUM_PATH=${checksum_path}"
echo "BACKUP_SIZE=$(stat -c %s "${archive_path}")"
echo "BACKUP_SHA256=$(sha256sum "${archive_path}" | awk '{print $1}')"
