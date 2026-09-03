# Plan 2b: HTTP/SSE API and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the game runtime over HTTP and Server-Sent Events for agents and spectators, and run the worker that expires move deadlines and reconciles stalled games, so that two agents can play a complete game against a running server.

**Architecture:** `apps/api` is a Fastify 5 process: bearer-key authentication, zod-validated routes over `GameService`, one SSE stream per agent (with Redis presence) and public SSE streams per game, Redis-backed rate limiting. `apps/worker` is a BullMQ process: it runs the `deadlines` queue processor with a backoff strategy that turns an early job into a retry at the right time, and a periodic reconciliation sweep that re-publishes `game.your_turn` for stalled turns and re-schedules missing deadline jobs. Both apps are thin shells over `@aichess/runtime`, which gains three small additions in Task 1.

**Tech Stack:** Node 22, pnpm 10, Turborepo 2, TypeScript 5.9, vitest 3, Fastify 5.12, @fastify/cors 11, @fastify/rate-limit 11, pino 10, ioredis 5, bullmq 6, zod 4, testcontainers 12.

**Spec:** `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 4, 6, 7, 13, 14, 15, 16). Plans 1 and 2a define `@aichess/core`, `@aichess/db` and `@aichess/runtime`, consumed here.

## Global Constraints

- Run every `pnpm` and `node` command under Node 22: prefix with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`. Docker must be running: integration tests start Postgres and Redis containers.
- ESM only, explicit `.js` extensions on relative imports, `verbatimModuleSyntax` on. pnpm resolves strictly: every package declares every module it imports.
- Workspace packages resolve through `dist/` at typecheck and runtime; run `pnpm build` at the root before `typecheck` in any app. Vitest resolves workspace packages to `src/` through the aliases in each `vitest.config.ts`.
- Configuration comes from environment variables validated with zod at process start. A missing or malformed variable stops the process with a message naming the variable. No URL, port, limit or token is hardcoded.
- HTTP error bodies are always `{ error, message, details? }` with `error` from the spec's code list plus `internal_error`. Status codes: `unauthorized` 401, `agent_suspended` 403, `not_found` 404, `validation_error` 400, `not_your_turn` 409, `stale_ply` 409, `game_not_active` 409, `illegal_move` 422, `already_in_queue` 409, `not_in_queue` 409, `in_active_game` 409, `rate_limited` 429, `service_unavailable` 503, `internal_error` 500.
- Authentication is `Authorization: Bearer <api_key>`: `splitApiKey` → lookup by prefix → `keysMatch(hashApiKey(key), row.apiKeyHash)`; never `===`. A suspended agent gets 403 on every authenticated route.
- One SSE stream per agent; a new connection closes the previous one. While the stream is open the key `presence:agent:{id}` exists in Redis with TTL `PRESENCE_TTL_SECONDS` (30) and is refreshed on every `ping` (`SSE_PING_INTERVAL_MS`, 15000). Closing the stream deletes the key.
- The agent stream opens with `hello` carrying the active game snapshot (or `null`), followed by `game.your_turn` if it is the agent's move. The spectator stream opens with `game.snapshot`.
- Rate limits: `RATE_LIMIT_AGENT_PER_MINUTE` (120) keyed by API key prefix, `RATE_LIMIT_PUBLIC_PER_MINUTE` (300) keyed by client IP. 429 responses carry `Retry-After` and the standard error body.
- CORS: only `WEB_ORIGIN`, only `GET`. Agent routes are not for browsers.
- The deadline job fires at `moveDeadlineAt + NETWORK_GRACE_MS`. A job that fires early throws `DeadlineNotReachedError` and is retried at `fireAt` through the custom backoff strategy. Every other error retries with exponential backoff up to the queue's `attempts`.
- The reconciliation sweep runs every `RECONCILE_INTERVAL_MS` (10000) under a Redis lock so one worker runs it at a time. A turn is stalled when `now - turnStartedAt >= RECONCILE_STALE_TURN_MS` (10000) and no move has arrived; the sweep re-publishes `game.your_turn` and re-schedules any missing deadline job. Clients must treat a repeated `game.your_turn` for the same `(gameId, ply)` as a duplicate.
- Logging is structured (pino) with `x-request-id` propagated or generated and echoed in the response. Nothing external fails silently: every Postgres, Redis or BullMQ error is either returned as `service_unavailable` or logged with context.
- Every task ends with `pnpm lint`, the package's `test` and `typecheck` green, `pnpm format:check` clean, then a commit whose message ends with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy`

## Deviations from the spec, decided in this plan

- An internal route `POST /v1/internal/games`, guarded by the `INTERNAL_API_TOKEN` header secret and disabled when the variable is unset, creates and starts a game between two agents. Matchmaking (Plan 3) is the normal path; this route exists for operators, end-to-end tests and manual smoke runs. It is not part of the public agent protocol.
- `GET /v1/agent/me` returns `{ agent, online, activeGameId }`; the spec lists it without a shape.
- The reconciliation sweep is a safety net the spec does not mention. It exists because events are published after commit without a delivery guarantee (Plan 2a): if a publish fails, the opponent would otherwise wait until timeout.
- Queue routes (`POST`/`DELETE /v1/agent/queue`) are not implemented here; they arrive with matchmaking in Plan 3.

---

## File Structure

```
packages/runtime/src/
  games/repository.ts             + findActiveGameIdForAgent
  events/wire.ts                  + toYourTurn(state, color)
  jobs/deadlines.ts               + DeadlineNotReachedError, deadlineBackoffStrategy, custom backoff default
  games/service.ts                + activeGameFor, yourTurnFor, reconcile
apps/api/
  package.json                    @aichess/api
  src/config.ts                   loadConfig(env): ApiConfig (zod)
  src/errors.ts                   ApiError, STATUS_BY_CODE, toErrorBody
  src/app.ts                      buildApp(deps): FastifyInstance
  src/deps.ts                     createDeps(config) / closeDeps: db, redis, bus, queue, service
  src/plugins/error-handler.ts    error and not-found handlers
  src/plugins/auth.ts             requireAgent, optionalAgent preHandlers, request.agent
  src/plugins/rate-limit.ts       @fastify/rate-limit with Redis store, key by API key prefix or IP
  src/plugins/cors.ts             @fastify/cors for WEB_ORIGIN, GET only
  src/sse/stream.ts               openSse(reply): { send, close, onClose }
  src/sse/agent-streams.ts        AgentStreamRegistry: single stream per agent, presence, hello, ping
  src/sse/game-streams.ts         openGameStream: snapshot first, fan-out, ping
  src/routes/health.ts            GET /health
  src/routes/agent.ts             GET /v1/agent/events, GET /v1/agent/me
  src/routes/games.ts             GET /v1/games/:id, POST move, POST resign, GET stream
  src/routes/internal.ts          POST /v1/internal/games
  src/server.ts                   entrypoint: config, deps, rearm, listen, graceful shutdown
  src/test-utils/sse-client.ts    SSE reader over fetch for tests
  src/test-utils/harness.ts       startHarness(): containers, deps, app listening on port 0, seeded agents with keys
apps/worker/
  package.json                    @aichess/worker
  src/config.ts                   loadConfig(env): WorkerConfig
  src/deadline-worker.ts          createDeadlineWorker(deps): Worker
  src/reconciler.ts               startReconciler(deps): { stop }
  src/health.ts                   startHealthServer(port, checks)
  src/main.ts                     entrypoint with graceful shutdown
```

Each `src/**/x.ts` has a sibling `x.test.ts` unless stated otherwise.

---

### Task 1: Runtime additions: active game lookup, `toYourTurn`, reconcile, custom backoff

**Files:**

- Modify: `packages/runtime/src/games/repository.ts`
- Modify: `packages/runtime/src/events/wire.ts`
- Modify: `packages/runtime/src/jobs/deadlines.ts`
- Modify: `packages/runtime/src/games/service.ts`
- Test: `packages/runtime/src/games/repository.test.ts`, `packages/runtime/src/events/wire.test.ts`, `packages/runtime/src/jobs/deadlines.test.ts`, `packages/runtime/src/games/service.test.ts`

**Interfaces:**

