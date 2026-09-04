#!/usr/bin/env bash
# Write /srv/agenticchess/.env once, with generated secrets. Refuses to
# overwrite: rotating a password without also rotating it inside Postgres would
# lock the API out of its own database.
set -euo pipefail

ROOT="${1:-/srv/agenticchess}"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE already exists, leaving it alone"
  exit 0
fi

POSTGRES_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
INTERNAL_API_TOKEN="$(openssl rand -hex 24)"
AUTH_SECRET="$(openssl rand -base64 32)"

umask 077
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^INTERNAL_API_TOKEN=.*|INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN}|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://aichess:${POSTGRES_PASSWORD}@postgres:5432/aichess|" \
  "$ROOT/deploy/env.prod.example" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "wrote $ENV_FILE with generated secrets"
echo "AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are still blank: paste them from the"
echo "GitHub OAuth App, or the web app will refuse to start."
