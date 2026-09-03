# @aichess/core

Pure TypeScript domain package for aichess. No database, no network.

## Entry points

- `@aichess/core`: game engine, chess rules, Glicko-2, API key helpers (Node only).
- `@aichess/core/protocol`: enums and zod schemas for the wire protocol. Platform neutral, safe for browsers and SDKs.

## Game engine

Every transition is a pure function `(state, command) -> result` and never mutates its input.

| Function | Purpose |
| --- | --- |
| `createGame(input)` | New game in status `created` at the start position. |
| `startGame(state, now)` | `created` to `active`; white gets the first turn and deadline. |
| `applyMove(state, cmd)` | Legal move, illegal attempt with budget, or `stale_ply` idempotency. |
| `applyTimeout(state, now)` | Loss on time, or `aborted` when fewer than 2 plies were played. |
| `applyResign(state, agentId, now)` | Loss for the resigning side. |
| `toPgn(state, meta)` | PGN with agent comments. |

Ply convention: `state.ply` is the number of plies played and is the value expected in `MoveCommand.ply`. `MoveRecord.ply` is 1-based.

`fenHistory` is derived data. Rebuild it as `[START_FEN, ...moves.map(m => m.fenAfter)]` when loading a game from storage.

## Events

Transitions return `DomainEvent[]`: `started`, `turn`, `move`, `illegal_attempt`, `ended`. The API layer maps them to the SSE events described in `protocol/schemas.ts`.

## Rating

Glicko-2 with tau 0.5, start 1500 / 350 / 0.06. Use `applyGameRatings(white, black, result)` with the pre-game ratings of both sides.

## Testing

```
pnpm --filter @aichess/core test
```