- Consumes: everything from Plan 2a.
- Produces:
  - `findActiveGameIdForAgent(ex: Executor, agentId: string): Promise<string | null>` (most recently started active game where the agent plays either colour).
  - `toYourTurn(state: GameState, color: Color): WireEvent | null` (null unless the game is active, it is `color`'s move and a deadline exists; `attemptsLeft` derived from the state).
  - `class DeadlineNotReachedError extends Error { readonly fireAt: number }` and `deadlineBackoffStrategy(attemptsMade: number, type: string | undefined, error: Error | undefined, now?: () => number): number`. `createDeadlineQueue` now defaults `backoff` to `{ type: "custom" }` and `attempts` to 5.
  - `GameService.activeGameFor(agentId: string): Promise<GameSnapshot | null>`, `GameService.yourTurnFor(agentId: string): Promise<WireEvent | null>`, `GameService.reconcile(input: { staleTurnMs: number }): Promise<{ scanned: number; republished: number; rescheduled: number }>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/src/games/repository.test.ts`, inside `describe("game repository", ...)`:

```ts
it("finds the active game of an agent, if any", async () => {
  const { findActiveGameIdForAgent } = await import("./repository.js");
  expect(await findActiveGameIdForAgent(db, agents.white.id)).toBeNull();
  const created = fresh();
  await insertGame(db, created);
  expect(await findActiveGameIdForAgent(db, agents.white.id)).toBeNull();
  const started = startGame(created, T0);
  await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
  expect(await findActiveGameIdForAgent(db, agents.white.id)).toBe(created.id);
  expect(await findActiveGameIdForAgent(db, agents.black.id)).toBe(created.id);
  expect(await findActiveGameIdForAgent(db, randomUUID())).toBeNull();
});
```

Append to `packages/runtime/src/events/wire.test.ts` a new top-level `describe`:

```ts
describe("toYourTurn", () => {
  it("builds the event for the side to move from the state alone", async () => {
    const { toYourTurn } = await import("./wire.js");
    const started = startGame(created(), T0);
    const bad = applyMove(started.state, { agentId: agents.white.id, ply: 0, move: "Ke2", now: T0 + 1 });
    if (bad.ok || bad.code !== "illegal_move") throw new Error("expected illegal_move");
    const event = toYourTurn(bad.state, "white");
    expect(event).toEqual({
      type: "game.your_turn",
      gameId: bad.state.id,
      ply: 0,
      fen: bad.state.fen,
      history: [],
      lastMove: null,
      legalMoves: expect.arrayContaining([{ san: "e4", uci: "e2e4" }]),
      deadlineAt: new Date(T0 + 60_000).toISOString(),
      attemptsLeft: 2,
    });
    expect(toYourTurn(bad.state, "black")).toBeNull();
  });

  it("returns null for a finished game", async () => {
    const { toYourTurn } = await import("./wire.js");
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    expect(toYourTurn(r.state, "white")).toBeNull();
  });
});
```

Append to `packages/runtime/src/jobs/deadlines.test.ts`, inside `describe("deadline jobs", ...)`:

```ts
it("retries an early job exactly at its fire time and backs off exponentially otherwise", async () => {
  const { DeadlineNotReachedError, deadlineBackoffStrategy } = await import("./deadlines.js");
  const now = (): number => 1_000_000;
  expect(deadlineBackoffStrategy(1, "custom", new DeadlineNotReachedError(1_004_000), now)).toBe(4_000);
  expect(deadlineBackoffStrategy(1, "custom", new DeadlineNotReachedError(999_000), now)).toBe(0);
  expect(deadlineBackoffStrategy(1, "custom", new Error("db down"), now)).toBe(1_000);
  expect(deadlineBackoffStrategy(2, "custom", new Error("db down"), now)).toBe(2_000);
  expect(deadlineBackoffStrategy(10, "custom", undefined, now)).toBe(30_000);
});

it("uses the custom backoff by default", async () => {
  const gameId = randomUUID();
  const now = Date.now();
  await scheduleDeadline(queue, { gameId, ply: 0 }, now + 1_000, now);
  const job = await queue.getJob(deadlineJobId(gameId, 0));
  expect(job?.opts.backoff).toEqual({ type: "custom" });
  expect(job?.opts.attempts).toBe(5);
});
```

Append to `packages/runtime/src/games/service.test.ts`, inside `describe("GameService", ...)`:

```ts
describe("activeGameFor and yourTurnFor", () => {
  it("reports the active game and the pending turn per agent", async () => {
    expect(await service.activeGameFor(agents.white.id)).toBeNull();
    expect(await service.yourTurnFor(agents.white.id)).toBeNull();
    const gameId = await newGame();
    expect((await service.activeGameFor(agents.white.id))?.id).toBe(gameId);
    expect((await service.activeGameFor(agents.white.id))?.legalMoves).toHaveLength(20);
    expect((await service.activeGameFor(agents.black.id))?.legalMoves).toBeUndefined();
    const turn = await service.yourTurnFor(agents.white.id);
    expect(turn).toMatchObject({ type: "game.your_turn", gameId, ply: 0, attemptsLeft: 3 });
    expect(await service.yourTurnFor(agents.black.id)).toBeNull();
  });
});

describe("reconcile", () => {
  it("re-schedules missing deadline jobs and re-publishes stalled turns", async () => {
    const gameId = await newGame();
    const white: WireEvent[] = [];
    const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
    await queue.obliterate({ force: true });

    clock = T0 + 5_000;
    expect(await service.reconcile({ staleTurnMs: 10_000 })).toEqual({ scanned: 1, republished: 0, rescheduled: 1 });
    expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeDefined();

    clock = T0 + 12_000;
    expect(await service.reconcile({ staleTurnMs: 10_000 })).toEqual({ scanned: 1, republished: 1, rescheduled: 0 });
    await waitFor(() => white.some((e) => e.type === "game.your_turn"));
    const turn = white.find((e) => e.type === "game.your_turn");
    expect(turn).toMatchObject({ gameId, ply: 0 });
    await offWhite();
  });

  it("ignores finished games", async () => {
    const gameId = await newGame();
    await service.resign({ gameId, agentId: agents.black.id });
    clock = T0 + 60_000;
    expect(await service.reconcile({ staleTurnMs: 1 })).toEqual({ scanned: 0, republished: 0, rescheduled: 0 });
  });
});
```

- [ ] **Step 2: Run the runtime tests to verify the new ones fail**

Run: `pnpm --filter @aichess/runtime test`
Expected: the new tests fail (`findActiveGameIdForAgent is not a function`, `toYourTurn is not a function`, `deadlineBackoffStrategy is not a function`, `service.activeGameFor is not a function`, `opts.backoff` mismatch); all Plan 2a tests still pass.

- [ ] **Step 3: Add the repository lookup**

In `packages/runtime/src/games/repository.ts`, change the drizzle import to:

```ts
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
```

and append:

```ts
export async function findActiveGameIdForAgent(ex: Executor, agentId: string): Promise<string | null> {
  const [row] = await ex
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.status, "active"), or(eq(games.whiteAgentId, agentId), eq(games.blackAgentId, agentId))))
    .orderBy(desc(games.startedAt))
    .limit(1);
  return row?.id ?? null;
}
```

- [ ] **Step 4: Add `toYourTurn` to the wire mapping**

In `packages/runtime/src/events/wire.ts`, replace the private `yourTurnEvent` function with:

```ts
function buildYourTurn(state: GameState, ply: number, deadlineAt: number, attempts: number): WireEvent {
  const last = state.moves[state.moves.length - 1];
  return {
    type: "game.your_turn",
    gameId: state.id,
    ply,
    fen: state.fen,
    history: state.moves.map((m) => m.san),
    lastMove: last === undefined ? null : { san: last.san, uci: last.uci },
    legalMoves: legalMoves(state.fen),
    deadlineAt: iso(deadlineAt),
    attemptsLeft: attempts,
  };
}

function yourTurnEvent(state: GameState, event: Extract<DomainEvent, { type: "turn" }>): WireEvent {
  return buildYourTurn(state, event.ply, event.deadlineAt, event.attemptsLeft);
}

export function toYourTurn(state: GameState, color: Color): WireEvent | null {
  if (state.status !== "active" || state.moveDeadlineAt === null) return null;
  if (sideToMove(state) !== color) return null;
  return buildYourTurn(state, state.ply, state.moveDeadlineAt, attemptsLeft(state));
}
```

- [ ] **Step 5: Add the backoff strategy and change the queue defaults**

In `packages/runtime/src/jobs/deadlines.ts`, replace `createDeadlineQueue` and append the error and strategy:

```ts
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function createDeadlineQueue(connection: Redis): DeadlineQueue {
  return new Queue<DeadlineJobData>(DEADLINES_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: MAX_ATTEMPTS,
      backoff: { type: "custom" },
    },
  });
}

export class DeadlineNotReachedError extends Error {
  readonly fireAt: number;

  constructor(fireAt: number) {
    super(`deadline not reached, fire at ${new Date(fireAt).toISOString()}`);
    this.name = "DeadlineNotReachedError";
    this.fireAt = fireAt;
  }
}

export function deadlineBackoffStrategy(
  attemptsMade: number,
  _type: string | undefined,
  error: Error | undefined,
  now: () => number = (): number => Date.now(),
): number {
  if (error instanceof DeadlineNotReachedError) {
    return Math.max(0, error.fireAt - now());
  }
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptsMade - 1));
}
```

- [ ] **Step 6: Add the service methods**

In `packages/runtime/src/games/service.ts`:

Change the imports:

```ts
import { sideToMove, ... } from "@aichess/core";   // add sideToMove to the existing core import
import type { GameConfig, GameSnapshot, IllegalReason, LegalMove, WireEvent } from "@aichess/core/protocol";
import { toSnapshot, toWireEvents, toYourTurn, type GameAgents } from "../events/wire.js";
import { deadlineFireAt, deadlineJobId, scheduleDeadline, type DeadlineQueue } from "../jobs/deadlines.js";
import { findActiveGameIdForAgent, insertGame, ... } from "./repository.js";   // add findActiveGameIdForAgent
```

Add the interface and the methods inside the class, after `rearmActiveDeadlines`:

```ts
  async activeGameFor(agentId: string): Promise<GameSnapshot | null> {
    const gameId = await findActiveGameIdForAgent(this.deps.db, agentId);
    if (gameId === null) return null;
    return this.getSnapshot(gameId, agentId);
  }

  async yourTurnFor(agentId: string): Promise<WireEvent | null> {
    const gameId = await findActiveGameIdForAgent(this.deps.db, agentId);
    if (gameId === null) return null;
    const state = await loadGame(this.deps.db, gameId);
    if (state === null) return null;
    const color = state.whiteAgentId === agentId ? "white" : "black";
    return toYourTurn(state, color);
  }

  async reconcile(input: ReconcileInput): Promise<ReconcileReport> {
    const rows = await listActiveDeadlines(this.deps.db);
    const now = this.now();
    const report: ReconcileReport = { scanned: rows.length, republished: 0, rescheduled: 0 };
    for (const row of rows) {
      const job = await this.deps.deadlines.getJob(deadlineJobId(row.gameId, row.ply));
      if (job === undefined) {
        await scheduleDeadline(this.deps.deadlines, { gameId: row.gameId, ply: row.ply }, row.moveDeadlineAt, now);
        report.rescheduled += 1;
      }
      const state = await loadGame(this.deps.db, row.gameId);
      if (state === null || state.status !== "active" || state.turnStartedAt === null) continue;
      if (now - state.turnStartedAt < input.staleTurnMs) continue;
      const color = sideToMove(state);
      const event = toYourTurn(state, color);
      if (event === null) continue;
      const outgoing: Outgoing = { toWhite: [], toBlack: [], toPublic: [] };
      (color === "white" ? outgoing.toWhite : outgoing.toBlack).push(event);
      try {
        await this.deps.bus.publish(partiesOf(state), outgoing);
        report.republished += 1;
      } catch (error) {
        this.deps.logger.error({ gameId: state.id, error }, "reconcile_publish_failed");
      }
    }
    if (report.republished > 0 || report.rescheduled > 0) {
      this.deps.logger.info({ ...report }, "reconcile applied");
    }
    return report;
  }
```

with, near the other exported types:

```ts
export interface ReconcileInput {
  staleTurnMs: number;
}

export interface ReconcileReport {
  scanned: number;
  republished: number;
  rescheduled: number;
}
```

and `Outgoing` added to the import from `../events/wire.js`.

- [ ] **Step 7: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm lint && pnpm build && pnpm --filter @aichess/runtime typecheck && pnpm format:check`
Expected: 43 + 7 runtime tests pass; everything else green.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): active game lookup, toYourTurn, reconcile sweep, custom deadline backoff"
```

---

### Task 2: `@aichess/api` scaffold: config, errors, app, health

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/errors.ts`
- Create: `apps/api/src/plugins/error-handler.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/deps.ts`
- Create: `apps/api/src/test-utils/harness.ts`
- Test: `apps/api/src/config.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `createDb`, `Database` from `@aichess/db`; `EventBus`, `createRedis`, `createDeadlineQueue`, `GameService`, `DeadlineQueue`, `RuntimeLogger` from `@aichess/runtime`; `startTestDatabase`, `startTestRedis`, `seedTwoAgents` from the testing entry points.
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig` with fields `DATABASE_URL`, `REDIS_URL`, `API_PORT` (3001), `API_HOST` ("0.0.0.0"), `WEB_ORIGIN` (optional), `INTERNAL_API_TOKEN` (optional), `DEFAULT_TIME_PER_MOVE_MS` (60000), `MOVE_LIMIT_PLIES` (300), `ILLEGAL_ATTEMPTS_PER_TURN` (3), `RATE_LIMIT_AGENT_PER_MINUTE` (120), `RATE_LIMIT_PUBLIC_PER_MINUTE` (300), `SSE_PING_INTERVAL_MS` (15000), `PRESENCE_TTL_SECONDS` (30), `LOG_LEVEL` ("info"), `TRUST_PROXY` (false). Throws `ConfigError` listing every invalid variable.
  - `class ApiError extends Error { code: ErrorCode; details?: Record<string, unknown> }`, `STATUS_BY_CODE: Record<ErrorCode, number>`, `toErrorBody(error: ApiError): ErrorResponse`.
  - `interface AppDeps { config: ApiConfig; db: Database; redis: Redis; bus: EventBus; deadlines: DeadlineQueue; service: GameService }`
  - `buildApp(deps: AppDeps): FastifyInstance` (routes registered, not yet listening).
  - `createDeps(config: ApiConfig, logger: RuntimeLogger): Promise<{ deps: AppDeps; close: () => Promise<void> }>`.
  - `startHarness(): Promise<Harness>` for tests: containers, deps, `app` (built and ready), `agents` (seeded, with plaintext API keys), `config`, `stop()`. Listening on a port is added in Task 6.

- [ ] **Step 1: Create the package files**

`apps/api/package.json`:

```json
{
  "name": "@aichess/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "start": "node dist/server.js",
    "dev": "pnpm build && node --env-file=../../.env dist/server.js"
  },
  "dependencies": {
    "@aichess/core": "workspace:*",
    "@aichess/db": "workspace:*",
    "@aichess/runtime": "workspace:*",
    "@fastify/cors": "^11.3.0",
    "@fastify/rate-limit": "^11.2.0",
    "bullmq": "^6.3.0",
    "drizzle-orm": "^0.45.0",
    "fastify": "^5.12.0",
    "ioredis": "^5.6.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/test-utils/**"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));
const core = pkg("core");
const db = pkg("db");
const runtime = pkg("runtime");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${core}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${core}/protocol/index.ts` },
      { find: /^@aichess\/db$/, replacement: `${db}/index.ts` },
      { find: /^@aichess\/db\/testing$/, replacement: `${db}/testing.ts` },
      { find: /^@aichess\/runtime$/, replacement: `${runtime}/index.ts` },
      { find: /^@aichess\/runtime\/testing$/, replacement: `${runtime}/testing.ts` },
    ],
  },
});
```

Run: `pnpm install`
Expected: workspace links and Fastify installed.

- [ ] **Step 2: Write the failing tests**

`apps/api/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      API_PORT: 3001,
      API_HOST: "0.0.0.0",
      DEFAULT_TIME_PER_MOVE_MS: 60_000,
      MOVE_LIMIT_PLIES: 300,
      ILLEGAL_ATTEMPTS_PER_TURN: 3,
      RATE_LIMIT_AGENT_PER_MINUTE: 120,
      RATE_LIMIT_PUBLIC_PER_MINUTE: 300,
      SSE_PING_INTERVAL_MS: 15_000,
      PRESENCE_TTL_SECONDS: 30,
      LOG_LEVEL: "info",
      TRUST_PROXY: false,
    });
    expect(config.WEB_ORIGIN).toBeUndefined();
    expect(config.INTERNAL_API_TOKEN).toBeUndefined();
  });

  it("coerces numbers and booleans from strings", () => {
    const config = loadConfig({ ...base, API_PORT: "8080", TRUST_PROXY: "true", SSE_PING_INTERVAL_MS: "5000" });
    expect(config.API_PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.SSE_PING_INTERVAL_MS).toBe(5_000);
  });

  it("names every invalid variable", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://x", API_PORT: "abc" })).toThrow(ConfigError);
    try {
      loadConfig({ REDIS_URL: "redis://x", API_PORT: "abc" });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("API_PORT");
    }
  });

  it("rejects an internal token that is too short", () => {
    expect(() => loadConfig({ ...base, INTERNAL_API_TOKEN: "short" })).toThrow(/INTERNAL_API_TOKEN/);
  });
});
```

`apps/api/src/app.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { startHarness, type Harness } from "./test-utils/harness.js";

describe("app basics", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      register: (app) => {
        app.get("/__boom", async () => {
          throw new Error("kaboom");
        });
        app.get("/__api-error", async () => {
          throw new ApiError("in_active_game", "Busy", { gameId: "g1" });
        });
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("reports health with both checks", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
  });

  it("answers unknown routes with the standard body", async () => {
    const res = await h.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "Route not found" });
  });

  it("maps ApiError to its status and body", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__api-error" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "in_active_game", message: "Busy", details: { gameId: "g1" } });
  });

  it("hides unexpected errors behind internal_error with the request id", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__boom", headers: { "x-request-id": "req-42" } });
    expect(res.statusCode).toBe(500);
    expect(res.headers["x-request-id"]).toBe("req-42");
    expect(res.json()).toEqual({
      error: "internal_error",
      message: "Internal error",
      details: { requestId: "req-42" },
    });
  });

  it("turns malformed JSON into validation_error", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/__api-error",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test`
Expected: FAIL, cannot resolve `./config.js` and `./test-utils/harness.js`.

- [ ] **Step 4: Write config and errors**

`apps/api/src/config.ts`:

```ts
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.trim().toLowerCase() === "true" || v.trim() === "1"));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.url().optional(),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  DEFAULT_TIME_PER_MOVE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MOVE_LIMIT_PLIES: z.coerce.number().int().min(2).max(2_000).default(300),
  ILLEGAL_ATTEMPTS_PER_TURN: z.coerce.number().int().min(1).max(10).default(3),
  RATE_LIMIT_AGENT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SSE_PING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().min(5).default(30),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  TRUST_PROXY: BooleanFromString.default(false),
});

export type ApiConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
}
```

`apps/api/src/errors.ts`:

```ts
import type { ErrorCode, ErrorResponse } from "@aichess/core/protocol";

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  agent_suspended: 403,
  not_found: 404,
  validation_error: 400,
  not_your_turn: 409,
  stale_ply: 409,
  game_not_active: 409,
  illegal_move: 422,
  already_in_queue: 409,
  not_in_queue: 409,
  in_active_game: 409,
  rate_limited: 429,
  service_unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function toErrorBody(error: ApiError): ErrorResponse {
  return error.details === undefined
    ? { error: error.code, message: error.message }
    : { error: error.code, message: error.message, details: error.details };
}
```

- [ ] **Step 5: Write the error handler, the health route, deps and the app**

`apps/api/src/plugins/error-handler.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { ApiError, toErrorBody } from "../errors.js";

interface HttpLikeError {
  statusCode?: number;
  code?: string;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "not_found", message: "Route not found" });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send(toErrorBody(error));
      return;
    }
    const http = error as HttpLikeError;
    if (http.statusCode === 429) {
      reply.status(429).send({ error: "rate_limited", message: "Too many requests" });
      return;
    }
    if (http.statusCode !== undefined && http.statusCode >= 400 && http.statusCode < 500) {
      reply.status(400).send({ error: "validation_error", message: "Malformed request" });
      return;
    }
    request.log.error({ err: error }, "unhandled error");
    reply.status(500).send({ error: "internal_error", message: "Internal error", details: { requestId: request.id } });
  });
}
```

`apps/api/src/routes/health.ts`:

```ts
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

type CheckResult = "ok" | "fail";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", { config: { rateLimit: false } }, async (request, reply) => {
    const [postgres, redis] = await Promise.allSettled([deps.db.execute(sql`select 1`), deps.redis.ping()]);
    const checks: Record<"postgres" | "redis", CheckResult> = {
      postgres: postgres.status === "fulfilled" ? "ok" : "fail",
      redis: redis.status === "fulfilled" ? "ok" : "fail",
    };
    const healthy = checks.postgres === "ok" && checks.redis === "ok";
    if (!healthy) {
      request.log.warn({ checks }, "health check degraded");
    }
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? "ok" : "degraded", checks });
  });
}
```

`apps/api/src/deps.ts`:

```ts
import { createDb, type Database } from "@aichess/db";
import {
  EventBus,
  GameService,
  createDeadlineQueue,
  createRedis,
  type DeadlineQueue,
  type RuntimeLogger,
} from "@aichess/runtime";
import type { Redis } from "ioredis";
import type { ApiConfig } from "./config.js";

export interface AppDeps {
  config: ApiConfig;
  db: Database;
  redis: Redis;
  bus: EventBus;
  deadlines: DeadlineQueue;
  service: GameService;
}

export interface DepsHandle {
  deps: AppDeps;
  close: () => Promise<void>;
}

export async function createDeps(config: ApiConfig, logger: RuntimeLogger): Promise<DepsHandle> {
  const dbHandle = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  await redis.connect();
  const queueConnection = createRedis(config.REDIS_URL);
  await queueConnection.connect();
  const bus = await EventBus.connect(config.REDIS_URL, logger);
  const deadlines = createDeadlineQueue(queueConnection);
  const service = new GameService({
    db: dbHandle.db,
    bus,
    deadlines,
    logger,
    config: {
      timePerMoveMs: config.DEFAULT_TIME_PER_MOVE_MS,
      moveLimitPlies: config.MOVE_LIMIT_PLIES,
      illegalAttemptsPerTurn: config.ILLEGAL_ATTEMPTS_PER_TURN,
    },
  });
  return {
    deps: { config, db: dbHandle.db, redis, bus, deadlines, service },
    close: async () => {
      await deadlines.close();
      await queueConnection.quit();
      await bus.close();
      await redis.quit();
      await dbHandle.close();
    },
  };
}
```

`apps/api/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";

export type { AppDeps } from "./deps.js";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: deps.config.TRUST_PROXY,
  });
  registerErrorHandling(app);
  registerHealthRoutes(app, deps);
  return app;
}
```

