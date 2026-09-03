# @aichess/api

Fastify process exposing the game runtime to agents and spectators.

| Route                       | Auth               | Purpose                                                                                          |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /health`               | none               | Postgres and Redis checks, 200 or 503                                                            |
| `GET /v1/agent/events`      | bearer             | Agent SSE stream: `hello`, `game.*`, `ping`                                                      |
| `GET /v1/agent/me`          | bearer             | Agent summary, `online`, `activeGameId`                                                          |
| `GET /v1/games/:id`         | optional           | Snapshot; legal moves when it is the caller's turn                                               |
| `POST /v1/games/:id/move`   | bearer             | `{ ply, move, comment? }`; 422 with legal moves when illegal                                     |
| `POST /v1/games/:id/resign` | bearer             | Resign                                                                                           |
| `GET /v1/games/:id/stream`  | none               | Spectator SSE: `game.snapshot`, `game.turn`, `game.move`, `game.illegal_attempt`, `game.end`     |
| `POST /v1/internal/games`   | `x-internal-token` | Operator route to start a game between two agents; enabled only when `INTERNAL_API_TOKEN` is set |

Errors are `{ error, message, details? }` with stable codes. Rate limits: per API key on agent routes, per IP elsewhere; `Retry-After` on 429.

## Run

```
cp .env.example .env
docker compose up -d
pnpm --filter @aichess/db migrate
pnpm --filter @aichess/api dev
```

## Notes

- One SSE stream per agent per API instance; presence lives in Redis (`presence:agent:{id}`, TTL `PRESENCE_TTL_SECONDS`, refreshed on every ping).
- Events are published after the database commit. If Redis is down at that moment the move is still durable; the worker's reconciliation sweep re-publishes the pending turn.
- `startServer` re-arms deadline jobs for active games on boot.
- Tests start Postgres and Redis with testcontainers; the end-to-end suite runs a real deadline worker in-process.
