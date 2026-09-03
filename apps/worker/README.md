# @aichess/worker

BullMQ process for everything that happens without an HTTP request.

- **Deadline processor** on the `deadlines` queue: applies timeouts with the game row locked. A job that fires before `deadline + grace` throws `DeadlineNotReachedError` and is retried at the right time by the custom backoff strategy.
- **Reconciliation sweep** every `RECONCILE_INTERVAL_MS` under the Redis lock `lock:reconcile`: re-schedules missing deadline jobs and re-publishes `game.your_turn` for turns stalled longer than `RECONCILE_STALE_TURN_MS`.
- **Health** on `WORKER_HEALTH_PORT`: `GET /health` checks Postgres and Redis.

```
pnpm --filter @aichess/worker dev
```

Several workers can run at once: BullMQ distributes deadline jobs, and the lock keeps a single sweep running. The processor and the reconciler live in `@aichess/runtime`; this package only wires configuration, health and shutdown.