`apps/api/src/test-utils/harness.ts`:

```ts
import { generateApiKey } from "@aichess/core";
import { agents, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { noopLogger, type GameAgents } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig, type ApiConfig } from "../config.js";
import { createDeps, type AppDeps } from "../deps.js";

export interface SeededAgent {
  id: string;
  name: string;
  slug: string;
  key: string;
}

export interface Harness {
  app: FastifyInstance;
  config: ApiConfig;
  deps: AppDeps;
  db: Database;
  agents: { white: SeededAgent; black: SeededAgent };
  reseed: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  register?: (app: FastifyInstance) => void;
}

async function seedWithKeys(db: Database): Promise<Harness["agents"]> {
  const seeded: GameAgents = await seedTwoAgents(db);
  const withKey = async (summary: GameAgents["white"]): Promise<SeededAgent> => {
    const generated = generateApiKey();
    await db
      .update(agents)
      .set({ apiKeyPrefix: generated.prefix, apiKeyHash: generated.hash })
      .where(eq(agents.id, summary.id));
    return { id: summary.id, name: summary.name, slug: summary.slug, key: generated.key };
  };
  return { white: await withKey(seeded.white), black: await withKey(seeded.black) };
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const tdb: TestDatabase = await startTestDatabase();
  const redis: TestRedis = await startTestRedis();
  const config = loadConfig({
    DATABASE_URL: tdb.url,
    REDIS_URL: redis.url,
    LOG_LEVEL: "silent",
    SSE_PING_INTERVAL_MS: "1000",
    PRESENCE_TTL_SECONDS: "5",
    ...options.env,
  });
  const handle = await createDeps(config, noopLogger);
  const app = buildApp(handle.deps);
  options.register?.(app);
  await app.ready();
  const harness: Harness = {
    app,
    config,
    deps: handle.deps,
    db: handle.deps.db,
    agents: await seedWithKeys(handle.deps.db),
    reseed: async () => {
      await truncateAll(handle.deps.db);
      await handle.deps.deadlines.obliterate({ force: true });
      harness.agents = await seedWithKeys(handle.deps.db);
    },
    stop: async () => {
      await app.close();
      await handle.close();
      await redis.stop();
      await tdb.stop();
    },
  };
  return harness;
}
```

- [ ] **Step 6: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: 4 config tests and 5 app tests pass. If `deps.db.execute` is not a function in the health route, the `Database` type import came from the wrong package.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): fastify scaffold with config, error handling and health"
```

---

### Task 3: Bearer authentication and connectivity errors

**Files:**

- Create: `apps/api/src/plugins/auth.ts`
- Modify: `apps/api/src/plugins/error-handler.ts` (503 for connectivity errors)
- Modify: `apps/api/src/app.ts` (register auth decoration)
- Test: `apps/api/src/plugins/auth.test.ts`

**Interfaces:**

- Consumes: `hashApiKey`, `keysMatch`, `splitApiKey` from `@aichess/core`; `agents` table from `@aichess/db`; `ApiError`; `AppDeps`.
- Produces:
  - `interface AuthenticatedAgent { id: string; ownerId: string; name: string; slug: string; modelProvider: string; modelName: string; status: AgentStatus }`
  - Fastify request decoration `request.agent: AuthenticatedAgent | null`.
  - `registerAuth(app: FastifyInstance): void` (decorates the request).
  - `requireAgent(deps: AppDeps): preHandlerAsyncHookHandler` (401 without a valid key, 403 if suspended).
  - `optionalAgent(deps: AppDeps): preHandlerAsyncHookHandler` (no header leaves `request.agent` null; an invalid header is still 401).
  - `assertAgent(request: FastifyRequest): AuthenticatedAgent` (throws `unauthorized` if null; used after `requireAgent` to narrow the type).
  - `isConnectivityError(error: unknown): boolean` in the error handler: Postgres SQLSTATE classes `08` and `57P`, Node `ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`, ioredis `MaxRetriesPerRequestError`; these become 503 `service_unavailable`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/plugins/auth.test.ts`:

```ts
import { agents } from "@aichess/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";
import { assertAgent, optionalAgent, requireAgent } from "./auth.js";

describe("bearer authentication", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      register: (app, deps) => {
        app.get("/__whoami", { preHandler: requireAgent(deps) }, async (request) => ({ id: assertAgent(request).id }));
        app.get("/__maybe", { preHandler: optionalAgent(deps) }, async (request) => ({
          agent: request.agent?.id ?? null,
        }));
        app.get("/__db-down", async () => {
          throw Object.assign(new Error("Failed query"), { cause: { code: "57P01" } });
        });
        app.get("/__redis-down", async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        });
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("rejects a missing header", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__whoami" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized", message: "Missing Authorization header" });
  });

  it("rejects a malformed header and an unknown key", async () => {
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: "Token abc" } })).statusCode,
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
    const almost = `${h.agents.white.key.slice(0, -1)}x`;
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: `Bearer ${almost}` } }))
        .statusCode,
    ).toBe(401);
  });

  it("resolves a valid key to its agent", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/__whoami",
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: h.agents.white.id });
  });

  it("refuses a suspended agent with 403", async () => {
    await h.db
      .update(agents)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(agents.id, h.agents.black.id));
    const res = await h.app.inject({
      method: "GET",
      url: "/__whoami",
      headers: { authorization: `Bearer ${h.agents.black.key}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("agent_suspended");
    await h.db.update(agents).set({ status: "active", suspendedReason: null }).where(eq(agents.id, h.agents.black.id));
  });

  it("treats the header as optional where allowed but still validates it", async () => {
    expect((await h.app.inject({ method: "GET", url: "/__maybe" })).json()).toEqual({ agent: null });
    const withKey = await h.app.inject({
      method: "GET",
      url: "/__maybe",
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    expect(withKey.json()).toEqual({ agent: h.agents.white.id });
    expect(
      (await h.app.inject({ method: "GET", url: "/__maybe", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
  });

  it("maps connectivity failures to 503", async () => {
    const db = await h.app.inject({ method: "GET", url: "/__db-down" });
    expect(db.statusCode).toBe(503);
    expect(db.json().error).toBe("service_unavailable");
    const redis = await h.app.inject({ method: "GET", url: "/__redis-down" });
    expect(redis.statusCode).toBe(503);
  });
});
```

The harness `register` callback now receives `(app, deps)`. Update `apps/api/src/test-utils/harness.ts`: change `register?: (app: FastifyInstance) => void` to `register?: (app: FastifyInstance, deps: AppDeps) => void` and the call to `options.register?.(app, handle.deps)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test -- auth`
Expected: FAIL, cannot resolve `./auth.js`.

- [ ] **Step 3: Write the auth plugin**

`apps/api/src/plugins/auth.ts`:

```ts
import { hashApiKey, keysMatch, splitApiKey } from "@aichess/core";
import type { AgentStatus } from "@aichess/core/protocol";
import { agents } from "@aichess/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";

export interface AuthenticatedAgent {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  modelProvider: string;
  modelName: string;
  status: AgentStatus;
}

declare module "fastify" {
  interface FastifyRequest {
    agent: AuthenticatedAgent | null;
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("agent", null);
}

function bearerToken(header: string | undefined): string | null | undefined {
  if (header === undefined) return undefined;
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme === undefined || scheme.toLowerCase() !== "bearer" || token === undefined || rest.length > 0) return null;
  return token;
}

async function resolveAgent(deps: AppDeps, request: FastifyRequest): Promise<AuthenticatedAgent | null> {
  const token = bearerToken(request.headers.authorization);
  if (token === undefined) return null;
  if (token === null) throw new ApiError("unauthorized", "Malformed Authorization header");
  const parts = splitApiKey(token);
  if (parts === null) throw new ApiError("unauthorized", "Invalid API key");

  const candidates = await deps.db
    .select({
      id: agents.id,
      ownerId: agents.ownerId,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      status: agents.status,
      apiKeyHash: agents.apiKeyHash,
    })
    .from(agents)
    .where(eq(agents.apiKeyPrefix, parts.prefix));

  const provided = hashApiKey(token);
  const match = candidates.find((row) => keysMatch(provided, row.apiKeyHash));
  if (match === undefined) throw new ApiError("unauthorized", "Invalid API key");
  if (match.status === "suspended") throw new ApiError("agent_suspended", "Agent is suspended");
  return {
    id: match.id,
    ownerId: match.ownerId,
    name: match.name,
    slug: match.slug,
    modelProvider: match.modelProvider,
    modelName: match.modelName,
    status: match.status,
  };
}

export function requireAgent(deps: AppDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    const agent = await resolveAgent(deps, request);
    if (agent === null) throw new ApiError("unauthorized", "Missing Authorization header");
    request.agent = agent;
  };
}

export function optionalAgent(deps: AppDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    request.agent = await resolveAgent(deps, request);
  };
}

export function assertAgent(request: FastifyRequest): AuthenticatedAgent {
  if (request.agent === null) throw new ApiError("unauthorized", "Missing Authorization header");
  return request.agent;
}
```

- [ ] **Step 4: Add connectivity detection to the error handler**

In `apps/api/src/plugins/error-handler.ts`, add above `registerErrorHandling`:

```ts
const NODE_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND"]);

function codeOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isConnectivityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === "MaxRetriesPerRequestError") return true;
  for (const code of [codeOf(error), codeOf((error as { cause?: unknown }).cause)]) {
    if (code === undefined) continue;
    if (NODE_NETWORK_CODES.has(code)) return true;
    if (code.startsWith("08") || code.startsWith("57P")) return true;
  }
  return false;
}
```

and in `setErrorHandler`, right after the `ApiError` branch:

```ts
if (isConnectivityError(error)) {
  request.log.error({ err: error }, "dependency unavailable");
  reply.status(503).send({ error: "service_unavailable", message: "A dependency is unavailable" });
  return;
}
```

In `apps/api/src/app.ts`, import `registerAuth` from `./plugins/auth.js` and call `registerAuth(app);` right after `registerErrorHandling(app);`.

- [ ] **Step 5: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): bearer authentication and 503 for connectivity errors"
```

---

### Task 4: Rate limiting and CORS

**Files:**

- Create: `apps/api/src/plugins/rate-limit.ts`
- Create: `apps/api/src/plugins/cors.ts`
- Modify: `apps/api/src/app.ts` (`buildApp` becomes async, registers both)
- Modify: `apps/api/src/plugins/error-handler.ts` (429 body with retry details)
- Modify: `apps/api/src/test-utils/harness.ts` (await `buildApp`)
- Test: `apps/api/src/plugins/rate-limit.test.ts`, `apps/api/src/plugins/cors.test.ts`

**Interfaces:**

- Consumes: `@fastify/rate-limit`, `@fastify/cors`, `splitApiKey`, `AppDeps`.
- Produces:
  - `registerRateLimit(app: FastifyInstance, deps: AppDeps): Promise<void>` (global limit `RATE_LIMIT_PUBLIC_PER_MINUTE`, key `key:{prefix}` when a well-formed bearer key is present, else `ip:{ip}`; Redis store namespace `ratelimit:`).
  - `agentRateLimit(deps: AppDeps): { rateLimit: { max: number; timeWindow: string } }` route config for agent routes (`RATE_LIMIT_AGENT_PER_MINUTE`).
  - `registerCors(app: FastifyInstance, deps: AppDeps): Promise<void>` (no-op without `WEB_ORIGIN`).
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`.
- 429 responses: status 429, `Retry-After` header in seconds, body `{ error: "rate_limited", message, details: { retryAfterMs } }`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/plugins/rate-limit.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";
import { requireAgent } from "./auth.js";
import { agentRateLimit } from "./rate-limit.js";

describe("rate limiting", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      env: { RATE_LIMIT_PUBLIC_PER_MINUTE: "3", RATE_LIMIT_AGENT_PER_MINUTE: "2" },
      register: (app, deps) => {
        app.get("/__public", async () => ({ ok: true }));
        app.get("/__agent", { preHandler: requireAgent(deps), config: agentRateLimit(deps) }, async () => ({
          ok: true,
        }));
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("limits anonymous callers per IP with the standard body", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    }
    const blocked = await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.1" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.json()).toMatchObject({ error: "rate_limited", details: { retryAfterMs: expect.any(Number) } });
    expect((await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.2" })).statusCode).toBe(200);
  });

  it("limits agents per API key on agent routes", async () => {
    const headers = { authorization: `Bearer ${h.agents.white.key}` };
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.3" })).statusCode,
    ).toBe(200);
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.4" })).statusCode,
    ).toBe(200);
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.5" })).statusCode,
    ).toBe(429);
    const other = { authorization: `Bearer ${h.agents.black.key}` };
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers: other, remoteAddress: "10.0.0.5" })).statusCode,
    ).toBe(200);
  });

  it("never limits the health check", async () => {
    for (let i = 0; i < 6; i += 1) {
      expect((await h.app.inject({ method: "GET", url: "/health", remoteAddress: "10.0.0.9" })).statusCode).toBe(200);
    }
  });
});
```

`apps/api/src/plugins/cors.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("cors", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { WEB_ORIGIN: "http://localhost:3000" } });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("allows the configured web origin for GET", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:3000" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("does not allow other origins", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health", headers: { origin: "http://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers preflight with GET only", async () => {
    const res = await h.app.inject({
      method: "OPTIONS",
      url: "/v1/games/x",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-methods"]).toBe("GET");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test -- plugins`
Expected: FAIL, cannot resolve `./rate-limit.js`; the cors test fails on missing headers.

- [ ] **Step 3: Write the plugins**

`apps/api/src/plugins/rate-limit.ts`:

```ts
import { splitApiKey } from "@aichess/core";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";

const WINDOW = "1 minute";

function keyFor(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header !== undefined) {
    const token = header.trim().split(/\s+/)[1];
    const parts = token === undefined ? null : splitApiKey(token);
    if (parts !== null) return `key:${parts.prefix}`;
  }
  return `ip:${request.ip}`;
}

export async function registerRateLimit(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: deps.config.RATE_LIMIT_PUBLIC_PER_MINUTE,
    timeWindow: WINDOW,
    redis: deps.redis,
    nameSpace: "ratelimit:",
    keyGenerator: keyFor,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "rate_limited",
      message: `Too many requests, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
      details: { limit: context.max, retryAfterMs: context.ttl },
    }),
  });
}

export function agentRateLimit(deps: AppDeps): { rateLimit: { max: number; timeWindow: string } } {
  return { rateLimit: { max: deps.config.RATE_LIMIT_AGENT_PER_MINUTE, timeWindow: WINDOW } };
}
```

`apps/api/src/plugins/cors.ts`:

```ts
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export async function registerCors(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const origin = deps.config.WEB_ORIGIN;
  if (origin === undefined) return;
  await app.register(cors, { origin, methods: ["GET"], credentials: false });
}
```

In `apps/api/src/plugins/error-handler.ts`, replace the 429 branch with:

```ts
if (http.statusCode === 429) {
  const body = error as { message?: string; details?: Record<string, unknown> };
  reply.status(429).send({
    error: "rate_limited",
    message: body.message ?? "Too many requests",
    ...(body.details === undefined ? {} : { details: body.details }),
  });
  return;
}
```

The plugin throws the object returned by `errorResponseBuilder` as the error, with `statusCode` 429 and the `retry-after` header already set on the reply.

Replace `apps/api/src/app.ts` with:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerAuth } from "./plugins/auth.js";
import { registerCors } from "./plugins/cors.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerHealthRoutes } from "./routes/health.js";

export type { AppDeps } from "./deps.js";

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: deps.config.TRUST_PROXY,
  });
  registerErrorHandling(app);
  await registerRateLimit(app, deps);
  await registerCors(app, deps);
  registerAuth(app);
  registerHealthRoutes(app, deps);
  return app;
}
```

