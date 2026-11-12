#!/usr/bin/env bash
# Backs up a database into one encrypted file: scripts/db-backup.sh [output directory]
#
#   BACKUP_DATABASE_URL  the database to dump — production's DIRECT (unpooled) address, ideally with
#                        the read-only backup role from the README runbook
#
# Writes <directory>/digital-minds-<UTC timestamp>.dump.age (default directory: backups/, which git
# ignores). The dump is pg_dump's custom format, compressed, and only ever exists encrypted: it is
# streamed from pg_dump straight into age, encrypted to the public keys in
# scripts/backup-recipients.txt (X25519 + ChaCha20-Poly1305). Nothing that runs this script holds a
# key that can decrypt the file afterwards; only the matching private key can (README §12.9).
#
# To prove the file is complete, it is also encrypted to a one-time key made for this run, which
# decrypts it once to count the tables and is deleted when the script exits. That key is no more
# exposure than the run itself: the plaintext dump already passes through this machine.
#
# Needs Docker (pg_dump 18 runs in the postgres image, so its version matches the server) and age.
# No secret is put on a command line.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL to the database to back up.}"

POSTGRES_IMAGE="postgres:18.6-alpine"
recipients="$(dirname "$0")/backup-recipients.txt"
if ! grep -q '^age1' "$recipients"; then
  echo "No public key in $recipients: add the public key first (README §12.9)." >&2
  exit 1
fi

out_dir="${1:-backups}"
mkdir -p "$out_dir"
file="$out_dir/digital-minds-$(date -u +%Y-%m-%dT%H%MZ).dump.age"

# The one-time key lives in memory where the system has it (/dev/shm), on disk otherwise.
umask 077
tmp_base="${TMPDIR:-/tmp}"
if [ -d /dev/shm ] && [ -w /dev/shm ]; then tmp_base=/dev/shm; fi
work="$(mktemp -d "$tmp_base/db-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
age-keygen -o "$work/check.key" 2>/dev/null
check_recipient="$(age-keygen -y "$work/check.key")"

# `-e NAME` passes the variable by name, so its value never appears in a process list.
docker run --rm -e BACKUP_DATABASE_URL "$POSTGRES_IMAGE" \
  sh -c 'pg_dump --format=custom --compress=9 --no-owner --no-acl "$BACKUP_DATABASE_URL"' |
  age --encrypt --recipients-file "$recipients" --recipient "$check_recipient" --output "$file"

# Prove the file decrypts and is a complete dump before calling it a backup.
tables="$(
  age --decrypt --identity "$work/check.key" "$file" |
    docker run --rm -i "$POSTGRES_IMAGE" pg_restore --list |
    grep -c ' TABLE DATA ' || true
)"
if [ "$tables" -eq 0 ]; then
  echo "The backup has no table data; something went wrong." >&2
  rm -f "$file"
  exit 1
fi

echo "Backup written: $file ($(wc -c <"$file") bytes, $tables tables)."
