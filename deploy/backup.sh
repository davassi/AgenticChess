#!/usr/bin/env bash
# Nightly logical backup. Recovers data; the EBS snapshot policy recovers the
# machine. Two layers because they fail in different ways.
set -euo pipefail

ROOT="${AGENTICCHESS_ROOT:-/srv/agenticchess}"
DEST="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"
umask 077

# shellcheck disable=SC1091
set -a; . "$ROOT/.env"; set +a

TMP="$DEST/.aichess-$STAMP.sql.gz.partial"
FINAL="$DEST/aichess-$STAMP.sql.gz"

# Write to a .partial name and rename only on success, so a backup interrupted
# halfway never looks like a usable one.
docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$TMP"

mv "$TMP" "$FINAL"
echo "wrote $FINAL ($(du -h "$FINAL" | cut -f1))"

find "$DEST" -name 'aichess-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -name '.aichess-*.partial' -mtime +1 -delete