In `apps/api/src/test-utils/harness.ts` change `const app = buildApp(handle.deps);` to `const app = await buildApp(handle.deps);`.

- [ ] **Step 4: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass. If the anonymous limit test sees 200 on the fourth call, `remoteAddress` is not reaching the key generator: check that `trustProxy` is false in the harness and that `keyFor` uses `request.ip`.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): redis-backed rate limiting and CORS for the web origin"
```

---

### Task 5: Game routes and the internal create route

**Files:**

- Create: `apps/api/src/validation.ts`
- Create: `apps/api/src/routes/games.ts`
- Create: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/app.ts` (register both)
- Modify: `apps/api/src/test-utils/harness.ts` (`seedAgent`, default internal token)
- Test: `apps/api/src/routes/games.test.ts`

**Interfaces:**

- Consumes: `MoveRequestSchema` from `@aichess/core/protocol`; `keysMatch` from `@aichess/core`; `GameService` results; auth and rate-limit helpers.
- Produces:
  - `parseWith<T>(schema: z.ZodType<T>, value: unknown, where: "params" | "query" | "body"): T` throwing `validation_error` with `details.issues`.
  - Routes: `GET /v1/games/:id` (optional auth), `POST /v1/games/:id/move` (agent, agent limit), `POST /v1/games/:id/resign` (agent, agent limit), `POST /v1/internal/games` (internal token; 201 with the snapshot).
  - `harness.seedAgent(): Promise<SeededAgent>` for a third agent; the harness sets `INTERNAL_API_TOKEN` to a fixed 48-character test value exported as `TEST_INTERNAL_TOKEN`.
- Result mapping in routes: `not_found` 404 "Game not found", `game_not_active` 409 "Game is not active", `not_your_turn` 409 "Not your turn", `stale_ply` 409 "Ply does not match the current position", `illegal_move` 422 with `details: { reason, attemptsLeft, legalMoves }`.

- [ ] **Step 1: Extend the harness**

In `apps/api/src/test-utils/harness.ts`:

- export `export const TEST_INTERNAL_TOKEN = "test-internal-token-0123456789abcdef0123456789abcdef";`
- add `INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,` to the `loadConfig` call, before `...options.env`.
- add to the `Harness` interface: `seedAgent: () => Promise<SeededAgent>;`
- implement in the returned object:

```ts
    seedAgent: async () => {
      const extra = await seedTwoAgents(handle.deps.db);
      const generated = generateApiKey();
      await handle.deps.db
        .update(agents)
        .set({ apiKeyPrefix: generated.prefix, apiKeyHash: generated.hash })
        .where(eq(agents.id, extra.white.id));
      return { id: extra.white.id, name: extra.white.name, slug: extra.white.slug, key: generated.key };
    },
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/routes/games.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_INTERNAL_TOKEN, startHarness, type Harness } from "../test-utils/harness.js";

describe("game routes", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  const auth = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

  async function createGame(timePerMoveMs?: number): Promise<string> {
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/internal/games",
      headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
      payload: { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id, timePerMoveMs },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  describe("POST /v1/internal/games", () => {
    it("creates and starts a game", async () => {
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id, timePerMoveMs: 5000 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: "active", ply: 0, turn: "white", config: { timePerMoveMs: 5000 } });
    });

    it("rejects a missing or wrong token", async () => {
      const body = { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id };
      expect((await h.app.inject({ method: "POST", url: "/v1/internal/games", payload: body })).statusCode).toBe(401);
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/v1/internal/games",
            headers: { "x-internal-token": "wrong" },
            payload: body,
          })
        ).statusCode,
      ).toBe(401);
    });

    it("validates the body and the agents", async () => {
      const bad = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: "nope" },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ error: "validation_error", details: { where: "body" } });
      const missing = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: h.agents.white.id, blackAgentId: randomUUID() },
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe("GET /v1/games/:id", () => {
    it("returns legal moves only to the agent on move", async () => {
      const id = await createGame();
      const white = await h.app.inject({ method: "GET", url: `/v1/games/${id}`, headers: auth(h.agents.white.key) });
      expect(white.statusCode).toBe(200);
      expect(white.json().legalMoves).toHaveLength(20);
      expect(white.json().attemptsLeft).toBe(3);
      const black = await h.app.inject({ method: "GET", url: `/v1/games/${id}`, headers: auth(h.agents.black.key) });
      expect(black.json().legalMoves).toBeUndefined();
      const anon = await h.app.inject({ method: "GET", url: `/v1/games/${id}` });
      expect(anon.statusCode).toBe(200);
      expect(anon.json().legalMoves).toBeUndefined();
    });

    it("validates the id and reports unknown games", async () => {
      expect((await h.app.inject({ method: "GET", url: "/v1/games/not-a-uuid" })).statusCode).toBe(400);
      expect((await h.app.inject({ method: "GET", url: `/v1/games/${randomUUID()}` })).statusCode).toBe(404);
    });
  });

  describe("POST /v1/games/:id/move", () => {
    it("plays a legal move", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 0, move: "e4", comment: "Centre." },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ply: 1, turn: "black", history: ["e4"] });
    });

    it("rejects an illegal move with 422 and the legal moves", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 0, move: "Nf6" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: "illegal_move",
        details: { reason: "not_legal", attemptsLeft: 2 },
      });
      expect(res.json().details.legalMoves).toHaveLength(20);
    });

    it("maps turn, ply and membership failures", async () => {
      const id = await createGame();
      const wrongTurn = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.black.key),
        payload: { ply: 0, move: "e5" },
      });
      expect(wrongTurn.statusCode).toBe(409);
      expect(wrongTurn.json().error).toBe("not_your_turn");
      const stale = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 3, move: "e4" },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe("stale_ply");
      const stranger = await h.seedAgent();
      const outsider = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(stranger.key),
        payload: { ply: 0, move: "e4" },
      });
      expect(outsider.statusCode).toBe(404);
    });

    it("validates the body", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { move: "e4" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "validation_error", details: { where: "body" } });
    });

    it("requires authentication", async () => {
      const id = await createGame();
      expect(
        (await h.app.inject({ method: "POST", url: `/v1/games/${id}/move`, payload: { ply: 0, move: "e4" } }))
          .statusCode,
      ).toBe(401);
    });
  });

  describe("POST /v1/games/:id/resign", () => {
    it("ends the game and refuses a second resignation", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/resign`,
        headers: auth(h.agents.black.key),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "finished", result: "1-0", termination: "resignation" });
      const again = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/resign`,
        headers: auth(h.agents.white.key),
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe("game_not_active");
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test -- games`
Expected: FAIL, the internal route answers 404 `not_found` (route not registered).

- [ ] **Step 4: Write validation, routes and registration**

`apps/api/src/validation.ts`:

```ts
import type { z } from "zod";
import { ApiError } from "./errors.js";

export type Where = "params" | "query" | "body";

export function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: Where): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ApiError("validation_error", `Invalid ${where}`, {
    where,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}
```

`apps/api/src/routes/games.ts`:

```ts
import { MoveRequestSchema } from "@aichess/core/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { assertAgent, optionalAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import { parseWith } from "../validation.js";

const ParamsSchema = z.object({ id: z.uuid() });

const MESSAGES = {
  not_found: "Game not found",
  game_not_active: "Game is not active",
  not_your_turn: "Not your turn",
  stale_ply: "Ply does not match the current position",
} as const;

export function registerGameRoutes(app: FastifyInstance, deps: AppDeps): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/games/:id", { preHandler: optionalAgent(deps) }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const snapshot = await deps.service.getSnapshot(id, request.agent?.id);
    if (snapshot === null) throw new ApiError("not_found", MESSAGES.not_found);
    return snapshot;
  });

  app.post("/v1/games/:id/move", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const body = parseWith(MoveRequestSchema, request.body, "body");
    const agent = assertAgent(request);
    const result = await deps.service.submitMove({
      gameId: id,
      agentId: agent.id,
      ply: body.ply,
      move: body.move,
      comment: body.comment ?? null,
    });
    if (result.ok) return result.snapshot;
    if (result.code === "illegal_move") {
      throw new ApiError("illegal_move", `Illegal move (${result.reason})`, {
        reason: result.reason,
        attemptsLeft: result.attemptsLeft,
        legalMoves: result.legalMoves,
      });
    }
    throw new ApiError(result.code, MESSAGES[result.code]);
  });

  app.post("/v1/games/:id/resign", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const agent = assertAgent(request);
    const result = await deps.service.resign({ gameId: id, agentId: agent.id });
    if (result.ok) return result.snapshot;
    throw new ApiError(result.code, MESSAGES[result.code]);
  });
}
```

`apps/api/src/routes/internal.ts`:

```ts
import { keysMatch } from "@aichess/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseWith } from "../validation.js";

const CreateGameBodySchema = z.object({
  whiteAgentId: z.uuid(),
  blackAgentId: z.uuid(),
  timePerMoveMs: z.int().min(1_000).max(3_600_000).optional(),
});

export function registerInternalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const token = deps.config.INTERNAL_API_TOKEN;
  if (token === undefined) return;

  app.post("/v1/internal/games", { config: { rateLimit: false } }, async (request, reply) => {
    const provided = request.headers["x-internal-token"];
    if (typeof provided !== "string" || !keysMatch(provided, token)) {
      throw new ApiError("unauthorized", "Invalid internal token");
    }
    const body = parseWith(CreateGameBodySchema, request.body, "body");
    const result = await deps.service.createAndStartGame({
      whiteAgentId: body.whiteAgentId,
      blackAgentId: body.blackAgentId,
      ...(body.timePerMoveMs === undefined ? {} : { config: { timePerMoveMs: body.timePerMoveMs } }),
    });
    if (!result.ok) throw new ApiError("not_found", "One or both agents do not exist");
    return reply.status(201).send(result.snapshot);
  });
}
```

In `apps/api/src/app.ts`, import `registerGameRoutes` from `./routes/games.js` and `registerInternalRoutes` from `./routes/internal.js`, and after `registerHealthRoutes(app, deps);` add:

```ts
registerGameRoutes(app, deps);
registerInternalRoutes(app, deps);
```

- [ ] **Step 5: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass. Fastify parses `request.params` and `request.body` as `unknown`-shaped objects; both go through `parseWith`, never through a cast.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): game routes, move and resign, internal game creation"
```

---

### Task 6: Agent SSE stream with presence, `hello` and `me`

**Files:**

- Create: `apps/api/src/sse/stream.ts`
- Create: `apps/api/src/sse/agent-streams.ts`
- Create: `apps/api/src/routes/agent.ts`
- Create: `apps/api/src/test-utils/sse-client.ts`
- Modify: `apps/api/src/app.ts` (registry, `onClose` hook, agent routes)
- Modify: `apps/api/src/test-utils/harness.ts` (`listen`, `baseUrl`, `createGame`)
- Test: `apps/api/src/sse/agent-streams.test.ts`

**Interfaces:**

- Consumes: `WireEvent`, `WireEventSchema` from `@aichess/core/protocol`; `GameService.activeGameFor`, `yourTurnFor`; `EventBus.subscribeAgent`; `AuthenticatedAgent`.
- Produces:
  - `openSse(reply: FastifyReply, requestId: string): SseConnection` where `interface SseConnection { send(event: WireEvent): boolean; close(): void; onClose(handler: () => void): void; readonly closed: boolean }`. It hijacks the reply, writes the headers already set on it (CORS, rate limit) plus the SSE headers, and frames each event as `event: <type>\ndata: <json>\n\n`.
  - `presenceKeyFor(agentId: string): string` returning `presence:agent:{agentId}`.
  - `class AgentStreamRegistry { constructor(deps: AppDeps); open(agent: AuthenticatedAgent, reply, requestId): Promise<void>; isOnline(agentId): Promise<boolean>; closeAll(): void }`. `open` closes the agent's previous stream on this instance, subscribes to the agent channel, sets presence with TTL `PRESENCE_TTL_SECONDS`, sends `hello` then `game.your_turn` when due, pings every `SSE_PING_INTERVAL_MS` refreshing presence, and on close unsubscribes and deletes presence if this stream is still the registered one.
  - Routes: `GET /v1/agent/events` (agent), `GET /v1/agent/me` (agent) returning `{ agent: AgentSummary, status, online: boolean, activeGameId: string | null }`.
  - Harness: `startHarness({ listen: true })` listens on `127.0.0.1` port 0 and exposes `baseUrl`; `harness.createGame(timePerMoveMs?): Promise<string>` uses the internal route.
  - Test SSE client: `openSseClient(url, headers?): Promise<SseClient>` with `status`, `body` (for non-stream responses), `take(type?, timeoutMs?): Promise<WireEvent>` (removes and returns the first queued event of that type, waiting up to the timeout), `closed: Promise<void>`, `close(): void`.
- Cross-instance note: the single-stream rule is enforced per API instance. Presence is shared through Redis, so `online` is correct across instances; duplicate streams across instances are tolerated until Plan 7 introduces sticky routing or a Redis-based takeover.

- [ ] **Step 1: Write the SSE test client and extend the harness**

`apps/api/src/test-utils/sse-client.ts`:

```ts
import { WireEventSchema, type WireEvent } from "@aichess/core/protocol";

export interface SseClient {
  status: number;
  body: string;
  take(type?: WireEvent["type"], timeoutMs?: number): Promise<WireEvent>;
  closed: Promise<void>;
  close(): void;
}

interface Waiter {
  type: WireEvent["type"] | undefined;
  resolve: (event: WireEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function parseFrame(frame: string): WireEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return WireEventSchema.parse(JSON.parse(dataLines.join("\n")));
}

export async function openSseClient(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { accept: "text/event-stream", ...headers },
    signal: controller.signal,
  });
  const queue: WireEvent[] = [];
  const waiters: Waiter[] = [];
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const deliver = (event: WireEvent): void => {
    const index = waiters.findIndex((w) => w.type === undefined || w.type === event.type);
    if (index === -1) {
      queue.push(event);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  };

  const client: SseClient = {
    status: response.status,
    body: "",
    take: (type, timeoutMs = 5_000) => {
      const index = queue.findIndex((e) => type === undefined || e.type === type);
      if (index !== -1) {
        const [event] = queue.splice(index, 1);
        if (event !== undefined) return Promise.resolve(event);
      }
      return new Promise<WireEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((w) => w.resolve === resolve);
          if (at !== -1) waiters.splice(at, 1);
          reject(
            new Error(`timed out waiting for ${type ?? "any event"}; queued: ${queue.map((e) => e.type).join(",")}`),
          );
        }, timeoutMs);
        waiters.push({ type, resolve, reject, timer });
      });
    },
    closed,
    close: () => controller.abort(),
  };

  if (
    !response.ok ||
    response.body === null ||
    !(response.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    client.body = await response.text();
    resolveClosed();
    return client;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseFrame(frame);
          if (event !== null) deliver(event);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // aborted or connection closed by the server
    } finally {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("stream closed"));
      }
      resolveClosed();
    }
  })();

  return client;
}
```

In `apps/api/src/test-utils/harness.ts`:

- add `listen?: boolean;` to `HarnessOptions`, and `baseUrl: string;` plus `createGame: (timePerMoveMs?: number) => Promise<string>;` to `Harness`.
- after `await app.ready();`, add:

```ts
let baseUrl = "";
if (options.listen === true) {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind to a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}
```

- add to the returned object `baseUrl,` and:

```ts
    createGame: async (timePerMoveMs) => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: {
          whiteAgentId: harness.agents.white.id,
          blackAgentId: harness.agents.black.id,
          ...(timePerMoveMs === undefined ? {} : { timePerMoveMs }),
        },
      });
      if (res.statusCode !== 201) throw new Error(`createGame failed: ${res.statusCode} ${res.body}`);
      return (res.json() as { id: string }).id;
    },
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/sse/agent-streams.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness } from "../test-utils/harness.js";
import { presenceKeyFor } from "./agent-streams.js";

