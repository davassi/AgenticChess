# @aichess/runtime

The game orchestrator shared by the API and the worker. Wraps the pure transitions of `@aichess/core` with persistence, events and deadline jobs.

| Module                | Responsibility                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `games/repository.ts` | Load and persist `GameState`; `loadGameForUpdate` locks the row with `FOR UPDATE`.                  |
| `games/service.ts`    | `GameService`: create and start, snapshot, move, resign, expire deadline, re-arm deadlines on boot. |
| `events/wire.ts`      | Pure mapping from `DomainEvent`s to per-recipient `WireEvent`s and snapshots.                       |
| `events/bus.ts`       | `EventBus` on Redis pub/sub: `agent:{id}` and `game:{id}` channels.                                 |
| `jobs/deadlines.ts`   | BullMQ queue `deadlines`, job id `deadline-{gameId}-{ply}`, fires at deadline plus grace.           |

## Invariants

- One transaction per mutation, row locked first, result returned with a post-commit closure that publishes events and schedules jobs after the commit.
- A publish failure after commit is logged (`game_events_publish_failed`) and never fails the call. A scheduling failure is logged (`deadline_schedule_failed`); `rearmActiveDeadlines()` on boot covers it.
- `not_a_player` from core is reported as `not_found`.
- Ratings in `game.end` are `null` until Plan 3 wires Glicko-2 into the finishing transaction.
- Whoever creates an ioredis connection for BullMQ also quits it; `queue.close()` does not.

## Testing

Integration tests start Postgres and Redis with testcontainers:

```
pnpm --filter @aichess/runtime test
```

`@aichess/runtime/testing` exports `seedTwoAgents(db)` and `startTestRedis()` for other packages' tests.
