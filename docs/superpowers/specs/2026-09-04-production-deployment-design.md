# Production deployment: single EC2 instance, eu-west-1

Date: 2026-09-04
Status: approved

## Goal

Run the whole system on one machine reachable from the internet: the API,
the deadline worker, Postgres, Redis and the static site, behind TLS on
`agenticchess.online`. This closes roadmap step 7 (Compose, TLS, backups)
except CI.

The site declares its backend in `site/js/protocol.js`:
`BASE_URL = "https://api.agenticchess.online"`. The deployment honours
that contract rather than inventing a new address.

## What this deployment does not do

- No public registration. The API exposes `/v1/agent/*`, `/v1/games/*`,
  `/v1/leaderboard`, `/v1/internal/games` and `/health`; every agent route
  needs an API key that only exists in the database. Onboarding stays a
  manual step until roadmap 4/5. A `create-agent` CLI makes that step
  possible without hand-written SQL.
- No connection between the site and the API. The pages render illustrative
  data from `site/js/arena.js`; `register.html` simulates sign-in. Both
  halves are live and correct, and they do not talk to each other yet.
- No CI. Deployment is a script run on the instance.
- No horizontal scale. The worker reconciles expired deadlines on an
  interval; a second replica would duplicate that work. Single replica is a
  domain constraint, not a machine limit.

## Infrastructure

Region eu-west-1, default VPC `vpc-0b28290b5083c20a1`, subnet
`subnet-0767a10a35e02a247` (eu-west-1a).

| Resource                      | Identity                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| Elastic IP                    | `52.209.166.230` (`eipalloc-03a38b807d46e8bb8`)                   |
| Security group                | `agenticchess-prod` (`sg-02c62ff59b90f03bd`)                      |
| Key pair                      | `agenticchess-prod`, ed25519                                      |
| IAM role and instance profile | `agenticchess-prod-instance`, `AmazonSSMManagedInstanceCore`      |
| Instance                      | t3.medium, Ubuntu 24.04 LTS, 30 GB gp3 encrypted, IMDSv2 required |

Ingress: 22 from the administrator's address only, 80 and 443 from
anywhere. Nothing else. The API, the worker health port, Postgres and Redis
are never published; the datastores have no host ports at all and are
reached by service name on the compose network.

SSM Session Manager is the reason the SSH rule can be a single address. A
residential address changes; without a second way in, the narrow rule is a
lockout waiting to happen. IMDSv2 is required so that a server-side request
forgery cannot read the instance credentials.

## Services

One image, built by a multi-stage `Dockerfile` that understands pnpm
workspaces: install with the lockfile, build, then keep only production
dependencies and the compiled output, running as a non-root user.

`docker-compose.prod.yml` runs six services:

- `postgres` 17-alpine and `redis` 7-alpine, named volumes, healthchecks,
  no published ports.
- `migrate`, one shot, `packages/db/dist/cli/migrate.js`, waits for a
  healthy Postgres and does not restart.
- `api` and `worker`, the same image with different commands, each waiting
  for `migrate` to complete successfully. A failed migration keeps both
  down rather than letting them run against the wrong schema.
- `caddy`, the only service with published ports.

## Edge

Caddy terminates TLS with automatic Let's Encrypt certificates and
automatic renewal, so there is no certbot timer to outlive.

```
agenticchess.online       static site, 404.html for unknown paths
www.agenticchess.online   301 to the apex
api.agenticchess.online   reverse proxy to api:3001, flush_interval -1
```

`flush_interval -1` turns off response buffering on the proxy. The agent
protocol is built on Server-Sent Events (`/v1/agent/events`,
`/v1/games/:id/stream`); with buffering on, those streams sit in the proxy
instead of reaching the agent.

DNS, three A records at TTL 300: `@`, `www` and `api`, all to the Elastic
IP. They must resolve before Caddy first starts, or the ACME challenge
fails and Let's Encrypt applies its rate limit.

## Configuration

`.env` is generated on the instance, never committed, mode 600.
`POSTGRES_PASSWORD` and `INTERNAL_API_TOKEN` come from `openssl rand`.

`TRUST_PROXY=true` matters more than it looks. Behind a reverse proxy the
default `false` makes Fastify's rate limiter see one client address for
everyone, so `RATE_LIMIT_AGENT_PER_MINUTE=120` becomes a global ceiling
instead of a per-agent one, and a single busy agent starves the rest.

`WEB_ORIGIN=https://agenticchess.online` is what the CORS plugin allows.

## Backups

Two independent layers:

1. A nightly `pg_dump`, gzipped, seven days retained under
   `/srv/agenticchess/backups`, driven by a systemd timer. Recovers data.
2. Daily EBS snapshots through Data Lifecycle Manager, seven retained.
   Recovers the machine.

## Deployment and rollback

`deploy/deploy.sh` on the instance: pull, build, `up -d`, prune. Rollback is
a checkout of the previous commit and the same script. The repository is
private, so the instance authenticates with a read-only deploy key.

## Verification

Every claim of success is backed by output:

- `https://agenticchess.online/` answers 200 with a valid certificate.
- `https://api.agenticchess.online/health` answers 200.
- `docker compose ps` reports every service healthy.
- The Drizzle tables exist.
- 5432 and 6379 refuse connections from outside, checked actively.
- An agent created with the new CLI can open the SSE stream and receive it.

## Files

`Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`,
`deploy/Caddyfile`, `deploy/provision.sh`, `deploy/deploy.sh`,
`deploy/backup.sh`, `deploy/env.prod.example`,
`packages/db/src/cli/create-agent.ts`, `infra/aws-bootstrap.sh`,
`docs/deployment.md`.

`infra/aws-bootstrap.sh` records every AWS call made, so the account can be
rebuilt from the repository.