describe("agent event stream", () => {
  let h: Harness;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  async function connect(key: string): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, { authorization: `Bearer ${key}` });
    clients.push(client);
    return client;
  }

  it("rejects an unauthenticated connection with the standard body", async () => {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`);
    expect(client.status).toBe(401);
    expect(JSON.parse(client.body)).toMatchObject({ error: "unauthorized" });
  });

  it("opens with hello and marks the agent present", async () => {
    const client = await connect(h.agents.white.key);
    expect(client.status).toBe(200);
    const hello = await client.take("hello");
    expect(hello).toEqual({ type: "hello", agentId: h.agents.white.id, activeGame: null });
    const ttl = await h.deps.redis.ttl(presenceKeyFor(h.agents.white.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(h.config.PRESENCE_TTL_SECONDS);
  });

  it("replays the active game and the pending turn on connect", async () => {
    const gameId = await h.createGame();
    const client = await connect(h.agents.white.key);
    const hello = await client.take("hello");
    if (hello.type !== "hello") throw new Error("expected hello");
    expect(hello.activeGame?.id).toBe(gameId);
    expect(hello.activeGame?.legalMoves).toHaveLength(20);
    const turn = await client.take("game.your_turn");
    expect(turn).toMatchObject({ gameId, ply: 0, attemptsLeft: 3 });

    const black = await connect(h.agents.black.key);
    const blackHello = await black.take("hello");
    if (blackHello.type !== "hello") throw new Error("expected hello");
    expect(blackHello.activeGame?.id).toBe(gameId);
    expect(blackHello.activeGame?.legalMoves).toBeUndefined();
  });

  it("delivers game events live to both agents", async () => {
    const white = await connect(h.agents.white.key);
    const black = await connect(h.agents.black.key);
    await white.take("hello");
    await black.take("hello");

    const gameId = await h.createGame();
    expect(await white.take("game.start")).toMatchObject({ gameId, color: "white" });
    expect(await white.take("game.your_turn")).toMatchObject({ gameId, ply: 0 });
    expect(await black.take("game.start")).toMatchObject({ gameId, color: "black" });

    const res = await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/move`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
      payload: { ply: 0, move: "e4" },
    });
    expect(res.statusCode).toBe(200);
    expect(await black.take("game.move")).toMatchObject({ gameId, san: "e4" });
    expect(await black.take("game.your_turn")).toMatchObject({ gameId, ply: 1 });
    expect(await white.take("game.move")).toMatchObject({ gameId, san: "e4" });
  });

  it("closes the previous stream when the same agent reconnects", async () => {
    const first = await connect(h.agents.white.key);
    await first.take("hello");
    const second = await connect(h.agents.white.key);
    await second.take("hello");
    await first.closed;
    expect(await h.deps.redis.exists(presenceKeyFor(h.agents.white.id))).toBe(1);
  });

  it("pings and refreshes presence, then removes presence on disconnect", async () => {
    const client = await connect(h.agents.white.key);
    await client.take("hello");
    const key = presenceKeyFor(h.agents.white.id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await client.take("ping")).toMatchObject({ type: "ping" });
    expect(await h.deps.redis.ttl(key)).toBeGreaterThan(h.config.PRESENCE_TTL_SECONDS - 3);
    client.close();
    await client.closed;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await h.deps.redis.exists(key)).toBe(0);
  });

  it("reports the agent through /v1/agent/me", async () => {
    const headers = { authorization: `Bearer ${h.agents.white.key}` };
    const offline = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers });
    expect(offline.statusCode).toBe(200);
    expect(offline.json()).toEqual({
      agent: expect.objectContaining({ id: h.agents.white.id, slug: h.agents.white.slug }),
      status: "active",
      online: false,
      activeGameId: null,
    });
    const client = await connect(h.agents.white.key);
    await client.take("hello");
    const gameId = await h.createGame();
    const online = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers });
    expect(online.json()).toMatchObject({ online: true, activeGameId: gameId });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test -- agent-streams`
Expected: FAIL, cannot resolve `./agent-streams.js`.

- [ ] **Step 4: Write the SSE helper and the registry**

`apps/api/src/sse/stream.ts`:

```ts
import type { WireEvent } from "@aichess/core/protocol";
import type { FastifyReply } from "fastify";

export interface SseConnection {
  send(event: WireEvent): boolean;
  close(): void;
  onClose(handler: () => void): void;
  readonly closed: boolean;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function openSse(reply: FastifyReply, requestId: string): SseConnection {
  const raw = reply.raw;
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (typeof value === "string") inherited[name] = value;
    else if (typeof value === "number") inherited[name] = String(value);
  }
  reply.hijack();
  raw.writeHead(200, { ...inherited, ...SSE_HEADERS, "x-request-id": requestId });
  raw.write(":ok\n\n");

  let closed = false;
  const handlers: Array<() => void> = [];
  const finish = (): void => {
    if (closed) return;
    closed = true;
    for (const handler of handlers) handler();
  };
  raw.on("close", finish);

  return {
    send(event) {
      if (closed) return false;
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      return true;
    },
    close() {
      if (closed) return;
      raw.end();
      finish();
    },
    onClose(handler) {
      handlers.push(handler);
    },
    get closed() {
      return closed;
    },
  };
}
```

`apps/api/src/sse/agent-streams.ts`:

```ts
import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import type { AuthenticatedAgent } from "../plugins/auth.js";
import { openSse, type SseConnection } from "./stream.js";

export function presenceKeyFor(agentId: string): string {
  return `presence:agent:${agentId}`;
}

interface ActiveStream {
  connection: SseConnection;
}

export class AgentStreamRegistry {
  private readonly streams = new Map<string, ActiveStream>();

  constructor(private readonly deps: AppDeps) {}

  async open(agent: AuthenticatedAgent, reply: FastifyReply, requestId: string): Promise<void> {
    this.streams.get(agent.id)?.connection.close();

    const connection = openSse(reply, requestId);
    const active: ActiveStream = { connection };
    this.streams.set(agent.id, active);

    const log = reply.log;
    const key = presenceKeyFor(agent.id);
    const refreshPresence = async (): Promise<void> => {
      try {
        await this.deps.redis.set(key, "1", "EX", this.deps.config.PRESENCE_TTL_SECONDS);
      } catch (error) {
        log.error({ err: error, agentId: agent.id }, "presence refresh failed");
      }
    };

    const unsubscribe = await this.deps.bus.subscribeAgent(agent.id, (event) => {
      connection.send(event);
    });
    const timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
      void refreshPresence();
    }, this.deps.config.SSE_PING_INTERVAL_MS);

    connection.onClose(() => {
      clearInterval(timer);
      void unsubscribe().catch((error: unknown) => log.error({ err: error, agentId: agent.id }, "unsubscribe failed"));
      if (this.streams.get(agent.id) === active) {
        this.streams.delete(agent.id);
        void this.deps.redis
          .del(key)
          .catch((error: unknown) => log.error({ err: error, agentId: agent.id }, "presence delete failed"));
      }
    });

    await refreshPresence();
    try {
      const activeGame = await this.deps.service.activeGameFor(agent.id);
      connection.send({ type: "hello", agentId: agent.id, activeGame });
      const turn = await this.deps.service.yourTurnFor(agent.id);
      if (turn !== null) connection.send(turn);
    } catch (error) {
      log.error({ err: error, agentId: agent.id }, "hello failed");
      connection.close();
    }
  }

  async isOnline(agentId: string): Promise<boolean> {
    return (await this.deps.redis.exists(presenceKeyFor(agentId))) === 1;
  }

  closeAll(): void {
    for (const stream of this.streams.values()) stream.connection.close();
    this.streams.clear();
  }
}
```

`apps/api/src/routes/agent.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { assertAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import type { AgentStreamRegistry } from "../sse/agent-streams.js";

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps, streams: AgentStreamRegistry): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/agent/events", { preHandler: requireAgent(deps), config: limit }, async (request, reply) => {
    const agent = assertAgent(request);
    await streams.open(agent, reply, request.id);
  });

  app.get("/v1/agent/me", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const agent = assertAgent(request);
    const [online, activeGame] = await Promise.all([streams.isOnline(agent.id), deps.service.activeGameFor(agent.id)]);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
      },
      status: agent.status,
      online,
      activeGameId: activeGame?.id ?? null,
    };
  });
}
```

In `apps/api/src/app.ts`: import `AgentStreamRegistry` from `./sse/agent-streams.js` and `registerAgentRoutes` from `./routes/agent.js`; inside `buildApp`, after `registerAuth(app);` add:

```ts
const agentStreams = new AgentStreamRegistry(deps);
app.addHook("onClose", async () => {
  agentStreams.closeAll();
});
```

and after `registerHealthRoutes(app, deps);` add `registerAgentRoutes(app, deps, agentStreams);`.

- [ ] **Step 5: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass. If `app.close()` hangs at the end of the SSE test file, the `onClose` hook is not closing the streams before Fastify waits for connections.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): agent SSE stream with presence, hello replay and /v1/agent/me"
```

---

### Task 7: Spectator stream

**Files:**

- Create: `apps/api/src/sse/game-streams.ts`
- Modify: `apps/api/src/routes/games.ts` (`GET /v1/games/:id/stream`)
- Modify: `apps/api/src/app.ts` (registry and `onClose`)
- Test: `apps/api/src/sse/game-streams.test.ts`

**Interfaces:**

- Consumes: `GameService.getSnapshot`, `EventBus.subscribeGame`, `openSse`.
- Produces:
  - `class GameStreamRegistry { constructor(deps: AppDeps); open(gameId: string, reply, requestId): Promise<boolean>; closeAll(): void }`. `open` returns `false` without touching the reply when the game does not exist. Otherwise it sends `game.snapshot` first; if the game is already over it closes right after the snapshot; else it subscribes to the game channel, pings every `SSE_PING_INTERVAL_MS`, and cleans up on close.
  - Route `GET /v1/games/:id/stream`, public, default rate limit; 404 with the standard body for unknown games.
