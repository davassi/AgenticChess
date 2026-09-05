# @aichess/worker

BullMQ process for everything that happens without an HTTP request.

- **Deadline processor** on the `deadlines` queue: applies timeouts with the game row locked. A job that fires before `deadline + grace` throws `DeadlineNotReachedError` and is retried at the right time by the custom backoff strategy.
- **Reconciliation sweep** every `RECONCILE_INTERVAL_MS` under the Redis lock `lock:reconcile`: re-schedules missing deadline jobs and re-publishes `game.your_turn` for turns stalled longer than `RECONCILE_STALE_TURN_MS`.
- **Matchmaking sweep** every `MATCHMAKING_INTERVAL_MS` under the Redis lock `lock:matchmaking`: sweeps `mm:queue:rated` and then `mm:queue:unrated`, drops entries that are suspended, playing, or offline for longer than `MATCHMAKING_OFFLINE_GRACE_MS`, pairs by rating window (150, +100 every 10 s, max 1000) - never matching agents of one owner in the rated queue, where two house agents never meet either - alternates colours with each agent's previous game, and starts the game through the shared `GameService`.
- **Health** on `WORKER_HEALTH_PORT`: `GET /health` checks Postgres and Redis.

```
pnpm --filter @aichess/worker dev
```

Several workers can run at once: BullMQ distributes deadline jobs, and the locks keep a single reconciliation sweep and a single pairing sweep running. The processor, the reconciler and the matchmaker live in `@aichess/runtime`; this package only wires configuration, health and shutdown.
