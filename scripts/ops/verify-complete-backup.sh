#!/usr/bin/env bash

set -Eeuo pipefail

# Verifica o hash externo, a estrutura do tar e todos os arquivos do manifesto.
# A extração ocorre em diretório temporário restrito, removido automaticamente.

archive_path="${1:-}"

if [[ ! "${archive_path}" =~ ^/var/backups/wal-chat/[0-9]{8}T[0-9]{6}-pre-live\.tar\.gz$ ]]; then
  echo "Caminho de backup inválido: ${archive_path}" >&2
  exit 2
fi

checksum_path="${archive_path}.sha256"
backup_name="$(basename "${archive_path}" .tar.gz)"
verify_dir="$(mktemp -d /tmp/wal-chat-backup-verify.XXXXXX)"

if [[ ! "${verify_dir}" =~ ^/tmp/wal-chat-backup-verify\.[A-Za-z0-9]+$ ]]; then
  echo "Diretório temporário inesperado: ${verify_dir}" >&2
  exit 3
fi

chmod 0700 "${verify_dir}"
trap 'rm -rf -- "${verify_dir}"' EXIT

echo "[1/4] Hash do pacote"
sha256sum --check "${checksum_path}"

echo "[2/4] Integridade gzip/tar"
gzip --test "${archive_path}"
tar -tzf "${archive_path}" >/dev/null

echo "[3/4] Extração temporária"
tar --no-same-owner -xzf "${archive_path}" -C "${verify_dir}"

echo "[4/4] Manifesto interno"
(
  cd "${verify_dir}/${backup_name}"
  sha256sum --check MANIFEST.sha256
)

echo "BACKUP_VERIFIED=${archive_path}"