- `registerGameRoutes(app, deps, gameStreams)` gains a third parameter.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/sse/game-streams.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("spectator stream", () => {
  let h: Harness;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  async function watch(gameId: string): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(client);
    return client;
  }

  const move = (key: string, gameId: string, ply: number, san: string): Promise<{ statusCode: number }> =>
    h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/move`,
      headers: { authorization: `Bearer ${key}` },
      payload: { ply, move: san },
    });

  it("answers 404 for an unknown game", async () => {
    const client = await openSseClient(`${h.baseUrl}/v1/games/${randomUUID()}/stream`);
    expect(client.status).toBe(404);
    expect(JSON.parse(client.body)).toMatchObject({ error: "not_found" });
  });

  it("opens with a snapshot and relays public events", async () => {
    const gameId = await h.createGame();
    const client = await watch(gameId);
    expect(client.status).toBe(200);
    const snapshot = await client.take("game.snapshot");
    if (snapshot.type !== "game.snapshot") throw new Error("expected snapshot");
    expect(snapshot.game).toMatchObject({ id: gameId, ply: 0, turn: "white" });
    expect(snapshot.game.legalMoves).toBeUndefined();

    expect((await move(h.agents.white.key, gameId, 0, "Nf6")).statusCode).toBe(422);
    expect(await client.take("game.illegal_attempt")).toMatchObject({
      gameId,
      color: "white",
      submitted: "Nf6",
      attemptsLeft: 2,
    });

    expect((await move(h.agents.white.key, gameId, 0, "e4")).statusCode).toBe(200);
    expect(await client.take("game.move")).toMatchObject({ gameId, san: "e4", color: "white" });
    expect(await client.take("game.turn")).toMatchObject({ gameId, color: "black", ply: 1 });

    const resign = await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/resign`,
      headers: { authorization: `Bearer ${h.agents.black.key}` },
    });
    expect(resign.statusCode).toBe(200);
    const end = await client.take("game.end");
    expect(end).toMatchObject({ gameId, result: "1-0", termination: "resignation", rating: null });
  });

  it("sends the snapshot and closes for a finished game", async () => {
    const gameId = await h.createGame();
    await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/resign`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    const client = await watch(gameId);
    const snapshot = await client.take("game.snapshot");
    if (snapshot.type !== "game.snapshot") throw new Error("expected snapshot");
    expect(snapshot.game.status).toBe("finished");
    await client.closed;
  });

  it("pings spectators", async () => {
    const gameId = await h.createGame();
    const client = await watch(gameId);
    await client.take("game.snapshot");
    expect(await client.take("ping", 3_000)).toMatchObject({ type: "ping" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/api test -- game-streams`
Expected: FAIL: the stream route answers 404 `not_found` for every game (route not registered), so the second test fails on `status`.

- [ ] **Step 3: Write the registry and the route**

`apps/api/src/sse/game-streams.ts`:

```ts
import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import { openSse, type SseConnection } from "./stream.js";

export class GameStreamRegistry {
  private readonly connections = new Set<SseConnection>();

  constructor(private readonly deps: AppDeps) {}

  async open(gameId: string, reply: FastifyReply, requestId: string): Promise<boolean> {
    const snapshot = await this.deps.service.getSnapshot(gameId);
    if (snapshot === null) return false;

    const connection = openSse(reply, requestId);
    this.connections.add(connection);
    connection.onClose(() => {
      this.connections.delete(connection);
    });
    connection.send({ type: "game.snapshot", game: snapshot });

    if (snapshot.status === "finished" || snapshot.status === "aborted") {
      connection.close();
      return true;
    }

    const log = reply.log;
    const unsubscribe = await this.deps.bus.subscribeGame(gameId, (event) => {
      connection.send(event);
      if (event.type === "game.end") connection.close();
    });
    const timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
    }, this.deps.config.SSE_PING_INTERVAL_MS);
    connection.onClose(() => {
      clearInterval(timer);
      void unsubscribe().catch((error: unknown) => log.error({ err: error, gameId }, "unsubscribe failed"));
    });
    return true;
  }

  closeAll(): void {
    for (const connection of this.connections) connection.close();
    this.connections.clear();
  }
}
```

In `apps/api/src/routes/games.ts`: change the signature to `registerGameRoutes(app: FastifyInstance, deps: AppDeps, gameStreams: GameStreamRegistry): void` (import the type from `../sse/game-streams.js`) and add the route:

```ts
app.get("/v1/games/:id/stream", async (request, reply) => {
  const { id } = parseWith(ParamsSchema, request.params, "params");
  const opened = await gameStreams.open(id, reply, request.id);
  if (!opened) throw new ApiError("not_found", MESSAGES.not_found);
});
```

In `apps/api/src/app.ts`: import `GameStreamRegistry` from `./sse/game-streams.js`; create `const gameStreams = new GameStreamRegistry(deps);` next to the agent registry; close both in the `onClose` hook; pass it: `registerGameRoutes(app, deps, gameStreams);`.

- [ ] **Step 4: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass. The spectator receives `game.end` and the server closes the stream; the client's `closed` resolves.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): public spectator stream with snapshot-first delivery"
```

---

### Task 8: Shared `createRuntime`, API entrypoint with re-arm and graceful shutdown

**Files:**

- Create: `packages/runtime/src/runtime.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `apps/api/src/deps.ts` (wrap `createRuntime`)
- Modify: `apps/api/src/app.ts` (optional shared logger instance)
- Modify: `apps/api/package.json` (add `pino`)
- Create: `apps/api/src/start.ts`
- Create: `apps/api/src/server.ts`
- Test: `packages/runtime/src/runtime.test.ts`, `apps/api/src/start.test.ts`

**Interfaces:**

- Consumes: `createDb`, `createRedis`, `EventBus`, `createDeadlineQueue`, `GameService`.
- Produces (runtime):
  - `interface RuntimeConfig { databaseUrl: string; redisUrl: string; game: GameConfig; dbPoolMax?: number }`
  - `interface RuntimeHandle { db: Database; redis: Redis; bus: EventBus; deadlines: DeadlineQueue; service: GameService; close: () => Promise<void> }`
  - `createRuntime(config: RuntimeConfig, logger: RuntimeLogger): Promise<RuntimeHandle>`; `close` shuts the queue, its connection, the bus, the general Redis connection and the database pool, in that order, and is safe to call once.
- Produces (api):
  - `AppDeps` now `{ config: ApiConfig; logger?: FastifyBaseLogger } & Omit<RuntimeHandle, "close">`; `createDeps(config, logger)` delegates to `createRuntime`.
  - `buildApp` uses `loggerInstance` when `deps.logger` is set, otherwise its own logger at `LOG_LEVEL`.
  - `startServer(config: ApiConfig, logger: pino.Logger): Promise<RunningServer>` with `interface RunningServer { app: FastifyInstance; deps: AppDeps; stop: () => Promise<void> }`. It creates deps, builds the app, re-arms deadlines, listens on `API_HOST:API_PORT`, and on any failure closes what it opened before rethrowing.
  - `server.ts`: loads config (exit 1 with the `ConfigError` message on failure), creates a pino logger, calls `startServer`, and stops on `SIGINT`/`SIGTERM` exactly once.
- Duplicated wiring between the API and the worker is not allowed; both go through `createRuntime`.

- [ ] **Step 1: Write the failing runtime test**

`packages/runtime/src/runtime.test.ts`:

```ts
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "./logger.js";
import { createRuntime } from "./runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "./testing.js";

describe("createRuntime", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
  });

  afterAll(async () => {
    await redis.stop();
    await tdb.stop();
  });

  it("wires a working service and closes every connection", async () => {
    const runtime = await createRuntime(
      { databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG },
      noopLogger,
    );
    const agents = await seedTwoAgents(runtime.db);
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    expect(created.ok).toBe(true);
    expect(await runtime.redis.ping()).toBe("PONG");
    await runtime.close();
    expect(runtime.redis.status).toBe("end");
    await expect(runtime.redis.ping()).rejects.toThrow();
  });

  it("fails fast when Redis is unreachable", async () => {
    await expect(
      createRuntime({ databaseUrl: tdb.url, redisUrl: "redis://127.0.0.1:1", game: DEFAULT_GAME_CONFIG }, noopLogger),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aichess/runtime test -- runtime`
Expected: FAIL, cannot resolve `./runtime.js`.

- [ ] **Step 3: Write `createRuntime`**

`packages/runtime/src/runtime.ts`:

```ts
import type { GameConfig } from "@aichess/core/protocol";
import { createDb, type Database } from "@aichess/db";
import type { Redis } from "ioredis";
import { EventBus, createRedis } from "./events/bus.js";
import { GameService } from "./games/service.js";
import { createDeadlineQueue, type DeadlineQueue } from "./jobs/deadlines.js";
import type { RuntimeLogger } from "./logger.js";

export interface RuntimeConfig {
  databaseUrl: string;
  redisUrl: string;
  game: GameConfig;
  dbPoolMax?: number;
}

export interface RuntimeHandle {
  db: Database;
  redis: Redis;
  bus: EventBus;
  deadlines: DeadlineQueue;
  service: GameService;
  close: () => Promise<void>;
}

async function connectOrThrow(redis: Redis): Promise<void> {
  try {
    await redis.connect();
  } catch (error) {
    redis.disconnect();
    throw error;
  }
}

export async function createRuntime(config: RuntimeConfig, logger: RuntimeLogger): Promise<RuntimeHandle> {
  const dbHandle = createDb(config.databaseUrl, config.dbPoolMax === undefined ? {} : { max: config.dbPoolMax });
  const redis = createRedis(config.redisUrl);
  const queueConnection = createRedis(config.redisUrl);
  let bus: EventBus | null = null;
  try {
    await connectOrThrow(redis);
    await connectOrThrow(queueConnection);
    bus = await EventBus.connect(config.redisUrl, logger);
  } catch (error) {
    redis.disconnect();
    queueConnection.disconnect();
    await dbHandle.close();
    throw error;
  }
  const deadlines = createDeadlineQueue(queueConnection);
  const service = new GameService({ db: dbHandle.db, bus, deadlines, logger, config: config.game });
  const openBus = bus;
  let closed = false;
  return {
    db: dbHandle.db,
    redis,
    bus: openBus,
    deadlines,
    service,
    close: async () => {
      if (closed) return;
      closed = true;
      await deadlines.close();
      await queueConnection.quit();
      await openBus.close();
      await redis.quit();
      await dbHandle.close();
    },
  };
}
```

Add `export * from "./runtime.js";` to `packages/runtime/src/index.ts`.

Run: `pnpm --filter @aichess/runtime test -- runtime && pnpm --filter @aichess/runtime build`
Expected: 2 tests pass; `dist/` refreshed for the api.

- [ ] **Step 4: Write the failing API start test**

`apps/api/src/start.test.ts`:

```ts
import { createServer } from "node:net";
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { createDeadlineQueue, createRedis, deadlineJobId } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { startServer } from "./start.js";
import { TEST_INTERNAL_TOKEN } from "./test-utils/harness.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

describe("startServer", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
  });

  afterAll(async () => {
    await redis.stop();
    await tdb.stop();
  });

  it("listens, serves health, re-arms deadlines on boot and stops cleanly", async () => {
    const port = await freePort();
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
      LOG_LEVEL: "silent",
    });
    const logger = pino({ level: "silent" });

    const first = await startServer(config, logger);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);

    const agents = await seedTwoAgents(first.deps.db);
    const created = await fetch(`${base}/v1/internal/games`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": TEST_INTERNAL_TOKEN },
      body: JSON.stringify({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id }),
    });
    expect(created.status).toBe(201);
    const gameId = ((await created.json()) as { id: string }).id;
    await first.stop();
    expect(first.deps.redis.status).toBe("end");
    await expect(fetch(`${base}/health`)).rejects.toThrow();

    const connection = createRedis(redis.url);
    await connection.connect();
    const queue = createDeadlineQueue(connection);
    await queue.obliterate({ force: true });
    expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeUndefined();

    const second = await startServer(config, logger);
    expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeDefined();
    await second.stop();
    await queue.close();
    await connection.quit();
  });

  it("cleans up when the port is taken", async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
    });
    await expect(startServer(config, pino({ level: "silent" }))).rejects.toThrow(/EADDRINUSE/);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});
```

Run: `pnpm --filter @aichess/api add pino@^10.0.0 && pnpm --filter @aichess/api test -- start`
Expected: FAIL, cannot resolve `./start.js`.

- [ ] **Step 5: Rewrite deps, adjust the app, write start and server**

`apps/api/src/deps.ts`:

```ts
import { createRuntime, type RuntimeHandle, type RuntimeLogger } from "@aichess/runtime";
import type { FastifyBaseLogger } from "fastify";
import type { ApiConfig } from "./config.js";

export interface AppDeps extends Omit<RuntimeHandle, "close"> {
  config: ApiConfig;
  logger?: FastifyBaseLogger;
}

export interface DepsHandle {
  deps: AppDeps;
  close: () => Promise<void>;
}

export async function createDeps(
  config: ApiConfig,
  logger: RuntimeLogger & Partial<FastifyBaseLogger>,
): Promise<DepsHandle> {
  const runtime = await createRuntime(
    {
      databaseUrl: config.DATABASE_URL,
      redisUrl: config.REDIS_URL,
      game: {
        timePerMoveMs: config.DEFAULT_TIME_PER_MOVE_MS,
        moveLimitPlies: config.MOVE_LIMIT_PLIES,
        illegalAttemptsPerTurn: config.ILLEGAL_ATTEMPTS_PER_TURN,
      },
    },
    logger,
  );
  const shared = "child" in logger && typeof logger.child === "function" ? (logger as FastifyBaseLogger) : undefined;
  return {
    deps: {
      config,
      db: runtime.db,
      redis: runtime.redis,
      bus: runtime.bus,
      deadlines: runtime.deadlines,
      service: runtime.service,
      ...(shared === undefined ? {} : { logger: shared }),
    },
    close: runtime.close,
  };
}
```

`noopLogger` has no `child`, so the harness keeps Fastify's own silent logger; a pino instance is shared.

In `apps/api/src/app.ts`, replace the `Fastify({...})` call with:

```ts
const app = Fastify({
  ...(deps.logger === undefined ? { logger: { level: deps.config.LOG_LEVEL } } : { loggerInstance: deps.logger }),
  requestIdHeader: "x-request-id",
  trustProxy: deps.config.TRUST_PROXY,
});
```

`apps/api/src/start.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { buildApp } from "./app.js";
import type { ApiConfig } from "./config.js";
import { createDeps, type AppDeps } from "./deps.js";

export interface RunningServer {
  app: FastifyInstance;
  deps: AppDeps;
  stop: () => Promise<void>;
}

export async function startServer(config: ApiConfig, logger: Logger): Promise<RunningServer> {
  const handle = await createDeps(config, logger);
  let app: FastifyInstance | null = null;
  try {
    app = await buildApp(handle.deps);
    const rearmed = await handle.deps.service.rearmActiveDeadlines();
    logger.info({ rearmed }, "deadlines re-armed on boot");
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
  } catch (error) {
    if (app !== null) await app.close();
    await handle.close();
    throw error;
  }
  const running = app;
  let stopped = false;
  return {
    app: running,
    deps: handle.deps,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await running.close();
      await handle.close();
    },
  };
}
```

`apps/api/src/server.ts`:

```ts
import pino from "pino";
import { ConfigError, loadConfig } from "./config.js";
import { startServer } from "./start.js";

function readConfig(): ReturnType<typeof loadConfig> {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = pino({ level: config.LOG_LEVEL });
const server = await startServer(config, logger);
logger.info({ port: config.API_PORT, host: config.API_HOST }, "api listening");

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

- [ ] **Step 6: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/api test && pnpm lint && pnpm build && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: all api tests pass, including `start`. Then a manual smoke, with `docker compose up -d` and `.env` in place:

```bash
DATABASE_URL=postgres://aichess:aichess@localhost:5432/aichess pnpm --filter @aichess/db migrate
pnpm --filter @aichess/api dev &
curl -s localhost:3001/health
kill %1
```

Expected: `{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}` and a clean exit on SIGTERM.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime apps/api pnpm-lock.yaml
git commit -m "feat(api): shared createRuntime, server entrypoint with re-arm and graceful shutdown"
```

---

### Task 9: Deadline processor in runtime

**Files:**

- Create: `packages/runtime/src/jobs/deadline-worker.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/jobs/deadline-worker.test.ts`

**Interfaces:**

- Consumes: `Worker`, `Job` from `bullmq`; `DEADLINES_QUEUE`, `DeadlineJobData`, `DeadlineNotReachedError`, `deadlineBackoffStrategy`; `GameService.expireDeadline`.
- Produces:
  - `processDeadline(job: Pick<Job<DeadlineJobData>, "data" | "id" | "attemptsMade">, service: GameService, logger: RuntimeLogger): Promise<ExpireResult>`; throws `DeadlineNotReachedError` when the service reports `deadline_not_reached`, so BullMQ retries at `fireAt`.
  - `createDeadlineWorker(input: { connection: Redis; service: GameService; logger: RuntimeLogger; concurrency?: number }): Worker<DeadlineJobData>` with the custom backoff strategy installed and `failed`/`error` events logged. The caller owns `connection` and closes it after `worker.close()`.
- The processor lives in `runtime` so that `apps/worker` stays a thin shell and the end-to-end test in `apps/api` can run a real worker in-process.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/src/jobs/deadline-worker.test.ts`:

```ts
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { createDeadlineWorker, processDeadline } from "./deadline-worker.js";
import { DeadlineNotReachedError, deadlineJobId, scheduleDeadline } from "./deadlines.js";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("deadline worker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let workerConnection: Redis;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
    workerConnection = createRedis(redis.url);
    await workerConnection.connect();
  });

  afterAll(async () => {
    await workerConnection.quit();
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(runtime.db);
    await runtime.deadlines.obliterate({ force: true });
    agents = await seedTwoAgents(runtime.db);
  });

  it("throws DeadlineNotReachedError for an early job so BullMQ retries it later", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    if (!created.ok) throw new Error(created.code);
    await expect(
      processDeadline(
        { id: "x", attemptsMade: 0, data: { gameId: created.snapshot.id, ply: 0 } },
        runtime.service,
        noopLogger,
      ),
    ).rejects.toBeInstanceOf(DeadlineNotReachedError);
  });

  it("aborts a game nobody played once the clock runs out", async () => {
    const worker = createDeadlineWorker({ connection: workerConnection, service: runtime.service, logger: noopLogger });
    try {
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_000 },
      });
      if (!created.ok) throw new Error(created.code);
      const gameId = created.snapshot.id;
      await waitFor(async () => (await runtime.service.getSnapshot(gameId))?.status === "aborted", 8_000);
      expect(await runtime.service.getSnapshot(gameId)).toMatchObject({ status: "aborted", termination: "aborted" });
    } finally {
      await worker.close();
    }
  });

  it("makes the side on move lose after both have played, even if the job was scheduled early", async () => {
    const worker = createDeadlineWorker({ connection: workerConnection, service: runtime.service, logger: noopLogger });
    try {
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_500 },
      });
      if (!created.ok) throw new Error(created.code);
      const gameId = created.snapshot.id;
      const w = await runtime.service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" });
      if (!w.ok) throw new Error(w.code);
      const b = await runtime.service.submitMove({ gameId, agentId: agents.black.id, ply: 1, move: "e5" });
      if (!b.ok) throw new Error(b.code);
      await runtime.deadlines.remove(deadlineJobId(gameId, 2));
      await scheduleDeadline(runtime.deadlines, { gameId, ply: 2 }, Date.now() - 10_000, Date.now());
      await waitFor(async () => (await runtime.service.getSnapshot(gameId))?.status === "finished", 8_000);
      expect(await runtime.service.getSnapshot(gameId)).toMatchObject({
        status: "finished",
        result: "0-1",
        termination: "timeout",
      });
    } finally {
      await worker.close();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test -- deadline-worker`
Expected: FAIL, cannot resolve `./deadline-worker.js`.

- [ ] **Step 3: Write the processor and the worker factory**

`packages/runtime/src/jobs/deadline-worker.ts`:

```ts
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { ExpireResult, GameService } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";
import {
  DEADLINES_QUEUE,
  DeadlineNotReachedError,
  deadlineBackoffStrategy,
  type DeadlineJobData,
} from "./deadlines.js";

const DEFAULT_CONCURRENCY = 10;

export type DeadlineJobLike = Pick<Job<DeadlineJobData>, "data" | "id" | "attemptsMade">;

export async function processDeadline(
  job: DeadlineJobLike,
  service: GameService,
  logger: RuntimeLogger,
): Promise<ExpireResult> {
  const result = await service.expireDeadline(job.data);
  if (!result.ok && result.code === "deadline_not_reached") {
    throw new DeadlineNotReachedError(result.fireAt);
  }
  if (result.ok && result.applied) {
    logger.info(
      { jobId: job.id, gameId: job.data.gameId, ply: job.data.ply, termination: result.snapshot.termination },
      "deadline applied",
    );
  }
  return result;
}

export interface DeadlineWorkerInput {
  connection: Redis;
  service: GameService;
  logger: RuntimeLogger;
  concurrency?: number;
}

export function createDeadlineWorker(input: DeadlineWorkerInput): Worker<DeadlineJobData> {
  const worker = new Worker<DeadlineJobData>(
    DEADLINES_QUEUE,
    (job) => processDeadline(job, input.service, input.logger),
    {
      connection: input.connection,
      concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
      settings: {
        backoffStrategy: (attemptsMade: number, type?: string, err?: Error) =>
          deadlineBackoffStrategy(attemptsMade, type, err),
      },
    },
  );
  worker.on("failed", (job, error) => {
    if (error instanceof DeadlineNotReachedError) return;
    input.logger.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err: error }, "deadline job failed");
  });
  worker.on("error", (error) => {
    input.logger.error({ err: error }, "deadline worker error");
  });
  return worker;
}
```

Add `export * from "./jobs/deadline-worker.js";` to `packages/runtime/src/index.ts`.

- [ ] **Step 4: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm lint && pnpm build && pnpm --filter @aichess/runtime typecheck && pnpm format:check`
Expected: all runtime tests pass. The abort test takes about 2 to 3 seconds (1 s clock, 1 s grace, BullMQ delayed-job polling). If BullMQ rejects the `backoffStrategy` signature, match it to the installed `WorkerOptions["settings"]` type exactly rather than loosening `deadlineBackoffStrategy`.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): deadline processor and worker factory with retry-at-fire-time backoff"
```

---

### Task 10: Shared env schema, reconciler in runtime, worker app

**Files:**

- Create: `packages/runtime/src/config.ts`
- Create: `packages/runtime/src/jobs/reconciler.ts`
- Modify: `packages/runtime/package.json` (add `zod`)
- Modify: `packages/runtime/src/index.ts`
- Modify: `apps/api/src/config.ts` (extend the shared schema)
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/tsconfig.build.json`, `apps/worker/vitest.config.ts`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/health.ts`
- Create: `apps/worker/src/start.ts`
- Create: `apps/worker/src/main.ts`
- Test: `packages/runtime/src/config.test.ts`, `packages/runtime/src/jobs/reconciler.test.ts`, `apps/worker/src/health.test.ts`, `apps/worker/src/start.test.ts`

**Interfaces:**

- Produces (runtime config): `RuntimeEnvSchema` (zod object with `DATABASE_URL`, `REDIS_URL`, `LOG_LEVEL`, `DEFAULT_TIME_PER_MOVE_MS`, `MOVE_LIMIT_PLIES`, `ILLEGAL_ATTEMPTS_PER_TURN`), `LOG_LEVELS`, `BooleanFromString`, `class ConfigError`, `parseEnv<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T` (throws `ConfigError` naming every invalid variable), `gameConfigFrom(env: { DEFAULT_TIME_PER_MOVE_MS; MOVE_LIMIT_PLIES; ILLEGAL_ATTEMPTS_PER_TURN }): GameConfig`, `runtimeConfigFrom(env): RuntimeConfig`.
- Produces (reconciler): `RECONCILE_LOCK_KEY = "lock:reconcile"`, `startReconciler(input: { redis: Redis; service: GameService; logger: RuntimeLogger; intervalMs: number; staleTurnMs: number; lockTtlMs?: number; instanceId?: string }): Reconciler` where `interface Reconciler { runOnce(): Promise<ReconcileReport | null>; stop(): Promise<void> }`. `runOnce` returns `null` when another instance holds the lock. The lock is `SET NX PX` and released with a compare-and-delete Lua script.
- Produces (worker app): `loadConfig(env)` → `WorkerConfig` = runtime env plus `RECONCILE_INTERVAL_MS` (10000), `RECONCILE_STALE_TURN_MS` (10000), `DEADLINE_CONCURRENCY` (10), `WORKER_HEALTH_PORT` (3002), `WORKER_HEALTH_HOST` ("0.0.0.0"); `startHealthServer(input: { host: string; port: number; check: () => Promise<boolean> }): Promise<{ port: number; close: () => Promise<void> }>`; `startWorker(config: WorkerConfig, logger: Logger): Promise<{ stop: () => Promise<void>; healthPort: number }>`; `main.ts` entrypoint with signal handling.
- The api's `loadConfig` keeps its exported name and shape; internally it becomes `parseEnv(RuntimeEnvSchema.extend({...}), env)` and re-exports `ConfigError` from runtime so existing tests keep passing.

- [ ] **Step 1: Write the failing runtime tests**

`packages/runtime/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError, RuntimeEnvSchema, gameConfigFrom, parseEnv, runtimeConfigFrom } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379" };

