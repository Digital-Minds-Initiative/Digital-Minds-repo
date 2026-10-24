#!/usr/bin/env bash
# Restores an encrypted backup: scripts/db-restore.sh <file.dump.gpg>
#
#   RESTORE_DATABASE_URL  the database to restore INTO — its DIRECT (unpooled) address with the owner
#                         role. Restore into a new Neon branch first and check it (README runbook).
#   BACKUP_PASSPHRASE     the passphrase the file was encrypted with
#
# Every table in the backup is dropped and recreated in the target, in one transaction: either the
# whole backup lands or nothing changes. Asks you to type the target's host before it starts.
# Afterwards run scripts/sql/app-role.sql on the target, because the dump carries no grants.
set -euo pipefail

file="${1:?Usage: scripts/db-restore.sh <file.dump.gpg>}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to the database to restore into.}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the passphrase of the backup.}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

POSTGRES_IMAGE="postgres:18.6-alpine"
# Host and database only, never the credentials.
target="$(printf '%s' "$RESTORE_DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^/?]+)(/[^?]*)?.*#\2\3#')"
host="${target%%/*}"

echo "This replaces every table of the backup in: $target"
read -r -p "Type the host ($host) to continue: " typed
[ "$typed" = "$host" ] || { echo "Not confirmed; nothing was changed." >&2; exit 1; }

gpg --batch --quiet --pinentry-mode loopback --decrypt \
  --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") "$file" |
  docker run --rm -i -e RESTORE_DATABASE_URL "$POSTGRES_IMAGE" \
    sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error --dbname "$RESTORE_DATABASE_URL"'

echo "Restored $file into $target. Now run scripts/sql/app-role.sql there (the dump carries no grants)."
