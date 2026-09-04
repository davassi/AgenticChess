#!/usr/bin/env bash
# Deploy on the instance. Idempotent: safe to run again at any time.
#
#   ssh agenticchess 'sudo -u deploy /srv/agenticchess/deploy/deploy.sh'
#
# Rollback is the same script after checking out the previous commit:
#   git -C /srv/agenticchess checkout <sha> && deploy/deploy.sh
set -euo pipefail

ROOT="${AGENTICCHESS_ROOT:-/srv/agenticchess}"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT")

cd "$ROOT"

if [ "${SKIP_PULL:-0}" != "1" ]; then
  echo "==> pulling"
  git pull --ff-only
fi

echo "==> building"
"${COMPOSE[@]}" build

echo "==> starting"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> waiting for health"
for _ in $(seq 1 60); do
  if [ "$("${COMPOSE[@]}" ps --format '{{.Health}}' api)" = "healthy" ]; then
    break
  fi
  sleep 5
done

"${COMPOSE[@]}" ps

echo "==> pruning old images"
docker image prune -f >/dev/null

echo "==> done"
