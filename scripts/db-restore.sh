#!/usr/bin/env bash
# Restores an encrypted backup: scripts/db-restore.sh <file.dump.age>
#
#   RESTORE_DATABASE_URL  the database to restore INTO — its DIRECT (unpooled) address with the owner
#                         role. Restore into a new Neon branch first and check it (README runbook).
#   BACKUP_KEY            the private key, the AGE-SECRET-KEY-1… line from the password manager
#                         (README §12.9). Or BACKUP_IDENTITY: the path to a key file instead.
#
# Backups made before the switch to age are .dump.gpg files and still restore, with
# BACKUP_PASSPHRASE instead of BACKUP_KEY, until the last of them expires.
#
# Every table in the backup is dropped and recreated in the target, in one transaction: either the
# whole backup lands or nothing changes. Asks you to type the target's host before it starts.
# Afterwards run scripts/sql/app-role.sql on the target, because the dump carries no grants.
set -euo pipefail

file="${1:?Usage: scripts/db-restore.sh <file.dump.age>}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to the database to restore into.}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

case "$file" in
  *.dump.age)
    if [ -n "${BACKUP_KEY:-}" ]; then
      # The key reaches age through a pipe, never a file or a command line.
      decrypt() { age --decrypt --identity <(printf '%s\n' "$BACKUP_KEY") "$file"; }
    else
      : "${BACKUP_IDENTITY:?Set BACKUP_KEY to the private key of the backups (AGE-SECRET-KEY-1…).}"
      [ -f "$BACKUP_IDENTITY" ] || { echo "No such key file: $BACKUP_IDENTITY" >&2; exit 1; }
      decrypt() { age --decrypt --identity "$BACKUP_IDENTITY" "$file"; }
    fi
    ;;
  *.dump.gpg)
    : "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the passphrase of the backup.}"
    decrypt() {
      gpg --batch --quiet --pinentry-mode loopback --decrypt \
        --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") "$file"
    }
    ;;
  *)
    echo "Expected a .dump.age file (or an older .dump.gpg one): $file" >&2
    exit 1
    ;;
esac

POSTGRES_IMAGE="postgres:18.6-alpine"
# Host and database only, never the credentials.
target="$(printf '%s' "$RESTORE_DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^/?]+)(/[^?]*)?.*#\2\3#')"
host="${target%%/*}"

echo "This replaces every table of the backup in: $target"
read -r -p "Type the host ($host) to continue: " typed
[ "$typed" = "$host" ] || { echo "Not confirmed; nothing was changed." >&2; exit 1; }

# A wrong key or passphrase stops age before pg_restore sees a byte; the single transaction then
# rolls back whatever it had started, so nothing changes.
decrypt |
  docker run --rm -i -e RESTORE_DATABASE_URL "$POSTGRES_IMAGE" \
    sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error --dbname "$RESTORE_DATABASE_URL"'

echo "Restored $file into $target. Now run scripts/sql/app-role.sql there (the dump carries no grants)."