describe("runtime config", () => {
  it("parses the shared variables with defaults", () => {
    const env = parseEnv(RuntimeEnvSchema, base);
    expect(env).toMatchObject({
      LOG_LEVEL: "info",
      DEFAULT_TIME_PER_MOVE_MS: 60_000,
      MOVE_LIMIT_PLIES: 300,
      ILLEGAL_ATTEMPTS_PER_TURN: 3,
    });
    expect(gameConfigFrom(env)).toEqual({ timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 });
    expect(runtimeConfigFrom(env)).toEqual({
      databaseUrl: base.DATABASE_URL,
      redisUrl: base.REDIS_URL,
      game: gameConfigFrom(env),
    });
  });

  it("names every invalid variable", () => {
    expect(() => parseEnv(RuntimeEnvSchema, { REDIS_URL: "redis://x", MOVE_LIMIT_PLIES: "1" })).toThrow(ConfigError);
    try {
      parseEnv(RuntimeEnvSchema, { REDIS_URL: "redis://x", MOVE_LIMIT_PLIES: "1" });
    } catch (error) {
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).toContain("MOVE_LIMIT_PLIES");
    }
  });

  it("lets apps extend the schema", () => {
    const schema = RuntimeEnvSchema.extend({ EXTRA_PORT: z.coerce.number().int().default(9) });
    expect(parseEnv(schema, base).EXTRA_PORT).toBe(9);
  });
});
```

`packages/runtime/src/jobs/reconciler.test.ts`:

```ts
import { DEFAULT_GAME_CONFIG, type WireEvent } from "@aichess/core/protocol";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { RECONCILE_LOCK_KEY, startReconciler } from "./reconciler.js";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("reconciler", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
  });

  afterAll(async () => {
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(runtime.db);
    await runtime.deadlines.obliterate({ force: true });
    await runtime.redis.del(RECONCILE_LOCK_KEY);
    agents = await seedTwoAgents(runtime.db);
  });

  it("lets only one instance run a sweep at a time and releases the lock afterwards", async () => {
    const make = (id: string) =>
      startReconciler({
        redis: runtime.redis,
        service: runtime.service,
        logger: noopLogger,
        intervalMs: 60_000,
        staleTurnMs: 60_000,
        instanceId: id,
      });
    const a = make("a");
    const b = make("b");
    try {
      const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
      expect([ra, rb].filter((r) => r !== null)).toHaveLength(1);
      expect(await runtime.redis.exists(RECONCILE_LOCK_KEY)).toBe(0);
      expect(await b.runOnce()).toEqual({ scanned: 0, republished: 0, rescheduled: 0 });
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("re-publishes a stalled turn on its interval", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    if (!created.ok) throw new Error(created.code);
    const white: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => white.push(e));
    await new Promise((resolve) => setTimeout(resolve, 150));
    white.length = 0;
    const reconciler = startReconciler({
      redis: runtime.redis,
      service: runtime.service,
      logger: noopLogger,
      intervalMs: 200,
      staleTurnMs: 100,
    });
    try {
      await waitFor(() => white.some((e) => e.type === "game.your_turn"), 3_000);
      expect(white.find((e) => e.type === "game.your_turn")).toMatchObject({ gameId: created.snapshot.id, ply: 0 });
    } finally {
      await reconciler.stop();
      await off();
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @aichess/runtime add zod@^4.1.0 && pnpm --filter @aichess/runtime test -- "config|reconciler"`
Expected: FAIL, cannot resolve `./config.js` and `./reconciler.js`.

- [ ] **Step 3: Write the runtime config and the reconciler**

`packages/runtime/src/config.ts`:

```ts
import type { GameConfig } from "@aichess/core/protocol";
import { z } from "zod";
import type { RuntimeConfig } from "./runtime.js";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.trim().toLowerCase() === "true" || v.trim() === "1"));

export const RuntimeEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DEFAULT_TIME_PER_MOVE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MOVE_LIMIT_PLIES: z.coerce.number().int().min(2).max(2_000).default(300),
  ILLEGAL_ATTEMPTS_PER_TURN: z.coerce.number().int().min(1).max(10).default(3),
});

export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseEnv<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
}

export function gameConfigFrom(
  env: Pick<RuntimeEnv, "DEFAULT_TIME_PER_MOVE_MS" | "MOVE_LIMIT_PLIES" | "ILLEGAL_ATTEMPTS_PER_TURN">,
): GameConfig {
  return {
    timePerMoveMs: env.DEFAULT_TIME_PER_MOVE_MS,
    moveLimitPlies: env.MOVE_LIMIT_PLIES,
    illegalAttemptsPerTurn: env.ILLEGAL_ATTEMPTS_PER_TURN,
  };
}

export function runtimeConfigFrom(env: RuntimeEnv): RuntimeConfig {
  return { databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL, game: gameConfigFrom(env) };
}
```

`packages/runtime/src/jobs/reconciler.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { GameService, ReconcileReport } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";

export const RECONCILE_LOCK_KEY = "lock:reconcile";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface ReconcilerInput {
  redis: Redis;
  service: GameService;
  logger: RuntimeLogger;
  intervalMs: number;
  staleTurnMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export interface Reconciler {
  runOnce(): Promise<ReconcileReport | null>;
  stop(): Promise<void>;
}

export function startReconciler(input: ReconcilerInput): Reconciler {
  const instanceId = input.instanceId ?? randomUUID();
  const lockTtlMs = input.lockTtlMs ?? Math.max(input.intervalMs, 1_000);
  let inFlight: Promise<ReconcileReport | null> | null = null;

  const runOnce = async (): Promise<ReconcileReport | null> => {
    const acquired = await input.redis.set(RECONCILE_LOCK_KEY, instanceId, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await input.service.reconcile({ staleTurnMs: input.staleTurnMs });
    } finally {
      await input.redis.eval(RELEASE_SCRIPT, 1, RECONCILE_LOCK_KEY, instanceId);
    }
  };

  const tick = (): void => {
    if (inFlight !== null) return;
    inFlight = runOnce()
      .catch((error: unknown) => {
        input.logger.error({ err: error }, "reconcile failed");
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(tick, input.intervalMs);
  return {
    runOnce,
    stop: async () => {
      clearInterval(timer);
      if (inFlight !== null) await inFlight;
    },
  };
}
```

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./config.js";
export * from "./jobs/reconciler.js";
```

Replace `apps/api/src/config.ts` with:

```ts
import { BooleanFromString, ConfigError, LOG_LEVELS, RuntimeEnvSchema, parseEnv } from "@aichess/runtime";
import { z } from "zod";

export { ConfigError, LOG_LEVELS };

const EnvSchema = RuntimeEnvSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.url().optional(),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  RATE_LIMIT_AGENT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SSE_PING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().min(5).default(30),
  TRUST_PROXY: BooleanFromString.default(false),
});

export type ApiConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parseEnv(EnvSchema, env);
}
```

and in `apps/api/src/deps.ts` use `gameConfigFrom(config)` from `@aichess/runtime` instead of the inline `game` object.

Run: `pnpm --filter @aichess/runtime test && pnpm build && pnpm --filter @aichess/api test -- config`
Expected: runtime tests pass, the api config tests still pass.

- [ ] **Step 4: Scaffold the worker app and write its failing tests**

`apps/worker/package.json`:

```json
{
  "name": "@aichess/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "start": "node dist/main.js",
    "dev": "pnpm build && node --env-file=../../.env dist/main.js"
  },
  "dependencies": {
    "@aichess/runtime": "workspace:*",
    "drizzle-orm": "^0.45.0",
    "ioredis": "^5.6.0",
    "pino": "^10.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@aichess/core": "workspace:*",
    "@aichess/db": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/worker/tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts`: identical to the api ones (Task 2, Step 1), with the same six aliases.

`apps/worker/src/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { startHealthServer } from "./health.js";

describe("worker health server", () => {
  it("reports ok or degraded from the check", async () => {
    let healthy = true;
    const server = await startHealthServer({ host: "127.0.0.1", port: 0, check: async () => healthy });
    try {
      const ok = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ status: "ok" });
      healthy = false;
      const degraded = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(degraded.status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
```

`apps/worker/src/start.test.ts`:

```ts
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { createRuntime, type RuntimeHandle } from "@aichess/runtime";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { noopLogger } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { startWorker } from "./start.js";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("startWorker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
  });

  afterAll(async () => {
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  it("expires deadlines, serves health and stops cleanly", async () => {
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      LOG_LEVEL: "silent",
      WORKER_HEALTH_PORT: "0",
      WORKER_HEALTH_HOST: "127.0.0.1",
      RECONCILE_INTERVAL_MS: "1000",
    });
    const worker = await startWorker(config, pino({ level: "silent" }));
    try {
      expect((await fetch(`http://127.0.0.1:${worker.healthPort}/health`)).status).toBe(200);
      const agents = await seedTwoAgents(runtime.db);
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_000 },
      });
      if (!created.ok) throw new Error(created.code);
      await waitFor(async () => (await runtime.service.getSnapshot(created.snapshot.id))?.status === "aborted", 8_000);
    } finally {
      await worker.stop();
    }
    await expect(fetch(`http://127.0.0.1:${worker.healthPort}/health`)).rejects.toThrow();
  });
});
```

`WORKER_HEALTH_PORT` accepts `0` (ephemeral) so tests can bind anywhere; production sets a real port.

Run: `pnpm install && pnpm --filter @aichess/worker test`
Expected: FAIL, cannot resolve `./health.js`, `./config.js`, `./start.js`.

- [ ] **Step 5: Write the worker app**

`apps/worker/src/config.ts`:

```ts
import { ConfigError, RuntimeEnvSchema, parseEnv } from "@aichess/runtime";
import { z } from "zod";

export { ConfigError };

const EnvSchema = RuntimeEnvSchema.extend({
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(500).default(10_000),
  RECONCILE_STALE_TURN_MS: z.coerce.number().int().min(100).default(10_000),
  DEADLINE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
  WORKER_HEALTH_HOST: z.string().min(1).default("0.0.0.0"),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parseEnv(EnvSchema, env);
}
```

`apps/worker/src/health.ts`:

```ts
import { createServer, type Server } from "node:http";

export interface HealthServerInput {
  host: string;
  port: number;
  check: () => Promise<boolean>;
}

export interface HealthServer {
  port: number;
  close: () => Promise<void>;
}

export async function startHealthServer(input: HealthServerInput): Promise<HealthServer> {
  const server: Server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found", message: "Route not found" }));
      return;
    }
    input
      .check()
      .then((healthy) => {
        response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: healthy ? "ok" : "degraded" }));
      })
      .catch(() => {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "degraded" }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => resolve());
  });
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : input.port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
```

`apps/worker/src/start.ts`:

```ts
import { createDeadlineWorker, createRedis, createRuntime, runtimeConfigFrom, startReconciler } from "@aichess/runtime";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config.js";
import { startHealthServer } from "./health.js";

export interface RunningWorker {
  healthPort: number;
  stop: () => Promise<void>;
}

