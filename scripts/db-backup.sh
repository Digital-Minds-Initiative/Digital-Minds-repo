#!/usr/bin/env bash
# Backs up a database into one encrypted file: scripts/db-backup.sh [output directory]
#
#   BACKUP_DATABASE_URL  the database to dump — production's DIRECT (unpooled) address, ideally with
#                        the read-only backup role from the README runbook
#   BACKUP_PASSPHRASE    the passphrase the file is encrypted with (AES-256, gpg symmetric)
#
# Writes <directory>/digital-minds-<UTC timestamp>.dump.gpg (default directory: backups/, which git
# ignores). The dump is pg_dump's custom format, compressed, and only ever exists encrypted: it is
# streamed from pg_dump straight into gpg. Needs Docker (pg_dump 18 runs in the postgres image, so
# its version matches the server) and gpg. Neither secret is put on a command line.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL to the database to back up.}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the passphrase that encrypts the file.}"

POSTGRES_IMAGE="postgres:18.6-alpine"
out_dir="${1:-backups}"
mkdir -p "$out_dir"
file="$out_dir/digital-minds-$(date -u +%Y-%m-%dT%H%MZ).dump.gpg"

# `-e NAME` passes the variable by name, so its value never appears in a process list.
docker run --rm -e BACKUP_DATABASE_URL "$POSTGRES_IMAGE" \
  sh -c 'pg_dump --format=custom --compress=9 --no-owner --no-acl "$BACKUP_DATABASE_URL"' |
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
    --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") --output "$file"

# Prove the file decrypts and is a complete dump before calling it a backup.
tables="$(
  gpg --batch --quiet --pinentry-mode loopback --decrypt \
    --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") "$file" |
    docker run --rm -i "$POSTGRES_IMAGE" pg_restore --list |
    grep -c ' TABLE DATA ' || true
)"
if [ "$tables" -eq 0 ]; then
  echo "The backup has no table data; something went wrong." >&2
  rm -f "$file"
  exit 1
fi

echo "Backup written: $file ($(wc -c <"$file") bytes, $tables tables)."