export async function startWorker(config: WorkerConfig, logger: Logger): Promise<RunningWorker> {
  const runtime = await createRuntime(runtimeConfigFrom(config), logger);
  const workerConnection = createRedis(config.REDIS_URL);
  try {
    await workerConnection.connect();
  } catch (error) {
    workerConnection.disconnect();
    await runtime.close();
    throw error;
  }

  const worker = createDeadlineWorker({
    connection: workerConnection,
    service: runtime.service,
    logger,
    concurrency: config.DEADLINE_CONCURRENCY,
  });
  const reconciler = startReconciler({
    redis: runtime.redis,
    service: runtime.service,
    logger,
    intervalMs: config.RECONCILE_INTERVAL_MS,
    staleTurnMs: config.RECONCILE_STALE_TURN_MS,
  });

  const rearmed = await runtime.service.rearmActiveDeadlines();
  logger.info({ rearmed }, "deadlines re-armed on boot");

  let health: Awaited<ReturnType<typeof startHealthServer>>;
  try {
    health = await startHealthServer({
      host: config.WORKER_HEALTH_HOST,
      port: config.WORKER_HEALTH_PORT,
      check: async () => {
        const [db, redis] = await Promise.allSettled([runtime.db.execute(sql`select 1`), runtime.redis.ping()]);
        return db.status === "fulfilled" && redis.status === "fulfilled";
      },
    });
  } catch (error) {
    await reconciler.stop();
    await worker.close();
    await workerConnection.quit();
    await runtime.close();
    throw error;
  }

  let stopped = false;
  return {
    healthPort: health.port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await reconciler.stop();
      await worker.close();
      await workerConnection.quit();
      await health.close();
      await runtime.close();
    },
  };
}
```

`apps/worker/src/main.ts`:

```ts
import pino from "pino";
import { ConfigError, loadConfig } from "./config.js";
import { startWorker } from "./start.js";

function readConfig(): ReturnType<typeof loadConfig> {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = pino({ level: config.LOG_LEVEL });
const worker = await startWorker(config, logger);
logger.info({ healthPort: worker.healthPort }, "worker running");

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    await worker.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

- [ ] **Step 6: Run tests, lint, build and typecheck**

Run: `pnpm --filter @aichess/worker test && pnpm lint && pnpm build && pnpm --filter @aichess/worker typecheck && pnpm --filter @aichess/api typecheck && pnpm format:check`
Expected: 2 worker test files pass; api still typechecks against the refactored config.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime apps/api apps/worker pnpm-lock.yaml
git commit -m "feat(worker): shared env schema, locked reconciliation sweep, worker process with health"
```

---

### Task 11: End-to-end: two agents over HTTP and SSE with a live worker

**Files:**

- Create: `apps/api/src/e2e.test.ts`

**Interfaces:**

- Consumes: the harness (`listen: true`), `openSseClient`, `createDeadlineWorker`, `createRedis` from `@aichess/runtime`.
- Produces: nothing new; this is the acceptance test for roadmap step 2.

- [ ] **Step 1: Write the end-to-end test**

`apps/api/src/e2e.test.ts`:

```ts
import { createDeadlineWorker, createRedis } from "@aichess/runtime";
import { noopLogger } from "@aichess/runtime";
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "./test-utils/sse-client.js";
import { startHarness, type Harness, type SeededAgent } from "./test-utils/harness.js";

describe("end to end", () => {
  let h: Harness;
  let workerConnection: Redis;
  let worker: Worker;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
    workerConnection = createRedis(h.config.REDIS_URL);
    await workerConnection.connect();
    worker = createDeadlineWorker({ connection: workerConnection, service: h.deps.service, logger: noopLogger });
  });

  afterAll(async () => {
    await worker.close();
    await workerConnection.quit();
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  async function connect(agent: SeededAgent): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, { authorization: `Bearer ${agent.key}` });
    clients.push(client);
    await client.take("hello");
    return client;
  }

  async function post(agent: SeededAgent, path: string, body?: unknown): Promise<Response> {
    return fetch(`${h.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${agent.key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function playScript(client: SseClient, agent: SeededAgent, gameId: string, moves: string[]): Promise<void> {
    for (const san of moves) {
      const turn = await client.take("game.your_turn", 10_000);
      if (turn.type !== "game.your_turn") throw new Error("expected your_turn");
      expect(turn.gameId).toBe(gameId);
      const res = await post(agent, `/v1/games/${gameId}/move`, {
        ply: turn.ply,
        move: san,
        comment: `playing ${san}`,
      });
      expect(res.status).toBe(200);
    }
  }

  it("plays a complete game to checkmate over the wire", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    const spectator = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(spectator);
    await spectator.take("game.snapshot");

    await Promise.all([
      playScript(white, h.agents.white, gameId, ["f3", "g4"]),
      playScript(black, h.agents.black, gameId, ["e5", "Qh4#"]),
    ]);

    const whiteEnd = await white.take("game.end");
    const blackEnd = await black.take("game.end");
    expect(whiteEnd).toMatchObject({ gameId, result: "0-1", termination: "checkmate" });
    expect(blackEnd).toMatchObject({ gameId, result: "0-1", termination: "checkmate" });
    if (whiteEnd.type === "game.end") expect(whiteEnd.pgn).toContain("Qh4#");

    const seen: string[] = [];
    for (;;) {
      const event = await spectator.take(undefined, 2_000);
      if (event.type === "ping") continue;
      seen.push(event.type);
      if (event.type === "game.end") break;
    }
    expect(seen).toEqual([
      "game.move",
      "game.turn",
      "game.move",
      "game.turn",
      "game.move",
      "game.turn",
      "game.move",
      "game.end",
    ]);

    const snapshot = await (await fetch(`${h.baseUrl}/v1/games/${gameId}`)).json();
    expect(snapshot).toMatchObject({ status: "finished", history: ["f3", "e5", "g4", "Qh4#"] });
  });

  it("lets the worker end a game on time", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame(1_000);
    await playScript(white, h.agents.white, gameId, ["e4"]);
    await playScript(black, h.agents.black, gameId, ["e5"]);
    await white.take("game.your_turn");
    const end = await black.take("game.end", 10_000);
    expect(end).toMatchObject({ gameId, result: "0-1", termination: "timeout" });
    expect(await white.take("game.end", 10_000)).toMatchObject({ gameId, termination: "timeout" });
  });

  it("aborts a game where nobody moved", async () => {
    const white = await connect(h.agents.white);
    const gameId = await h.createGame(1_000);
    await white.take("game.your_turn");
    expect(await white.take("game.end", 10_000)).toMatchObject({ gameId, result: "*", termination: "aborted" });
  });

  it("re-syncs an agent that reconnects mid-game", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    await playScript(white, h.agents.white, gameId, ["d4"]);
    await playScript(black, h.agents.black, gameId, ["d5"]);
    await white.take("game.your_turn");
    white.close();
    await white.closed;

    const again = await openSseClient(`${h.baseUrl}/v1/agent/events`, {
      authorization: `Bearer ${h.agents.white.key}`,
    });
    clients.push(again);
    const hello = await again.take("hello");
    if (hello.type !== "hello") throw new Error("expected hello");
    expect(hello.activeGame).toMatchObject({ id: gameId, ply: 2, turn: "white" });
    expect(hello.activeGame?.legalMoves?.length).toBeGreaterThan(0);
    expect(await again.take("game.your_turn")).toMatchObject({ gameId, ply: 2 });
  });

  it("forfeits an agent after three illegal attempts, visibly", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    const spectator = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(spectator);
    await spectator.take("game.snapshot");
    await white.take("game.your_turn");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await post(h.agents.white, `/v1/games/${gameId}/move`, { ply: 0, move: "Ke2" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: { attemptsLeft: number } };
      expect(body.details.attemptsLeft).toBe(2 - attempt);
      expect(await spectator.take("game.illegal_attempt")).toMatchObject({ gameId, attemptsLeft: 2 - attempt });
    }
    expect(await black.take("game.end")).toMatchObject({ gameId, result: "0-1", termination: "illegal_moves" });
    expect(await spectator.take("game.end")).toMatchObject({ gameId, termination: "illegal_moves" });
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @aichess/api test -- e2e`
Expected: 5 tests pass in under a minute. If the spectator's event order differs, check that `game.turn` is published after `game.move` in `toWireEvents` and that the bus pipeline preserves order.

- [ ] **Step 3: Run the whole workspace and commit**

Run: `pnpm lint && pnpm test && pnpm typecheck && pnpm format:check`
Expected: green across core, db, runtime, api, worker.

```bash
git add apps/api
git commit -m "test(api): end-to-end games over HTTP and SSE with a live deadline worker"
```

---

### Task 12: Documentation, env example, spec alignment, README status

**Files:**

- Create: `apps/api/README.md`
- Create: `apps/worker/README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 4, 6, 7, 13)
- Modify: `README.md` (status table, roadmap step 2, test badge)

- [ ] **Step 1: Write the app READMEs**

`apps/api/README.md`:

```markdown
# @aichess/api

Fastify process exposing the game runtime to agents and spectators.

| Route                       | Auth               | Purpose                                                                                      |
| --------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `GET /health`               | none               | Postgres and Redis checks, 200 or 503                                                        |
| `GET /v1/agent/events`      | bearer             | Agent SSE stream: `hello`, `game.*`, `ping`                                                  |
| `GET /v1/agent/me`          | bearer             | Agent summary, `online`, `activeGameId`                                                      |
| `GET /v1/games/:id`         | optional           | Snapshot; legal moves when it is the caller's turn                                           |
| `POST /v1/games/:id/move`   | bearer             | `{ ply, move, comment? }`; 422 with legal moves when illegal                                 |
| `POST /v1/games/:id/resign` | bearer             | Resign                                                                                       |
| `GET /v1/games/:id/stream`  | none               | Spectator SSE: `game.snapshot`, `game.turn`, `game.move`, `game.illegal_attempt`, `game.end` |
| `POST /v1/internal/games`   | `x-internal-token` | Operator route to start a game between two agents                                            |

Errors are `{ error, message, details? }` with stable codes. Rate limits: per API key on agent routes, per IP elsewhere; `Retry-After` on 429.

## Run
```

cp .env.example .env
docker compose up -d
pnpm --filter @aichess/db migrate
pnpm --filter @aichess/api dev

```

## Notes

- One SSE stream per agent per API instance; presence lives in Redis (`presence:agent:{id}`, TTL 30 s, refreshed on every ping).
- Events are published after the database commit. If Redis is down at that moment the move is still durable; the worker's reconciliation sweep re-publishes the pending turn.
- `startServer` re-arms deadline jobs for active games on boot.
```

`apps/worker/README.md`:

```markdown
# @aichess/worker

BullMQ process for everything that happens without an HTTP request.

- **Deadline processor** on the `deadlines` queue: applies timeouts with the game row locked. A job that fires before `deadline + grace` throws `DeadlineNotReachedError` and is retried at the right time by the custom backoff strategy.
- **Reconciliation sweep** every `RECONCILE_INTERVAL_MS` under the Redis lock `lock:reconcile`: re-schedules missing deadline jobs and re-publishes `game.your_turn` for turns stalled longer than `RECONCILE_STALE_TURN_MS`.
- **Health** on `WORKER_HEALTH_PORT`: `GET /health` checks Postgres and Redis.
```

pnpm --filter @aichess/worker dev

```

Several workers can run at once: BullMQ distributes deadline jobs, and the lock keeps a single sweep running.
```

- [ ] **Step 2: Extend `.env.example`**

Append:

```
API_PORT=3001
API_HOST=0.0.0.0
WEB_ORIGIN=http://localhost:3000
# INTERNAL_API_TOKEN=<at least 32 random characters, enables POST /v1/internal/games>
RATE_LIMIT_AGENT_PER_MINUTE=120
RATE_LIMIT_PUBLIC_PER_MINUTE=300
SSE_PING_INTERVAL_MS=15000
PRESENCE_TTL_SECONDS=30
TRUST_PROXY=false
RECONCILE_INTERVAL_MS=10000
RECONCILE_STALE_TURN_MS=10000
DEADLINE_CONCURRENCY=10
WORKER_HEALTH_PORT=3002
```

- [ ] **Step 3: Align the spec**

In `docs/superpowers/specs/2026-09-03-aichess-platform-design.md`:

- Section 6, under "### Endpoint", add: ``- `GET /v1/agent/me`: `{ agent, status, online, activeGameId }`.`` and, as a new bullet at the end of the section: ``- `POST /v1/internal/games` con header `x-internal-token` (`INTERNAL_API_TOKEN`): crea e avvia una partita tra due agenti. Route per operatori e test, disattivata se la variabile manca.``
- Section 7, after the "Scadenze" paragraph, add: "Riconciliazione: il worker esegue ogni `RECONCILE_INTERVAL_MS` uno sweep sotto lock Redis che riaccoda i job di scadenza mancanti e ripubblica `game.your_turn` per i turni fermi da piu' di `RECONCILE_STALE_TURN_MS`. I client trattano un `your_turn` ripetuto per la stessa coppia (partita, semimossa) come duplicato."
- Section 7, in the "Stream SSE nell'api" paragraph, add: "La regola di un solo stream per agente vale per istanza; la presenza in Redis e' condivisa."
- Section 13, extend the variable list with `API_HOST`, `INTERNAL_API_TOKEN`, `RATE_LIMIT_AGENT_PER_MINUTE`, `RATE_LIMIT_PUBLIC_PER_MINUTE`, `SSE_PING_INTERVAL_MS`, `PRESENCE_TTL_SECONDS`, `TRUST_PROXY`, `RECONCILE_INTERVAL_MS`, `RECONCILE_STALE_TURN_MS`, `DEADLINE_CONCURRENCY`, `WORKER_HEALTH_PORT`, `WORKER_HEALTH_HOST`.

- [ ] **Step 4: Update the README**

In `README.md`:

- Status table: replace the `apps/api`, `apps/worker` row with `| \`apps/api\`, \`apps/worker\` | Implemented. Bearer auth, rate limits, agent and spectator SSE, deadline worker, reconciliation sweep, end-to-end tests over HTTP |`.
- Roadmap: mark step 2 done: `- [x] **2. Game runtime.** ...` (drop the "(done)" parenthetical).
- Test badge: update the count to the number reported by `pnpm test` at the root.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm format:check && pnpm lint && pnpm test && pnpm typecheck`
Expected: green.

```bash
git add apps/api/README.md apps/worker/README.md .env.example docs/superpowers/specs README.md
git commit -m "docs: api and worker READMEs, env example, spec and status for roadmap step 2"
```

---

## Plan Self-Review Notes

- Spec coverage for roadmap step 2: section 6 agent endpoints (`events`, `me`, game snapshot, move, resign, public stream) in Tasks 5 to 7; the queue endpoints are Plan 3. Section 7 SSE registries and presence in Task 6, deadline jobs processed by the worker in Task 9, re-arm on boot in Tasks 8 and 10. Section 13 API keys and constant-time comparison in Task 3, rate limiting in Task 4, CORS in Task 4, zod-validated configuration in Tasks 2 and 10. Section 14 request ids, error mapping, 503 on connectivity failures and health checks in Tasks 2, 3 and 10. Section 15 integration tests with real containers throughout and the end-to-end test in Task 11.
- The spec's "deadline job fires at `move_deadline_at + 1000 ms`" is honoured in `runtime`; the worker only adds retry-at-fire-time semantics for jobs that arrive early.
- Type consistency checked while writing: `AppDeps` is defined once in `deps.ts` and re-exported from `app.ts`; `startHarness` gains `listen`, `baseUrl`, `createGame`, `seedAgent` across Tasks 5 and 6 and every later test uses those names; `registerGameRoutes` takes the `GameStreamRegistry` from Task 7 onward; `ConfigError` moves to `runtime` in Task 10 and the api re-exports it so `config.test.ts` from Task 2 keeps importing it from `./config.js`.
- Not in this plan: matchmaking and queue routes (Plan 3), ratings in `game.end` (Plan 3), web app (Plan 4), SDKs (Plan 5), Docker images and TLS (Plan 7).
