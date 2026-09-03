# Plan 3: Matchmaking and Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents join a rated queue and be paired by rating into games the worker starts on its own, and settle Glicko-2 ratings in the same transaction that ends each game, so that `game.end`, `GET /v1/agent/me` and a public leaderboard report real ratings.

**Architecture:** The queue is a Redis sorted set `mm:queue` (score = rating) plus a hash `mm:meta` (`queuedAt` per agent), changed only through Lua scripts so that join, leave and pair removal are atomic. A pure function `pairCandidates` decides the pairs: a rating window that grows with the wait, no two agents of the same owner, colours alternating with each agent's previous game. A `Matchmaker` in `@aichess/runtime` reads the queue, enriches it from Postgres (owner, status, active game, last colour) and Redis presence, drops entries that are no longer valid, and starts games through `GameService.createAndStartGame`, which already publishes `game.start` and `game.your_turn` and schedules the first deadline. The worker runs the matchmaker every `MATCHMAKING_INTERVAL_MS` under a Redis lock, through a locked-interval helper shared with the reconciler. Rating settlement lives inside `GameService`: every transition that ends a game locks both `ratings` rows, applies `applyGameRatings` from `@aichess/core`, writes `rating_history` and the `games.*_rating_*` columns, and hands the deltas to `game.end`.

**Tech Stack:** Node 22, pnpm 10, Turborepo 2, TypeScript 5.9, vitest 3, drizzle-orm 0.45 + drizzle-kit 0.31, postgres.js 3, ioredis 5 (Lua scripts through `eval`), bullmq 6, Fastify 5.12, zod 4, testcontainers 12.

**Spec:** `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 5, 6, 8, 9, 13, 14, 15). Plans 1, 2a and 2b define `@aichess/core`, `@aichess/db`, `@aichess/runtime`, `@aichess/api` and `@aichess/worker`, all consumed here.

## Global Constraints

- Run every `pnpm` and `node` command under Node 22: prefix with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`. Docker must be running: integration tests start Postgres and Redis containers.
- ESM only, explicit `.js` extensions on relative imports, `verbatimModuleSyntax` on. pnpm resolves strictly: every package declares every module it imports.
- Workspace packages resolve through `dist/` at typecheck and runtime; run `pnpm build` at the root before `typecheck` in any app. Vitest resolves workspace packages to `src/` through the aliases in each `vitest.config.ts`, so tests do not need a build.
- Configuration comes from environment variables validated with zod at process start. No URL, port, limit, interval or token is hardcoded. Game and rating rules (window sizes, Glicko-2 constants, provisional threshold) are named constants in code, exported so tests and docs can reference them.
- Glicko-2: tau 0.5, initial rating 1500, RD 350, volatility 0.06 (`GLICKO2_DEFAULTS`); provisional while RD > 110 (`PROVISIONAL_RD_THRESHOLD`); one update per game right after termination, each game a period with one opponent; `aborted` games change nothing. The update happens in the same transaction as the termination so `games.*_rating_after`, `ratings` and `rating_history` are consistent.
- Queue: sorted set `mm:queue` with score = rating, hash `mm:meta` with `queuedAt` per agent. Pairing job every `MATCHMAKING_INTERVAL_MS` (3000) under a Redis lock so one runs at a time. Rating window 150, plus 100 every 10 s of waiting, at most 1000. A candidate is valid when online (presence key), of a different owner, not in an active game, not already paired in this round. A pair is removed atomically from the queue before the game is created. An agent that goes offline is removed from the queue by the pairing job.
- Public leaderboard excludes provisional and suspended agents, ordered by rating descending, RD ascending.
- HTTP error bodies are always `{ error, message, details? }`. New codes used here: `already_in_queue` 409, `not_in_queue` 409, `in_active_game` 409; `validation_error` 400 for a bad cursor or query.
- Every Postgres or Redis failure is either returned as `service_unavailable` (api) or logged with context (runtime, worker). Nothing external fails silently.
- One SSE stream per agent per API instance; presence key `presence:agent:{id}` (moved to `@aichess/runtime` in this plan).
- Another Claude session works on `site/` in this checkout: stage explicit paths only, never `git add -A`.
- Every task ends with `pnpm lint`, the package's `test` and `typecheck` green, `pnpm format:check` clean, then a commit whose message ends with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy`

## Decisions taken in this plan

- **Scope.** Rated queue only. The unrated queue and the house sparring agent (spec section 18, item 2) are Plan 3b, written after this plan is executed. Direct challenges stay in later iterations.
- **`GET /v1/agent/me`** returns `{ agent, status, online, activeGameId, queue, rating }` with `queue: { queuedAt } | null` and `rating: { rating, rd, gamesPlayed, provisional }`. **`hello`** gains `queue: { queuedAt } | null` so a reconnecting agent knows whether it is still queued.
- **Queue routes** answer `200 { queuedAt }` on both `POST` and `DELETE`; the spec is silent on the body.
- **Offline grace.** An entry whose agent is offline is skipped for pairing; it is removed from the queue only when `now - queuedAt >= MATCHMAKING_OFFLINE_GRACE_MS` (15000). Without the grace, an agent that joins before opening its stream would be dropped within one tick. Every removal by the pairing job publishes `queue.left` to the agent.
- **Window semantics.** For each agent in wait order (longest first) the window is computed from that agent's wait; among the valid candidates inside the window the closest rating wins, ties to the longer wait. Each agent is paired at most once per round.
- **Colours** alternate with each agent's previous game (README rule): the longer-waiting agent's wish wins on conflict; when neither has a previous game the longer-waiting agent is white.
- **Failure during pairing.** The pair is removed from the queue atomically; if `createAndStartGame` throws, both agents are put back with their original `queuedAt` and rating and the error propagates to the locked interval, which logs it.
- **Rating rows** are created lazily at the first settlement; an agent without a row reads as the Glicko-2 defaults. Every `finished` game settles ratings, including forfeits at ply 0 by resignation or illegal moves; only `aborted` games skip.
- **`GET /v1/leaderboard`** moves from step 4 into this plan because it is the read side of ratings: `{ items: [{ rank, agent, rating, rd, gamesPlayed }], nextCursor }`, keyset cursor (`rating`, `rd`, `agentId`, `rank`) encoded as base64url JSON, `limit` 1 to 100, default 50.
- **`presenceKeyFor`** moves from `apps/api` to `@aichess/runtime` because the matchmaker reads presence.
- **Locked interval.** The reconciler's lock-and-tick loop becomes `startLockedInterval` in runtime, reused by the matchmaker. `startReconciler` keeps its signature.

---

## File Structure

```
packages/core/src/
  protocol/schemas.ts             + AgentStatusSchema, QueueStatusSchema, RatingSummarySchema, AgentMeSchema,
                                    LeaderboardEntrySchema, LeaderboardPageSchema, LeaderboardQuerySchema, hello.queue
packages/db/
  src/schema/ratings.ts           ratings, ratingHistory tables and relations
  src/schema/index.ts             + export ratings
  src/testing.ts                  truncateAll covers the new tables
  drizzle/0001_ratings.sql        generated migration (+ meta/0001_snapshot.json, meta/_journal.json)
packages/runtime/src/
  presence.ts                     presenceKeyFor(agentId)
  events/wire.ts                  + NO_RATING_CHANGES
  events/bus.ts                   + EventBus.publishToAgent
  games/repository.ts             + GameRatingColumns, PersistOptions.ratings
  games/service.ts                commitTransition: pgn + rating settlement in one place; afterCommit takes WireExtras
  rating/repository.ts            RatingRecord, defaultRatingRecord, toRatingSummary, loadRating, lockRatings, listLeaderboard
  rating/settle.ts                settleRatings(tx, state, now): SettledRatings | null
  matchmaking/queue.ts            MatchmakingQueue over Redis with Lua scripts
  matchmaking/pairing.ts          windowFor, chooseColors, pairCandidates (pure)
  matchmaking/repository.ts       loadQueueAgents, listAgentsInActiveGames, loadLastColors
  matchmaking/service.ts          MatchmakingService: join, leave, status; toQueueStatus
  matchmaking/matchmaker.ts       Matchmaker.runOnce, startMatchmaker, MATCHMAKING_LOCK_KEY
  jobs/locked-interval.ts         startLockedInterval (extracted from the reconciler)
  jobs/reconciler.ts              thin wrapper over startLockedInterval
  runtime.ts                      RuntimeHandle + queue, matchmaking
  testing.ts                      seedTwoAgents(db, { owners })
  index.ts                        exports for the new modules
apps/api/src/
  deps.ts                         passes queue and matchmaking through
  routes/agent.ts                 + POST/DELETE /v1/agent/queue, me with queue and rating
  routes/leaderboard.ts           GET /v1/leaderboard
  app.ts                          registers leaderboard routes
  sse/agent-streams.ts            hello with queue; presenceKeyFor from runtime
  test-utils/harness.ts           owners option, queue cleared on reseed
  e2e.test.ts                     queue → pairing → rated game
apps/worker/src/
  config.ts                       + MATCHMAKING_INTERVAL_MS, MATCHMAKING_OFFLINE_GRACE_MS
  start.ts                        matchmaker loop
```

Each `src/**/x.ts` has a sibling `x.test.ts` unless stated otherwise.

---

### Task 1: Protocol schemas for queue status, agent profile and leaderboard

**Files:**

- Modify: `packages/core/src/protocol/schemas.ts`
- Test: `packages/core/src/protocol/schemas.test.ts`

**Interfaces:**

- Consumes: `AGENT_STATUSES` from `packages/core/src/protocol/enums.ts`, existing `AgentSummarySchema`, `HelloEventSchema`.
- Produces (all exported from `@aichess/core/protocol`):
  - `AgentStatusSchema = z.enum(AGENT_STATUSES)`.
  - `QueueStatusSchema = { queuedAt: iso datetime }`, type `QueueStatus`.
  - `RatingSummarySchema = { rating: number, rd: number >= 0, gamesPlayed: int >= 0, provisional: boolean }`, type `RatingSummary`.
  - `AgentMeSchema = { agent: AgentSummary, status: AgentStatus, online: boolean, activeGameId: uuid | null, queue: QueueStatus | null, rating: RatingSummary }`, type `AgentMe`.
  - `LeaderboardEntrySchema = { rank: int >= 1, agent: AgentSummary, rating: number, rd: number >= 0, gamesPlayed: int >= 0 }`, `LeaderboardPageSchema = { items: LeaderboardEntry[], nextCursor: string | null }`, types `LeaderboardEntry`, `LeaderboardPage`.
  - `LeaderboardQuerySchema = { limit: coerced int 1..100 default 50, cursor?: string 1..512 }`, type `LeaderboardQuery`.
  - `HelloEventSchema` is **not** changed here: it gains `queue` in Task 8, together with the api code that sends it, so the workspace typechecks after every task.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/protocol/schemas.test.ts`. Extend the import from `./schemas.js` with `AgentMeSchema`, `LeaderboardPageSchema`, `LeaderboardQuerySchema`, and add `import { randomUUID } from "node:crypto";` at the top of the file if it is not already there.

```ts
describe("agent profile, queue and leaderboard schemas", () => {
  const agent = {
    id: randomUUID(),
    name: "Alpha",
    slug: "alpha",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-5",
  };

  it("describes the agent profile", () => {
    const me = {
      agent,
      status: "active",
      online: true,
      activeGameId: null,
      queue: null,
      rating: { rating: 1500, rd: 350, gamesPlayed: 0, provisional: true },
    };
    expect(AgentMeSchema.parse(me)).toEqual(me);
    expect(AgentMeSchema.safeParse({ ...me, status: "banned" }).success).toBe(false);
    expect(AgentMeSchema.safeParse({ ...me, rating: { ...me.rating, gamesPlayed: -1 } }).success).toBe(false);
  });

  it("coerces and bounds the leaderboard query", () => {
    expect(LeaderboardQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(LeaderboardQuerySchema.parse({ limit: "10", cursor: "abc" })).toEqual({ limit: 10, cursor: "abc" });
    expect(LeaderboardQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(LeaderboardQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(LeaderboardQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
  });

  it("validates a leaderboard page", () => {
    const page = {
      items: [{ rank: 1, agent, rating: 1712.4, rd: 80.2, gamesPlayed: 12 }],
      nextCursor: null,
    };
    expect(LeaderboardPageSchema.parse(page)).toEqual(page);
    expect(LeaderboardPageSchema.safeParse({ ...page, items: [{ ...page.items[0], rank: 0 }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the core tests to verify the new ones fail**

Run: `pnpm --filter @aichess/core test`
Expected: the new tests fail (`AgentMeSchema`, `LeaderboardPageSchema` and `LeaderboardQuerySchema` are not exported); all existing tests pass.

- [ ] **Step 3: Add the schemas**

In `packages/core/src/protocol/schemas.ts`:

Extend the import from `./enums.js` with `AGENT_STATUSES`:

```ts
import {
  AGENT_STATUSES,
  COLORS,
  ERROR_CODES,
  GAME_STATUSES,
  ILLEGAL_REASONS,
  MAX_COMMENT_LENGTH,
  RESULTS,
  TERMINATIONS,
  UCI_REGEX,
} from "./enums.js";
```

After `export const IllegalReasonSchema = z.enum(ILLEGAL_REASONS);` add:

```ts
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
```

After `export type AgentSummary = z.infer<typeof AgentSummarySchema>;` add:

```ts
export const QueueStatusSchema = z.object({
  queuedAt: z.iso.datetime(),
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

export const RatingSummarySchema = z.object({
  rating: z.number(),
  rd: z.number().min(0),
  gamesPlayed: z.int().min(0),
  provisional: z.boolean(),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

export const AgentMeSchema = z.object({
  agent: AgentSummarySchema,
  status: AgentStatusSchema,
  online: z.boolean(),
  activeGameId: z.uuid().nullable(),
  queue: QueueStatusSchema.nullable(),
  rating: RatingSummarySchema,
});
export type AgentMe = z.infer<typeof AgentMeSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.int().min(1),
  agent: AgentSummarySchema,
  rating: z.number(),
  rd: z.number().min(0),
  gamesPlayed: z.int().min(0),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardPageSchema = z.object({
  items: z.array(LeaderboardEntrySchema),
  nextCursor: z.string().nullable(),
});
export type LeaderboardPage = z.infer<typeof LeaderboardPageSchema>;

export const LEADERBOARD_MAX_LIMIT = 100;
export const LEADERBOARD_DEFAULT_LIMIT = 50;

export const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LEADERBOARD_MAX_LIMIT).default(LEADERBOARD_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
```

- [ ] **Step 4: Run the core tests to verify they pass**

Run: `pnpm --filter @aichess/core test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @aichess/core lint && pnpm --filter @aichess/core typecheck && pnpm format:check`
Expected: green. The change is additive, so every other package still compiles.

```bash
git add packages/core/src/protocol/schemas.ts packages/core/src/protocol/schemas.test.ts
git commit -m "feat(core): protocol schemas for queue status, agent profile and leaderboard"
```

---

### Task 2: `ratings` and `rating_history` tables with a migration

**Files:**

- Create: `packages/db/src/schema/ratings.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/testing.ts`
- Generate: `packages/db/drizzle/0001_ratings.sql`, `packages/db/drizzle/meta/0001_snapshot.json`, `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**

- Consumes: `agents`, `games` tables.
- Produces: `ratings` (`agentId` PK, `rating`, `rd`, `volatility` doubles, `gamesPlayed` int default 0, `lastGameAt` nullable, `createdAt`, `updatedAt`) and `ratingHistory` (`id`, `agentId`, `gameId`, `ratingBefore`, `ratingAfter`, `rdAfter`, `createdAt`; unique `(agentId, gameId)`), both exported from `@aichess/db`. `truncateAll` empties them.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/schema.test.ts`, inside `describe("database schema", ...)`. Extend the import from `./schema/index.js` with `ratingHistory, ratings`.

```ts
it("stores a rating row with defaults and refuses two history rows for one agent and game", async () => {
  const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
  if (owner === undefined) throw new Error("insert returned nothing");
  const [a, b] = await tdb.db
    .insert(agents)
    .values([
      {
        ownerId: owner.id,
        name: "A",
        slug: "a",
        modelProvider: "x",
        modelName: "y",
        apiKeyPrefix: "AAAAAAAA",
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: owner.id,
        name: "B",
        slug: "b",
        modelProvider: "x",
        modelName: "y",
        apiKeyPrefix: "BBBBBBBB",
        apiKeyHash: "1".repeat(64),
      },
    ])
    .returning();
  if (a === undefined || b === undefined) throw new Error("agents not inserted");
  const [game] = await tdb.db
    .insert(games)
    .values({
      whiteAgentId: a.id,
      blackAgentId: b.id,
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
      currentFen: START_FEN,
    })
    .returning();
  if (game === undefined) throw new Error("game not inserted");

  await tdb.db.insert(ratings).values({ agentId: a.id, rating: 1500, rd: 350, volatility: 0.06 });
  const [row] = await tdb.db.select().from(ratings).where(eq(ratings.agentId, a.id));
  expect(row).toMatchObject({ rating: 1500, rd: 350, volatility: 0.06, gamesPlayed: 0, lastGameAt: null });

  const history = { agentId: a.id, gameId: game.id, ratingBefore: 1500, ratingAfter: 1512.3, rdAfter: 290.1 };
  await tdb.db.insert(ratingHistory).values(history);
  await expectUniqueViolation(tdb.db.insert(ratingHistory).values(history));
  await tdb.db.insert(ratingHistory).values({ ...history, agentId: b.id });
  expect(await tdb.db.select().from(ratingHistory)).toHaveLength(2);
});
```

- [ ] **Step 2: Run the db tests to verify the new one fails**

Run: `pnpm --filter @aichess/db test`
Expected: the new test fails with `ratings is not exported` (or a TypeScript resolution error from vitest); the other tests pass.

- [ ] **Step 3: Add the schema**

Create `packages/db/src/schema/ratings.ts`:

```ts
import { relations } from "drizzle-orm";
import { doublePrecision, index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { games } from "./games.js";

export const ratings = pgTable(
  "ratings",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id),
    rating: doublePrecision("rating").notNull(),
    rd: doublePrecision("rd").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
    lastGameAt: timestamp("last_game_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ratings_leaderboard_idx").on(t.rating.desc(), t.rd.asc(), t.agentId.asc())],
);

export const ratingHistory = pgTable(
  "rating_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rating_history_agent_game_idx").on(t.agentId, t.gameId),
    index("rating_history_agent_idx").on(t.agentId, t.createdAt),
  ],
);

export const ratingsRelations = relations(ratings, ({ one }) => ({
  agent: one(agents, { fields: [ratings.agentId], references: [agents.id] }),
}));

export const ratingHistoryRelations = relations(ratingHistory, ({ one }) => ({
  agent: one(agents, { fields: [ratingHistory.agentId], references: [agents.id] }),
  game: one(games, { fields: [ratingHistory.gameId], references: [games.id] }),
}));
```

Append to `packages/db/src/schema/index.ts`:

```ts
export * from "./ratings.js";
```

In `packages/db/src/testing.ts` change `truncateAll` to:

```ts
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE rating_history, ratings, move_attempts, moves, games, agents, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @aichess/db generate --name ratings`
Expected: `packages/db/drizzle/0001_ratings.sql` is created with two `CREATE TABLE` statements (`rating_history`, `ratings`), three `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements, `CREATE UNIQUE INDEX "rating_history_agent_game_idx"`, `CREATE INDEX "rating_history_agent_idx"` and `CREATE INDEX "ratings_leaderboard_idx" ... ("rating" DESC NULLS LAST, "rd", "agent_id")`; `meta/_journal.json` gains a second entry. Open the SQL file and check it contains exactly those objects and nothing about existing tables.

- [ ] **Step 5: Run the db tests to verify they pass**

Run: `pnpm --filter @aichess/db test`
Expected: PASS, including "applies migrations idempotently".

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @aichess/db lint && pnpm --filter @aichess/db typecheck && pnpm format:check`
Expected: green (`drizzle/` is in `.prettierignore`).

```bash
git add packages/db/src/schema/ratings.ts packages/db/src/schema/index.ts packages/db/src/testing.ts packages/db/src/schema.test.ts packages/db/drizzle/0001_ratings.sql packages/db/drizzle/meta/0001_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): ratings and rating_history tables"
```

---

### Task 3: Settle Glicko-2 ratings in the finishing transaction

**Files:**

- Create: `packages/runtime/src/rating/repository.ts`
- Create: `packages/runtime/src/rating/settle.ts`
- Modify: `packages/runtime/src/games/repository.ts`
- Modify: `packages/runtime/src/events/wire.ts`
- Modify: `packages/runtime/src/games/service.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/rating/repository.test.ts`, `packages/runtime/src/rating/settle.test.ts`, `packages/runtime/src/games/repository.test.ts`, `packages/runtime/src/games/service.test.ts`

**Interfaces:**

- Consumes: `applyGameRatings`, `initialRating`, `isProvisional` from `@aichess/core`; `ratings`, `ratingHistory` from `@aichess/db` (Task 2); `RatingSummary` from `@aichess/core/protocol` (Task 1); existing `RatingChanges`, `WireExtras`, `persistTransition`, `Executor`.
- Produces:
  - `interface RatingRecord { agentId: string; rating: number; rd: number; volatility: number; gamesPlayed: number; lastGameAt: number | null }`, `defaultRatingRecord(agentId): RatingRecord`, `toRatingSummary(record): RatingSummary`, `loadRating(ex, agentId): Promise<RatingRecord>` (defaults when no row), `lockRatings(tx, agentIds): Promise<Map<string, RatingRecord>>` (inserts defaults when missing, then `SELECT ... FOR UPDATE` in id order).
  - `interface GameRatingColumns { whiteBefore: number; whiteAfter: number; blackBefore: number; blackAfter: number }` and `PersistOptions.ratings?: GameRatingColumns` in `games/repository.ts`.
  - `interface SettledRatings { changes: RatingChanges; columns: GameRatingColumns }`, `settleRatings(tx, state, now): Promise<SettledRatings | null>` (null unless `state.status === "finished"` with a decisive or drawn result).
  - `NO_RATING_CHANGES: RatingChanges` in `events/wire.ts`.
  - `GameService` gains a private `commitTransition(tx, before, after, events, agents): Promise<WireExtras>` used by every mutation; `afterCommit(state, agents, events, extras: WireExtras)`. Public API unchanged. `game.end` on the agent streams now carries `rating: { before, after }` for rated games.

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/rating/repository.test.ts`:

```ts
import { GLICKO2_DEFAULTS } from "@aichess/core";
import { ratings, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { seedTwoAgents } from "../testing.js";
import { defaultRatingRecord, loadRating, lockRatings, toRatingSummary } from "./repository.js";

describe("rating repository", () => {
  let tdb: TestDatabase;
  let db: Database;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    agents = await seedTwoAgents(db);
  });

  it("reads the Glicko-2 defaults for an agent without a row", async () => {
    const record = await loadRating(db, agents.white.id);
    expect(record).toEqual(defaultRatingRecord(agents.white.id));
    expect(record).toMatchObject({
      rating: GLICKO2_DEFAULTS.rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
      gamesPlayed: 0,
      lastGameAt: null,
    });
    expect(toRatingSummary(record)).toEqual({ rating: 1500, rd: 350, gamesPlayed: 0, provisional: true });
    expect(toRatingSummary({ ...record, rd: 110 })).toMatchObject({ provisional: false });
  });

  it("creates missing rows on lock and returns stored values afterwards", async () => {
    const first = await db.transaction((tx) => lockRatings(tx, [agents.black.id, agents.white.id]));
    expect([...first.keys()].sort()).toEqual([agents.white.id, agents.black.id].sort());
    expect(first.get(agents.white.id)).toEqual(defaultRatingRecord(agents.white.id));

    await db
      .update(ratings)
      .set({ rating: 1650.5, rd: 90, gamesPlayed: 7 })
      .where(eq(ratings.agentId, agents.white.id));
    const second = await db.transaction((tx) => lockRatings(tx, [agents.white.id, agents.black.id]));
    expect(second.get(agents.white.id)).toMatchObject({ rating: 1650.5, rd: 90, gamesPlayed: 7 });
    expect(second.get(agents.black.id)).toEqual(defaultRatingRecord(agents.black.id));
    expect(await db.select().from(ratings)).toHaveLength(2);

    expect(await loadRating(db, agents.white.id)).toMatchObject({ rating: 1650.5, gamesPlayed: 7 });
  });
});
```

Create `packages/runtime/src/rating/settle.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { applyGameRatings, applyResign, applyTimeout, createGame, initialRating, startGame } from "@aichess/core";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS } from "@aichess/core/protocol";
import { ratingHistory, ratings, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { insertGame } from "../games/repository.js";
import { seedTwoAgents } from "../testing.js";
import { settleRatings } from "./settle.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("settleRatings", () => {
  let tdb: TestDatabase;
  let db: Database;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    agents = await seedTwoAgents(db);
  });

  async function startedGame(timePerMoveMs = DEFAULT_GAME_CONFIG.timePerMoveMs): Promise<ReturnType<typeof startGame>> {
    const created = createGame({
      id: randomUUID(),
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
      config: { ...DEFAULT_GAME_CONFIG, timePerMoveMs },
      now: T0,
    });
    await insertGame(db, created);
    return startGame(created, T0);
  }

  it("applies one Glicko-2 period per game to both sides and records history", async () => {
    const { state } = await startedGame();
    const resigned = applyResign(state, agents.white.id, T0 + 5_000);
    if (!resigned.ok) throw new Error(resigned.code);

    const settled = await db.transaction((tx) => settleRatings(tx, resigned.state, T0 + 5_000));
    const expected = applyGameRatings(initialRating(), initialRating(), "0-1");
    if (settled === null || expected === null) throw new Error("expected a rated settlement");

    expect(settled.changes.white?.before).toBe(1500);
    expect(settled.changes.white?.after).toBeCloseTo(expected.white.rating, 6);
    expect(settled.changes.black?.after).toBeCloseTo(expected.black.rating, 6);
    expect(settled.columns).toEqual({
      whiteBefore: 1500,
      whiteAfter: settled.changes.white?.after,
      blackBefore: 1500,
      blackAfter: settled.changes.black?.after,
    });

    const rows = await db.select().from(ratings);
    const white = rows.find((r) => r.agentId === agents.white.id);
    const black = rows.find((r) => r.agentId === agents.black.id);
    expect(white?.rating).toBeCloseTo(expected.white.rating, 6);
    expect(white?.rd).toBeCloseTo(expected.white.rd, 6);
    expect(white?.volatility).toBeCloseTo(expected.white.volatility, 8);
    expect(white?.gamesPlayed).toBe(1);
    expect(white?.lastGameAt?.getTime()).toBe(T0 + 5_000);
    expect(black?.rating).toBeGreaterThan(1500);

    const history = await db.select().from(ratingHistory);
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.agentId === agents.black.id)).toMatchObject({
      gameId: state.id,
      ratingBefore: 1500,
    });
  });

  it("returns null and writes nothing for an aborted game", async () => {
    const { state } = await startedGame(1_000);
    const aborted = applyTimeout(state, T0 + 1_000 + NETWORK_GRACE_MS);
    if (!aborted.ok) throw new Error(aborted.code);
    expect(aborted.state.status).toBe("aborted");
    expect(await db.transaction((tx) => settleRatings(tx, aborted.state, T0 + 2_000))).toBeNull();
    expect(await db.select().from(ratings)).toHaveLength(0);
    expect(await db.select().from(ratingHistory)).toHaveLength(0);
  });

  it("returns null for a game that is still active", async () => {
    const { state } = await startedGame();
    expect(await db.transaction((tx) => settleRatings(tx, state, T0))).toBeNull();
  });
});
```

Append to `packages/runtime/src/games/repository.test.ts`, inside `describe("game repository", ...)`. Extend the import from `@aichess/core` with `applyResign` and the import from `@aichess/db` with `games`.

```ts
it("writes the rating columns of a finished game when asked", async () => {
  const created = fresh();
  await insertGame(db, created);
  const started = startGame(created, T0);
  await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
  const r = applyResign(started.state, agents.black.id, T0 + 5);
  if (!r.ok) throw new Error(r.code);
  await db.transaction((tx) =>
    persistTransition(tx, started.state, r.state, r.events, {
      pgn: "1-0",
      ratings: { whiteBefore: 1500, whiteAfter: 1610.5, blackBefore: 1500, blackAfter: 1389.5 },
    }),
  );
  const [row] = await db.select().from(games).where(eq(games.id, created.id));
  expect(row).toMatchObject({
    status: "finished",
    pgn: "1-0",
    whiteRatingBefore: 1500,
    whiteRatingAfter: 1610.5,
    blackRatingBefore: 1500,
    blackRatingAfter: 1389.5,
  });
});
```

Append to `packages/runtime/src/games/service.test.ts`, inside `describe("GameService", ...)`. Extend the imports: from `@aichess/core` add `import { applyGameRatings, initialRating } from "@aichess/core";` and from `@aichess/db` add `ratingHistory, ratings`.

```ts
describe("ratings", () => {
  async function foolsMate(gameId: string): Promise<void> {
    for (const san of ["f3", "e5", "g4", "Qh4#"]) await play(gameId, san);
  }

  function endEvent(list: WireEvent[]): Extract<WireEvent, { type: "game.end" }> {
    const found = list.find((e) => e.type === "game.end");
    if (found === undefined || found.type !== "game.end") throw new Error("expected game.end");
    return found;
  }

  it("settles both ratings in the finishing transaction and reports them in game.end", async () => {
    const white: WireEvent[] = [];
    const black: WireEvent[] = [];
    const pub: WireEvent[] = [];
    const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
    const offBlack = await bus.subscribeAgent(agents.black.id, (e) => black.push(e));
    const gameId = await newGame();
    const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
    await foolsMate(gameId);

    const expected = applyGameRatings(initialRating(), initialRating(), "0-1");
    if (expected === null) throw new Error("expected a rated result");

    const rows = await db.select().from(ratings);
    const w = rows.find((r) => r.agentId === agents.white.id);
    const b = rows.find((r) => r.agentId === agents.black.id);
    expect(w?.rating).toBeCloseTo(expected.white.rating, 6);
    expect(w?.gamesPlayed).toBe(1);
    expect(w?.lastGameAt?.getTime()).toBe(clock);
    expect(b?.rating).toBeCloseTo(expected.black.rating, 6);

    expect(await db.select().from(ratingHistory).where(eq(ratingHistory.gameId, gameId))).toHaveLength(2);
    const [game] = await db.select().from(games).where(eq(games.id, gameId));
    expect(game?.whiteRatingBefore).toBe(1500);
    expect(game?.whiteRatingAfter).toBeCloseTo(expected.white.rating, 6);
    expect(game?.blackRatingBefore).toBe(1500);
    expect(game?.blackRatingAfter).toBeCloseTo(expected.black.rating, 6);

    await waitFor(
      () =>
        white.some((e) => e.type === "game.end") &&
        black.some((e) => e.type === "game.end") &&
        pub.some((e) => e.type === "game.end"),
    );
    expect(endEvent(white).rating?.before).toBe(1500);
    expect(endEvent(white).rating?.after).toBeCloseTo(expected.white.rating, 6);
    expect(endEvent(black).rating?.before).toBe(1500);
    expect(endEvent(black).rating?.after).toBeCloseTo(expected.black.rating, 6);
    expect(endEvent(pub).rating).toBeNull();

    await offWhite();
    await offBlack();
    await offPublic();
  });

  it("uses the current ratings as the before values of the next game", async () => {
    const first = await newGame();
    await foolsMate(first);
    const second = await newGame();
    const resigned = await service.resign({ gameId: second, agentId: agents.white.id });
    expect(resigned.ok).toBe(true);

    const afterFirst = applyGameRatings(initialRating(), initialRating(), "0-1");
    if (afterFirst === null) throw new Error("expected a rated result");
    const [game] = await db.select().from(games).where(eq(games.id, second));
    expect(game?.whiteRatingBefore).toBeCloseTo(afterFirst.white.rating, 6);
    expect(game?.blackRatingBefore).toBeCloseTo(afterFirst.black.rating, 6);
    const [w] = await db.select().from(ratings).where(eq(ratings.agentId, agents.white.id));
    expect(w?.gamesPlayed).toBe(2);
    expect(await db.select().from(ratingHistory)).toHaveLength(4);
  });

  it("settles a forfeit by illegal moves", async () => {
    const gameId = await newGame();
    for (let i = 0; i < 3; i += 1) {
      const r = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "Ke2" });
      expect(r.ok).toBe(false);
    }
    const [game] = await db.select().from(games).where(eq(games.id, gameId));
    expect(game?.termination).toBe("illegal_moves");
    expect(game?.whiteRatingAfter).toBeLessThan(1500);
    expect(game?.blackRatingAfter).toBeGreaterThan(1500);
  });

  it("leaves ratings untouched when a game is aborted", async () => {
    const r = await service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
      config: { timePerMoveMs: 1_000 },
    });
    if (!r.ok) throw new Error(r.code);
    const white: WireEvent[] = [];
    const off = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
    clock = T0 + 1_000 + NETWORK_GRACE_MS;
    const expired = await service.expireDeadline({ gameId: r.snapshot.id, ply: 0 });
    expect(expired).toMatchObject({ ok: true, applied: true });
    expect(await db.select().from(ratings)).toHaveLength(0);
    expect(await db.select().from(ratingHistory)).toHaveLength(0);
    const [game] = await db.select().from(games).where(eq(games.id, r.snapshot.id));
    expect(game?.whiteRatingAfter).toBeNull();
    await waitFor(() => white.some((e) => e.type === "game.end"));
    expect(endEvent(white)).toMatchObject({ termination: "aborted", rating: null });
    await off();
  });
});
```

- [ ] **Step 2: Run the runtime tests to verify the new ones fail**

Run: `pnpm --filter @aichess/runtime test`
Expected: the new files fail to import (`./repository.js`, `./settle.js` missing); the repository test fails on `whiteRatingBefore: null`; the service ratings tests fail on empty `ratings` rows and `rating: null`. Everything else passes.

- [ ] **Step 3: Add the rating repository**

Create `packages/runtime/src/rating/repository.ts`:

```ts
import { initialRating, isProvisional } from "@aichess/core";
import type { RatingSummary } from "@aichess/core/protocol";
import { ratings, type Transaction } from "@aichess/db";
import { asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../games/repository.js";

export interface RatingRecord {
  agentId: string;
  rating: number;
  rd: number;
  volatility: number;
  gamesPlayed: number;
  lastGameAt: number | null;
}

type RatingRow = typeof ratings.$inferSelect;

export function defaultRatingRecord(agentId: string): RatingRecord {
  return { agentId, ...initialRating(), gamesPlayed: 0, lastGameAt: null };
}

export function toRatingSummary(record: RatingRecord): RatingSummary {
  return {
    rating: record.rating,
    rd: record.rd,
    gamesPlayed: record.gamesPlayed,
    provisional: isProvisional(record),
  };
}

function rowToRecord(row: RatingRow): RatingRecord {
  return {
    agentId: row.agentId,
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    gamesPlayed: row.gamesPlayed,
    lastGameAt: row.lastGameAt === null ? null : row.lastGameAt.getTime(),
  };
}

export async function loadRating(ex: Executor, agentId: string): Promise<RatingRecord> {
  const [row] = await ex.select().from(ratings).where(eq(ratings.agentId, agentId));
  return row === undefined ? defaultRatingRecord(agentId) : rowToRecord(row);
}

export async function lockRatings(tx: Transaction, agentIds: string[]): Promise<Map<string, RatingRecord>> {
  const ordered = [...new Set(agentIds)].sort();
  if (ordered.length === 0) return new Map();
  await tx
    .insert(ratings)
    .values(
      ordered.map((agentId) => {
        const record = defaultRatingRecord(agentId);
        return { agentId, rating: record.rating, rd: record.rd, volatility: record.volatility };
      }),
    )
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(ratings)
    .where(inArray(ratings.agentId, ordered))
    .orderBy(asc(ratings.agentId))
    .for("update");
  return new Map(rows.map((row) => [row.agentId, rowToRecord(row)]));
}
```

- [ ] **Step 4: Add the rating columns to `persistTransition`**

In `packages/runtime/src/games/repository.ts` replace the `PersistOptions` interface with:

```ts
export interface GameRatingColumns {
  whiteBefore: number;
  whiteAfter: number;
  blackBefore: number;
  blackAfter: number;
}

export interface PersistOptions {
  pgn?: string | null;
  ratings?: GameRatingColumns;
}
```

and in `persistTransition`, inside `.set({ ... })`, after the `pgn` spread add:

```ts
      ...(options.ratings === undefined
        ? {}
        : {
            whiteRatingBefore: options.ratings.whiteBefore,
            whiteRatingAfter: options.ratings.whiteAfter,
            blackRatingBefore: options.ratings.blackBefore,
            blackRatingAfter: options.ratings.blackAfter,
          }),
```

- [ ] **Step 5: Add the settlement**

Create `packages/runtime/src/rating/settle.ts`:

```ts
import { applyGameRatings, type GameState } from "@aichess/core";
import { ratingHistory, ratings, type Transaction } from "@aichess/db";
import { eq } from "drizzle-orm";
import type { RatingChanges } from "../events/wire.js";
import type { GameRatingColumns } from "../games/repository.js";
import { lockRatings } from "./repository.js";

export interface SettledRatings {
  changes: RatingChanges;
  columns: GameRatingColumns;
}

export async function settleRatings(tx: Transaction, state: GameState, now: number): Promise<SettledRatings | null> {
  if (state.status !== "finished" || state.result === null) return null;
  const locked = await lockRatings(tx, [state.whiteAgentId, state.blackAgentId]);
  const white = locked.get(state.whiteAgentId);
  const black = locked.get(state.blackAgentId);
  if (white === undefined || black === undefined) {
    throw new Error(`ratings missing for game ${state.id}`);
  }
  const next = applyGameRatings(white, black, state.result);
  if (next === null) return null;

  const at = new Date(now);
  for (const [record, updated] of [
    [white, next.white],
    [black, next.black],
  ] as const) {
    await tx
      .update(ratings)
      .set({
        rating: updated.rating,
        rd: updated.rd,
        volatility: updated.volatility,
        gamesPlayed: record.gamesPlayed + 1,
        lastGameAt: at,
        updatedAt: at,
      })
      .where(eq(ratings.agentId, record.agentId));
  }
  await tx.insert(ratingHistory).values([
    {
      agentId: white.agentId,
      gameId: state.id,
      ratingBefore: white.rating,
      ratingAfter: next.white.rating,
      rdAfter: next.white.rd,
    },
    {
      agentId: black.agentId,
      gameId: state.id,
      ratingBefore: black.rating,
      ratingAfter: next.black.rating,
      rdAfter: next.black.rd,
    },
  ]);
  return {
    changes: {
      white: { before: white.rating, after: next.white.rating },
      black: { before: black.rating, after: next.black.rating },
    },
    columns: {
      whiteBefore: white.rating,
      whiteAfter: next.white.rating,
      blackBefore: black.rating,
      blackAfter: next.black.rating,
    },
  };
}
```

In `packages/runtime/src/events/wire.ts`, after the `RatingChanges` interface add:

```ts
export const NO_RATING_CHANGES: RatingChanges = { white: null, black: null };
```

- [ ] **Step 6: Route every game-ending transition through one commit path**

Replace `packages/runtime/src/games/service.ts` with the following. The public types and methods are unchanged; `pgnIfOver` disappears into `commitTransition`, which also settles ratings, and `afterCommit` receives the resulting `WireExtras`.

```ts
import { randomUUID } from "node:crypto";
import {
  applyMove,
  applyResign,
  applyTimeout,
  createGame,
  sideToMove,
  startGame,
  toPgn,
  type DomainEvent,
  type GameState,
} from "@aichess/core";
import type { GameConfig, GameSnapshot, IllegalReason, LegalMove, WireEvent } from "@aichess/core/protocol";
import type { Database, Transaction } from "@aichess/db";
import type { EventBus, GameParties } from "../events/bus.js";
import {
  NO_RATING_CHANGES,
  toSnapshot,
  toWireEvents,
  toYourTurn,
  type GameAgents,
  type Outgoing,
  type WireExtras,
} from "../events/wire.js";
import { deadlineFireAt, deadlineJobId, scheduleDeadline, type DeadlineQueue } from "../jobs/deadlines.js";
import type { RuntimeLogger } from "../logger.js";
import { settleRatings } from "../rating/settle.js";
import {
  findActiveGameIdForAgent,
  insertGame,
  listActiveDeadlines,
  loadAgentSummaries,
  loadGame,
  loadGameForUpdate,
  persistTransition,
  type Executor,
} from "./repository.js";

export interface GameServiceDeps {
  db: Database;
  bus: EventBus;
  deadlines: DeadlineQueue;
  config: GameConfig;
  logger: RuntimeLogger;
  now?: () => number;
  newId?: () => string;
}

export interface CreateGameInput {
  whiteAgentId: string;
  blackAgentId: string;
  config?: Partial<GameConfig>;
}

export type CreateGameResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "agents_not_found" };

export interface SubmitMoveInput {
  gameId: string;
  agentId: string;
  ply: number;
  move: string;
  comment?: string | null;
}

export type SubmitMoveResult =
  | { ok: true; idempotent: boolean; snapshot: GameSnapshot }
  | { ok: false; code: "not_found" | "game_not_active" | "not_your_turn" | "stale_ply" }
  | {
      ok: false;
      code: "illegal_move";
      reason: IllegalReason;
      attemptsLeft: number;
      legalMoves: LegalMove[];
      snapshot: GameSnapshot;
    };

export interface ResignInput {
  gameId: string;
  agentId: string;
}

export type ResignResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "not_found" | "game_not_active" };

export interface ExpireInput {
  gameId: string;
  ply: number;
}

export type ExpireResult =
  | { ok: true; applied: true; snapshot: GameSnapshot }
  | { ok: true; applied: false; reason: "stale_ply" | "not_active" }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "deadline_not_reached"; fireAt: number };

export interface ReconcileInput {
  staleTurnMs: number;
}

export interface ReconcileReport {
  scanned: number;
  republished: number;
  rescheduled: number;
}

type PostCommit = () => Promise<void>;

interface TxOutcome<T> {
  result: T;
  postCommit: PostCommit | null;
}

function partiesOf(state: GameState): GameParties {
  return { gameId: state.id, whiteAgentId: state.whiteAgentId, blackAgentId: state.blackAgentId };
}

function isOver(state: GameState): boolean {
  return state.status === "finished" || state.status === "aborted";
}

export class GameService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: GameServiceDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    this.newId = deps.newId ?? ((): string => randomUUID());
  }

  async createAndStartGame(input: CreateGameInput): Promise<CreateGameResult> {
    const agents = await loadAgentSummaries(this.deps.db, input.whiteAgentId, input.blackAgentId);
    if (agents === null) return { ok: false, code: "agents_not_found" };

    const now = this.now();
    const config: GameConfig = { ...this.deps.config, ...input.config };
    const created = createGame({
      id: this.newId(),
      whiteAgentId: input.whiteAgentId,
      blackAgentId: input.blackAgentId,
      config,
      now,
    });
    const started = startGame(created, now);
    const extras = await this.deps.db.transaction(async (tx) => {
      await insertGame(tx, created);
      return this.commitTransition(tx, created, started.state, started.events, agents);
    });
    await this.afterCommit(started.state, agents, started.events, extras);
    return { ok: true, snapshot: toSnapshot(started.state, agents) };
  }

  async getSnapshot(gameId: string, viewerAgentId?: string): Promise<GameSnapshot | null> {
    const state = await loadGame(this.deps.db, gameId);
    if (state === null) return null;
    const agents = await this.agentsOf(this.deps.db, state);
    return toSnapshot(state, agents, viewerAgentId);
  }

  async submitMove(input: SubmitMoveInput): Promise<SubmitMoveResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<SubmitMoveResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      const agents = await this.agentsOf(tx, state);
      const r = applyMove(state, {
        agentId: input.agentId,
        ply: input.ply,
        move: input.move,
        comment: input.comment,
        now: this.now(),
      });

      if (r.ok) {
        if (r.idempotent) {
          return {
            result: { ok: true, idempotent: true, snapshot: toSnapshot(r.state, agents, input.agentId) },
            postCommit: null,
          };
        }
        const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
        return {
          result: { ok: true, idempotent: false, snapshot: toSnapshot(r.state, agents, input.agentId) },
          postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
        };
      }

      if (r.code === "illegal_move") {
        const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
        return {
          result: {
            ok: false,
            code: "illegal_move",
            reason: r.reason,
            attemptsLeft: r.attemptsLeft,
            legalMoves: r.legalMoves,
            snapshot: toSnapshot(r.state, agents, input.agentId),
          },
          postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
        };
      }

      const code = r.code === "not_a_player" ? "not_found" : r.code;
      return { result: { ok: false, code }, postCommit: null };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async resign(input: ResignInput): Promise<ResignResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<ResignResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      const agents = await this.agentsOf(tx, state);
      const r = applyResign(state, input.agentId, this.now());
      if (!r.ok) {
        const code = r.code === "not_a_player" ? "not_found" : "game_not_active";
        return { result: { ok: false, code }, postCommit: null };
      }
      const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
      return {
        result: { ok: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
      };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async expireDeadline(input: ExpireInput): Promise<ExpireResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<ExpireResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      if (state.status !== "active" || state.moveDeadlineAt === null) {
        return { result: { ok: true, applied: false, reason: "not_active" }, postCommit: null };
      }
      if (state.ply !== input.ply) {
        return { result: { ok: true, applied: false, reason: "stale_ply" }, postCommit: null };
      }
      const r = applyTimeout(state, this.now());
      if (!r.ok) {
        if (r.code === "deadline_not_reached") {
          return {
            result: { ok: false, code: "deadline_not_reached", fireAt: deadlineFireAt(state.moveDeadlineAt) },
            postCommit: null,
          };
        }
        return { result: { ok: true, applied: false, reason: "not_active" }, postCommit: null };
      }
      const agents = await this.agentsOf(tx, state);
      const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
      return {
        result: { ok: true, applied: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
      };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async rearmActiveDeadlines(): Promise<number> {
    const rows = await listActiveDeadlines(this.deps.db);
    const now = this.now();
    for (const row of rows) {
      await scheduleDeadline(this.deps.deadlines, { gameId: row.gameId, ply: row.ply }, row.moveDeadlineAt, now);
    }
    if (rows.length > 0) {
      this.deps.logger.info({ count: rows.length }, "deadlines re-armed");
    }
    return rows.length;
  }

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

  private async agentsOf(ex: Executor, state: GameState): Promise<GameAgents> {
    const agents = await loadAgentSummaries(ex, state.whiteAgentId, state.blackAgentId);
    if (agents === null) {
      throw new Error(`agents missing for game ${state.id}`);
    }
    return agents;
  }

  private async commitTransition(
    tx: Transaction,
    before: GameState,
    after: GameState,
    events: DomainEvent[],
    agents: GameAgents,
  ): Promise<WireExtras> {
    if (!isOver(after)) {
      await persistTransition(tx, before, after, events, {});
      return { pgn: null, ratings: NO_RATING_CHANGES };
    }
    const pgn = toPgn(after, {
      white: agents.white.name,
      black: agents.black.name,
      date: new Date(after.startedAt ?? after.createdAt),
    });
    const settled = await settleRatings(tx, after, this.now());
    await persistTransition(tx, before, after, events, settled === null ? { pgn } : { pgn, ratings: settled.columns });
    return { pgn, ratings: settled === null ? NO_RATING_CHANGES : settled.changes };
  }

  private async afterCommit(
    state: GameState,
    agents: GameAgents,
    events: DomainEvent[],
    extras: WireExtras,
  ): Promise<void> {
    const outgoing = toWireEvents(state, agents, events, extras);
    try {
      await this.deps.bus.publish(partiesOf(state), outgoing);
    } catch (error) {
      this.deps.logger.error({ gameId: state.id, error }, "game_events_publish_failed");
    }
    for (const event of events) {
      if (event.type !== "turn") continue;
      try {
        await scheduleDeadline(this.deps.deadlines, { gameId: state.id, ply: event.ply }, event.deadlineAt, this.now());
      } catch (error) {
        this.deps.logger.error({ gameId: state.id, ply: event.ply, error }, "deadline_schedule_failed");
      }
    }
  }
}
```

Append to `packages/runtime/src/index.ts`:

```ts
export * from "./rating/repository.js";
export * from "./rating/settle.js";
```

- [ ] **Step 7: Run the runtime tests to verify they pass**

Run: `pnpm --filter @aichess/runtime test`
Expected: PASS. The `moveDeadlineAt` test in `service.test.ts` for `createAndStartGame` still passes: the game is not over, so no rating rows are touched.

- [ ] **Step 8: Verify and commit**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green across the workspace (`toWireEvents` callers in the api are unchanged).

```bash
git add packages/runtime/src/rating packages/runtime/src/games/repository.ts packages/runtime/src/games/repository.test.ts packages/runtime/src/games/service.ts packages/runtime/src/games/service.test.ts packages/runtime/src/events/wire.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): settle Glicko-2 ratings in the finishing transaction"
```

---

### Task 4: Matchmaking queue on Redis

**Files:**

- Create: `packages/runtime/src/matchmaking/queue.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/matchmaking/queue.test.ts`

**Interfaces:**

- Consumes: `Redis` from ioredis, `createRedis` and `startTestRedis` from runtime.
- Produces: `QUEUE_KEY = "mm:queue"`, `QUEUE_META_KEY = "mm:meta"`, `interface QueueEntry { agentId: string; rating: number; queuedAt: number }` (`queuedAt` in epoch ms), and

  ```ts
  class MatchmakingQueue {
    constructor(redis: Redis);
    join(agentId: string, rating: number, queuedAt: number): Promise<boolean>; // false when already queued
    leave(agentId: string): Promise<{ queuedAt: number } | null>; // null when not queued
    removePair(a: string, b: string): Promise<boolean>; // true only when both were queued
    status(agentId: string): Promise<{ queuedAt: number } | null>;
    entries(): Promise<QueueEntry[]>; // ascending rating
    size(): Promise<number>;
    clear(): Promise<void>;
  }
  ```

  Every write is one Lua script, so concurrent joins, leaves and pair removals never leave the set and the hash out of step.

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/matchmaking/queue.test.ts`:

```ts
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { MatchmakingQueue, QUEUE_KEY, QUEUE_META_KEY } from "./queue.js";

describe("MatchmakingQueue", () => {
  let container: TestRedis;
  let redis: Redis;
  let queue: MatchmakingQueue;

  beforeAll(async () => {
    container = await startTestRedis();
    redis = createRedis(container.url);
    await redis.connect();
    queue = new MatchmakingQueue(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await queue.clear();
  });

  it("joins once per agent and lists entries by rating", async () => {
    expect(await queue.join("a", 1500, 10)).toBe(true);
    expect(await queue.join("a", 1600, 11)).toBe(false);
    expect(await queue.join("b", 1400, 12)).toBe(true);
    expect(await queue.entries()).toEqual([
      { agentId: "b", rating: 1400, queuedAt: 12 },
      { agentId: "a", rating: 1500, queuedAt: 10 },
    ]);
    expect(await queue.size()).toBe(2);
    expect(await queue.status("a")).toEqual({ queuedAt: 10 });
    expect(await queue.status("nobody")).toBeNull();
  });

  it("leaves with the original queuedAt and refuses a second leave", async () => {
    await queue.join("a", 1500, 10);
    expect(await queue.leave("a")).toEqual({ queuedAt: 10 });
    expect(await queue.leave("a")).toBeNull();
    expect(await queue.status("a")).toBeNull();
    expect(await redis.hlen(QUEUE_META_KEY)).toBe(0);
    expect(await redis.zcard(QUEUE_KEY)).toBe(0);
  });

  it("removes a pair only while both are still queued", async () => {
    await queue.join("a", 1500, 1);
    await queue.join("b", 1500, 2);
    expect(await queue.removePair("a", "c")).toBe(false);
    expect(await queue.entries()).toHaveLength(2);
    expect(await queue.removePair("a", "b")).toBe(true);
    expect(await queue.size()).toBe(0);
    expect(await queue.removePair("a", "b")).toBe(false);
  });

  it("clears everything", async () => {
    await queue.join("a", 1500, 1);
    await queue.clear();
    expect(await queue.entries()).toEqual([]);
    expect(await redis.exists(QUEUE_KEY, QUEUE_META_KEY)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aichess/runtime test src/matchmaking/queue.test.ts`
Expected: FAIL, `./queue.js` cannot be resolved.

- [ ] **Step 3: Implement the queue**

Create `packages/runtime/src/matchmaking/queue.ts`:

```ts
import type { Redis } from "ioredis";

export const QUEUE_KEY = "mm:queue";
export const QUEUE_META_KEY = "mm:meta";

export interface QueueEntry {
  agentId: string;
  rating: number;
  queuedAt: number;
}

export interface QueueMembership {
  queuedAt: number;
}

const JOIN_SCRIPT = `
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
return 1`;

const LEAVE_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return {0, ""} end
local queuedAt = redis.call("HGET", KEYS[2], ARGV[1]) or ""
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
return {1, queuedAt}`;

const REMOVE_PAIR_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
if not redis.call("ZSCORE", KEYS[1], ARGV[2]) then return 0 end
redis.call("ZREM", KEYS[1], ARGV[1], ARGV[2])
redis.call("HDEL", KEYS[2], ARGV[1], ARGV[2])
return 1`;

function parseQueuedAt(agentId: string, raw: string | null | undefined): number {
  const value = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`queue metadata missing or corrupt for agent ${agentId}`);
  }
  return value;
}

export class MatchmakingQueue {
  constructor(private readonly redis: Redis) {}

  async join(agentId: string, rating: number, queuedAt: number): Promise<boolean> {
    const added = await this.redis.eval(
      JOIN_SCRIPT,
      2,
      QUEUE_KEY,
      QUEUE_META_KEY,
      agentId,
      String(rating),
      String(queuedAt),
    );
    return added === 1;
  }

  async leave(agentId: string): Promise<QueueMembership | null> {
    const result = (await this.redis.eval(LEAVE_SCRIPT, 2, QUEUE_KEY, QUEUE_META_KEY, agentId)) as [number, string];
    if (result[0] !== 1) return null;
    return { queuedAt: parseQueuedAt(agentId, result[1]) };
  }

  async removePair(a: string, b: string): Promise<boolean> {
    const removed = await this.redis.eval(REMOVE_PAIR_SCRIPT, 2, QUEUE_KEY, QUEUE_META_KEY, a, b);
    return removed === 1;
  }

  async status(agentId: string): Promise<QueueMembership | null> {
    const [score, raw] = await Promise.all([
      this.redis.zscore(QUEUE_KEY, agentId),
      this.redis.hget(QUEUE_META_KEY, agentId),
    ]);
    if (score === null) return null;
    return { queuedAt: parseQueuedAt(agentId, raw) };
  }

  async entries(): Promise<QueueEntry[]> {
    const [members, meta] = await Promise.all([
      this.redis.zrange(QUEUE_KEY, 0, -1, "WITHSCORES"),
      this.redis.hgetall(QUEUE_META_KEY),
    ]);
    const out: QueueEntry[] = [];
    for (let i = 0; i + 1 < members.length; i += 2) {
      const agentId = members[i];
      const score = members[i + 1];
      if (agentId === undefined || score === undefined) continue;
      out.push({ agentId, rating: Number(score), queuedAt: parseQueuedAt(agentId, meta[agentId]) });
    }
    return out;
  }

  async size(): Promise<number> {
    return this.redis.zcard(QUEUE_KEY);
  }

  async clear(): Promise<void> {
    await this.redis.del(QUEUE_KEY, QUEUE_META_KEY);
  }
}
```

Append to `packages/runtime/src/index.ts`:

```ts
export * from "./matchmaking/queue.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @aichess/runtime test src/matchmaking/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @aichess/runtime lint && pnpm --filter @aichess/runtime typecheck && pnpm format:check`
Expected: green.

```bash
git add packages/runtime/src/matchmaking/queue.ts packages/runtime/src/matchmaking/queue.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): matchmaking queue on Redis with atomic join, leave and pair removal"
```

---

### Task 5: Pairing by rating window with colour alternation

**Files:**

- Create: `packages/runtime/src/matchmaking/pairing.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/matchmaking/pairing.test.ts`

**Interfaces:**

- Consumes: `opponentOf` from `@aichess/core`, `Color` from `@aichess/core/protocol`.
- Produces (pure, no I/O):
  - `interface PairingWindow { initial: number; growth: number; stepMs: number; max: number }`, `DEFAULT_PAIRING_WINDOW = { initial: 150, growth: 100, stepMs: 10_000, max: 1_000 }`.
  - `interface Candidate { agentId: string; ownerId: string; rating: number; queuedAt: number; lastColor: Color | null }`, `interface Pair { white: Candidate; black: Candidate }`.
  - `windowFor(waitMs: number, window?: PairingWindow): number`.
  - `chooseColors(seeker: Candidate, other: Candidate): Pair`.
  - `pairCandidates(candidates: Candidate[], now: number, window?: PairingWindow): Pair[]`.

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/matchmaking/pairing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PAIRING_WINDOW, chooseColors, pairCandidates, windowFor, type Candidate } from "./pairing.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

function candidate(overrides: Partial<Candidate> & { agentId: string }): Candidate {
  return {
    ownerId: `owner-${overrides.agentId}`,
    rating: 1500,
    queuedAt: T0,
    lastColor: null,
    ...overrides,
  };
}

function ids(pairs: ReturnType<typeof pairCandidates>): Array<[string, string]> {
  return pairs.map((p) => [p.white.agentId, p.black.agentId]);
}

describe("windowFor", () => {
  it("starts at the initial width and grows by one step every stepMs, capped at max", () => {
    expect(windowFor(0)).toBe(150);
    expect(windowFor(9_999)).toBe(150);
    expect(windowFor(10_000)).toBe(250);
    expect(windowFor(35_000)).toBe(450);
    expect(windowFor(120_000)).toBe(1_000);
    expect(windowFor(-5)).toBe(150);
    expect(windowFor(20_000, { initial: 50, growth: 10, stepMs: 5_000, max: 75 })).toBe(75);
    expect(DEFAULT_PAIRING_WINDOW).toEqual({ initial: 150, growth: 100, stepMs: 10_000, max: 1_000 });
  });
});

describe("chooseColors", () => {
  it("gives white to the seeker when neither has played", () => {
    const pair = chooseColors(candidate({ agentId: "a" }), candidate({ agentId: "b" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["a", "b"]);
  });

  it("alternates the seeker's colour with its previous game", () => {
    const pair = chooseColors(candidate({ agentId: "a", lastColor: "white" }), candidate({ agentId: "b" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["b", "a"]);
  });

  it("honours the other agent's alternation when the seeker has no history", () => {
    const pair = chooseColors(candidate({ agentId: "a" }), candidate({ agentId: "b", lastColor: "black" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["b", "a"]);
  });

  it("lets the seeker win a conflict", () => {
    const pair = chooseColors(
      candidate({ agentId: "a", lastColor: "black" }),
      candidate({ agentId: "b", lastColor: "black" }),
    );
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["a", "b"]);
  });
});

describe("pairCandidates", () => {
  it("returns nothing for an empty or single-entry queue", () => {
    expect(pairCandidates([], T0)).toEqual([]);
    expect(pairCandidates([candidate({ agentId: "a" })], T0)).toEqual([]);
  });

  it("pairs two agents inside the initial window", () => {
    const pairs = pairCandidates([candidate({ agentId: "a" }), candidate({ agentId: "b", rating: 1640 })], T0);
    expect(ids(pairs)).toEqual([["a", "b"]]);
  });

  it("does not pair agents outside the window, and widens the window with the wait", () => {
    const queue = [candidate({ agentId: "a" }), candidate({ agentId: "b", rating: 1900 })];
    expect(pairCandidates(queue, T0)).toEqual([]);
    expect(pairCandidates(queue, T0 + 20_000)).toEqual([]);
    expect(ids(pairCandidates(queue, T0 + 30_000))).toEqual([["a", "b"]]);
  });

  it("never pairs two agents of the same owner", () => {
    const queue = [
      candidate({ agentId: "a", ownerId: "same" }),
      candidate({ agentId: "b", ownerId: "same" }),
      candidate({ agentId: "c", ownerId: "other", queuedAt: T0 + 1 }),
    ];
    expect(ids(pairCandidates(queue, T0))).toEqual([["a", "c"]]);
  });

  it("serves the longest wait first and picks the closest rating", () => {
    const queue = [
      candidate({ agentId: "late", rating: 1500, queuedAt: T0 + 5_000 }),
      candidate({ agentId: "early", rating: 1500, queuedAt: T0 }),
      candidate({ agentId: "near", rating: 1520, queuedAt: T0 + 6_000 }),
      candidate({ agentId: "far", rating: 1600, queuedAt: T0 + 7_000 }),
    ];
    expect(ids(pairCandidates(queue, T0 + 10_000))).toEqual([
      ["early", "late"],
      ["near", "far"],
    ]);
  });

  it("uses the seeker's window, so a long wait reaches a fresh entry", () => {
    const queue = [
      candidate({ agentId: "patient", rating: 1500, queuedAt: T0 }),
      candidate({ agentId: "fresh", rating: 1800, queuedAt: T0 + 40_000 }),
    ];
    expect(ids(pairCandidates(queue, T0 + 40_000))).toEqual([["patient", "fresh"]]);
  });

  it("pairs each agent at most once per round", () => {
    const queue = ["a", "b", "c"].map((agentId, i) => candidate({ agentId, queuedAt: T0 + i }));
    const pairs = pairCandidates(queue, T0);
    expect(pairs).toHaveLength(1);
    expect(ids(pairs)).toEqual([["a", "b"]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aichess/runtime test src/matchmaking/pairing.test.ts`
Expected: FAIL, `./pairing.js` cannot be resolved.

- [ ] **Step 3: Implement the pairing**

Create `packages/runtime/src/matchmaking/pairing.ts`:

```ts
import { opponentOf } from "@aichess/core";
import type { Color } from "@aichess/core/protocol";

export interface PairingWindow {
  initial: number;
  growth: number;
  stepMs: number;
  max: number;
}

export const DEFAULT_PAIRING_WINDOW: PairingWindow = { initial: 150, growth: 100, stepMs: 10_000, max: 1_000 };

export interface Candidate {
  agentId: string;
  ownerId: string;
  rating: number;
  queuedAt: number;
  lastColor: Color | null;
}

export interface Pair {
  white: Candidate;
  black: Candidate;
}

export function windowFor(waitMs: number, window: PairingWindow = DEFAULT_PAIRING_WINDOW): number {
  const steps = Math.floor(Math.max(0, waitMs) / window.stepMs);
  return Math.min(window.max, window.initial + window.growth * steps);
}

function preferredColor(candidate: Candidate): Color | null {
  return candidate.lastColor === null ? null : opponentOf(candidate.lastColor);
}

export function chooseColors(seeker: Candidate, other: Candidate): Pair {
  const seekerWants = preferredColor(seeker);
  const otherWants = preferredColor(other);
  let seekerColor: Color;
  if (seekerWants !== null) seekerColor = seekerWants;
  else if (otherWants !== null) seekerColor = opponentOf(otherWants);
  else seekerColor = "white";
  return seekerColor === "white" ? { white: seeker, black: other } : { white: other, black: seeker };
}

function byWait(a: Candidate, b: Candidate): number {
  return a.queuedAt - b.queuedAt || a.agentId.localeCompare(b.agentId);
}

export function pairCandidates(
  candidates: Candidate[],
  now: number,
  window: PairingWindow = DEFAULT_PAIRING_WINDOW,
): Pair[] {
  const sorted = [...candidates].sort(byWait);
  const taken = new Set<string>();
  const pairs: Pair[] = [];
  for (const seeker of sorted) {
    if (taken.has(seeker.agentId)) continue;
    const width = windowFor(now - seeker.queuedAt, window);
    let best: { candidate: Candidate; distance: number } | null = null;
    for (const other of sorted) {
      if (other.agentId === seeker.agentId || taken.has(other.agentId) || other.ownerId === seeker.ownerId) continue;
      const distance = Math.abs(seeker.rating - other.rating);
      if (distance > width) continue;
      if (best === null || distance < best.distance) {
        best = { candidate: other, distance };
      }
    }
    if (best === null) continue;
    taken.add(seeker.agentId);
    taken.add(best.candidate.agentId);
    pairs.push(chooseColors(seeker, best.candidate));
  }
  return pairs;
}
```

Ties on distance keep the first candidate met, which is the longer wait because `sorted` is in wait order.

Append to `packages/runtime/src/index.ts`:

```ts
export * from "./matchmaking/pairing.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @aichess/runtime test src/matchmaking/pairing.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @aichess/runtime lint && pnpm --filter @aichess/runtime typecheck && pnpm format:check`
Expected: green.

```bash
git add packages/runtime/src/matchmaking/pairing.ts packages/runtime/src/matchmaking/pairing.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): pairing by rating window with colour alternation"
```

---

### Task 6: Matchmaking service, queue events, presence key in runtime, runtime wiring

**Files:**

- Create: `packages/runtime/src/presence.ts`
- Create: `packages/runtime/src/matchmaking/service.ts`
- Modify: `packages/runtime/src/events/bus.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Modify: `packages/runtime/src/testing.ts`
- Modify: `packages/runtime/src/index.ts`
- Modify: `apps/api/src/deps.ts`
- Modify: `apps/api/src/sse/agent-streams.ts`
- Modify: `apps/api/src/sse/agent-streams.test.ts`
- Test: `packages/runtime/src/matchmaking/service.test.ts`

**Interfaces:**

- Consumes: `MatchmakingQueue` (Task 4), `loadRating` (Task 3), `findActiveGameIdForAgent`, `EventBus`.
- Produces:
  - `presenceKeyFor(agentId: string): string` in `@aichess/runtime` (`presence:agent:{id}`); the api imports it from there.
  - `EventBus.publishToAgent(agentId: string, event: WireEvent): Promise<void>`.
  - `type JoinQueueResult = { ok: true; queuedAt: number } | { ok: false; code: "already_in_queue" | "in_active_game" }`, `type LeaveQueueResult = { ok: true; queuedAt: number } | { ok: false; code: "not_in_queue" }`, `toQueueStatus(membership: QueueMembership): QueueStatus` and
    ```ts
    class MatchmakingService {
      constructor(deps: {
        db: Database;
        queue: MatchmakingQueue;
        bus: EventBus;
        logger: RuntimeLogger;
        now?: () => number;
      });
      join(agentId: string): Promise<JoinQueueResult>; // publishes queue.joined
      leave(agentId: string): Promise<LeaveQueueResult>; // publishes queue.left
      status(agentId: string): Promise<QueueMembership | null>;
    }
    ```
  - `RuntimeHandle` gains `queue: MatchmakingQueue` and `matchmaking: MatchmakingService`; `AppDeps` inherits them.
  - `seedTwoAgents(db, options?: { owners?: "shared" | "distinct" })`, default `"shared"` (current behaviour).

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/matchmaking/service.test.ts`:

```ts
import { DEFAULT_GAME_CONFIG, type WireEvent } from "@aichess/core/protocol";
import { ratings } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { MatchmakingService, toQueueStatus } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("MatchmakingService", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let agents: GameAgents;
  let clock: number;
  let service: MatchmakingService;

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
    await runtime.queue.clear();
    await runtime.deadlines.obliterate({ force: true });
    agents = await seedTwoAgents(runtime.db, { owners: "distinct" });
    clock = T0;
    service = new MatchmakingService({
      db: runtime.db,
      queue: runtime.queue,
      bus: runtime.bus,
      logger: noopLogger,
      now: () => clock,
    });
  });

  it("joins, publishes queue.joined and refuses a second join", async () => {
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    expect(await service.join(agents.white.id)).toEqual({ ok: true, queuedAt: T0 });
    clock = T0 + 1_000;
    expect(await service.join(agents.white.id)).toEqual({ ok: false, code: "already_in_queue" });
    expect(await service.status(agents.white.id)).toEqual({ queuedAt: T0 });
    expect(await runtime.queue.entries()).toEqual([{ agentId: agents.white.id, rating: 1500, queuedAt: T0 }]);
    await waitFor(() => events.length === 1);
    expect(events[0]).toEqual({ type: "queue.joined", queuedAt: new Date(T0).toISOString() });
    await off();
  });

  it("uses the stored rating as the queue score", async () => {
    await runtime.db.insert(ratings).values({ agentId: agents.black.id, rating: 1720.5, rd: 60, volatility: 0.06 });
    expect((await service.join(agents.black.id)).ok).toBe(true);
    expect(await runtime.queue.entries()).toEqual([{ agentId: agents.black.id, rating: 1720.5, queuedAt: T0 }]);
  });

  it("refuses an agent that is playing", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    expect(created.ok).toBe(true);
    expect(await service.join(agents.white.id)).toEqual({ ok: false, code: "in_active_game" });
    expect(await runtime.queue.size()).toBe(0);
  });

  it("leaves, publishes queue.left and refuses a second leave", async () => {
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    await service.join(agents.white.id);
    clock = T0 + 5_000;
    expect(await service.leave(agents.white.id)).toEqual({ ok: true, queuedAt: T0 });
    expect(await service.leave(agents.white.id)).toEqual({ ok: false, code: "not_in_queue" });
    expect(await service.status(agents.white.id)).toBeNull();
    await waitFor(() => events.length === 2);
    expect(events.map((e) => e.type)).toEqual(["queue.joined", "queue.left"]);
    expect(events[1]).toEqual({ type: "queue.left", queuedAt: new Date(T0).toISOString() });
    await off();
  });

  it("formats a membership for the wire", () => {
    expect(toQueueStatus({ queuedAt: T0 })).toEqual({ queuedAt: "2026-09-03T10:00:00.000Z" });
  });
});
```

Append to `packages/runtime/src/games/repository.test.ts` a test for the seeding option, inside `describe("game repository", ...)` (it is the closest existing suite with a database):

```ts
it("can seed two agents with distinct owners", async () => {
  const shared = await seedTwoAgents(db);
  const distinct = await seedTwoAgents(db, { owners: "distinct" });
  const owners = await loadAgentSummaries(db, distinct.white.id, distinct.black.id);
  expect(owners).not.toBeNull();
  const rows = await db.query.agents.findMany({
    where: (t, { inArray }) => inArray(t.id, [shared.white.id, shared.black.id, distinct.white.id, distinct.black.id]),
  });
  const ownerOf = (id: string): string | undefined => rows.find((r) => r.id === id)?.ownerId;
  expect(ownerOf(shared.white.id)).toBe(ownerOf(shared.black.id));
  expect(ownerOf(distinct.white.id)).not.toBe(ownerOf(distinct.black.id));
});
```

- [ ] **Step 2: Run the runtime tests to verify the new ones fail**

Run: `pnpm --filter @aichess/runtime test`
Expected: `service.test.ts` fails to resolve `./service.js`; the seeding test fails on the unknown `owners` option (both owners equal). Everything else passes.

- [ ] **Step 3: Presence key and bus publish**

Create `packages/runtime/src/presence.ts`:

```ts
export function presenceKeyFor(agentId: string): string {
  return `presence:agent:${agentId}`;
}
```

In `packages/runtime/src/events/bus.ts`, after the `publish` method add:

```ts
  async publishToAgent(agentId: string, event: WireEvent): Promise<void> {
    await this.publisher.publish(agentChannel(agentId), JSON.stringify(event));
  }
```

- [ ] **Step 4: Matchmaking service**

Create `packages/runtime/src/matchmaking/service.ts`:

```ts
import type { QueueStatus, WireEvent } from "@aichess/core/protocol";
import type { Database } from "@aichess/db";
import type { EventBus } from "../events/bus.js";
import { findActiveGameIdForAgent } from "../games/repository.js";
import type { RuntimeLogger } from "../logger.js";
import { loadRating } from "../rating/repository.js";
import type { MatchmakingQueue, QueueMembership } from "./queue.js";

export interface MatchmakingServiceDeps {
  db: Database;
  queue: MatchmakingQueue;
  bus: EventBus;
  logger: RuntimeLogger;
  now?: () => number;
}

export type JoinQueueResult =
  { ok: true; queuedAt: number } | { ok: false; code: "already_in_queue" | "in_active_game" };

export type LeaveQueueResult = { ok: true; queuedAt: number } | { ok: false; code: "not_in_queue" };

export function toQueueStatus(membership: QueueMembership): QueueStatus {
  return { queuedAt: new Date(membership.queuedAt).toISOString() };
}

export class MatchmakingService {
  private readonly now: () => number;

  constructor(private readonly deps: MatchmakingServiceDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  async join(agentId: string): Promise<JoinQueueResult> {
    if ((await findActiveGameIdForAgent(this.deps.db, agentId)) !== null) {
      return { ok: false, code: "in_active_game" };
    }
    const rating = await loadRating(this.deps.db, agentId);
    const queuedAt = this.now();
    const added = await this.deps.queue.join(agentId, rating.rating, queuedAt);
    if (!added) return { ok: false, code: "already_in_queue" };
    await this.notify(agentId, { type: "queue.joined", ...toQueueStatus({ queuedAt }) });
    return { ok: true, queuedAt };
  }

  async leave(agentId: string): Promise<LeaveQueueResult> {
    const removed = await this.deps.queue.leave(agentId);
    if (removed === null) return { ok: false, code: "not_in_queue" };
    await this.notify(agentId, { type: "queue.left", ...toQueueStatus(removed) });
    return { ok: true, queuedAt: removed.queuedAt };
  }

  status(agentId: string): Promise<QueueMembership | null> {
    return this.deps.queue.status(agentId);
  }

  private async notify(agentId: string, event: WireEvent): Promise<void> {
    try {
      await this.deps.bus.publishToAgent(agentId, event);
    } catch (error) {
      this.deps.logger.error({ agentId, type: event.type, error }, "queue_event_publish_failed");
    }
  }
}
```

- [ ] **Step 5: Wire the runtime and the seeding option**

Replace `packages/runtime/src/runtime.ts` with:

```ts
import type { GameConfig } from "@aichess/core/protocol";
import { createDb, type Database } from "@aichess/db";
import type { Redis } from "ioredis";
import { EventBus, createRedis } from "./events/bus.js";
import { GameService } from "./games/service.js";
import { createDeadlineQueue, type DeadlineQueue } from "./jobs/deadlines.js";
import type { RuntimeLogger } from "./logger.js";
import { MatchmakingQueue } from "./matchmaking/queue.js";
import { MatchmakingService } from "./matchmaking/service.js";

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
  queue: MatchmakingQueue;
  matchmaking: MatchmakingService;
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
  redis.on("error", (error: Error) => logger.error({ err: error, connection: "general" }, "redis error"));
  queueConnection.on("error", (error: Error) => logger.error({ err: error, connection: "queue" }, "redis error"));
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
  const queue = new MatchmakingQueue(redis);
  const matchmaking = new MatchmakingService({ db: dbHandle.db, queue, bus, logger });
  const openBus = bus;
  let closed = false;
  return {
    db: dbHandle.db,
    redis,
    bus: openBus,
    deadlines,
    service,
    queue,
    matchmaking,
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

Replace `packages/runtime/src/testing.ts` with:

```ts
import { randomUUID } from "node:crypto";
import { RedisContainer } from "@testcontainers/redis";
import { agents, users, type Database } from "@aichess/db";
import type { GameAgents } from "./events/wire.js";

export interface SeedOptions {
  owners?: "shared" | "distinct";
}

async function insertOwner(db: Database, handle: string): Promise<{ id: string }> {
  const [owner] = await db
    .insert(users)
    .values({ email: `${handle}@example.com`, name: `Owner ${handle}` })
    .returning({ id: users.id });
  if (owner === undefined) throw new Error("owner not inserted");
  return owner;
}

export async function seedTwoAgents(db: Database, options: SeedOptions = {}): Promise<GameAgents> {
  const suffix = randomUUID().slice(0, 8);
  const first = await insertOwner(db, `owner-${suffix}`);
  const second = options.owners === "distinct" ? await insertOwner(db, `owner2-${suffix}`) : first;
  const rows = await db
    .insert(agents)
    .values([
      {
        ownerId: first.id,
        name: `Alpha ${suffix}`,
        slug: `alpha-${suffix}`,
        modelProvider: "anthropic",
        modelName: "claude-sonnet-5",
        apiKeyPrefix: suffix,
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: second.id,
        name: `Beta ${suffix}`,
        slug: `beta-${suffix}`,
        modelProvider: "openai",
        modelName: "gpt-5",
        apiKeyPrefix: suffix.split("").reverse().join(""),
        apiKeyHash: "1".repeat(64),
      },
    ])
    .returning();
  const [white, black] = rows;
  if (white === undefined || black === undefined) throw new Error("agents not inserted");
  const summary = (row: typeof white): GameAgents["white"] => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
  });
  return { white: summary(white), black: summary(black) };
}

const REDIS_IMAGE = "redis:7-alpine";

export interface TestRedis {
  url: string;
  stop: () => Promise<void>;
}

export async function startTestRedis(): Promise<TestRedis> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  return { url: container.getConnectionUrl(), stop: () => container.stop().then(() => undefined) };
}
```

Append to `packages/runtime/src/index.ts`:

```ts
export * from "./presence.js";
export * from "./matchmaking/service.js";
```

- [ ] **Step 6: Pass the new handles through the api and use the shared presence key**

In `apps/api/src/deps.ts`, inside the returned `deps` object, after `service: runtime.service,` add:

```ts
      queue: runtime.queue,
      matchmaking: runtime.matchmaking,
```

In `apps/api/src/sse/agent-streams.ts` delete the `presenceKeyFor` function and add the import:

```ts
import { presenceKeyFor } from "@aichess/runtime";
```

In `apps/api/src/sse/agent-streams.test.ts` replace `import { presenceKeyFor } from "./agent-streams.js";` with `import { presenceKeyFor } from "@aichess/runtime";`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @aichess/runtime test && pnpm build && pnpm --filter @aichess/api test src/sse/agent-streams.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green across the workspace.

```bash
git add packages/runtime/src/presence.ts packages/runtime/src/matchmaking/service.ts packages/runtime/src/matchmaking/service.test.ts packages/runtime/src/events/bus.ts packages/runtime/src/runtime.ts packages/runtime/src/testing.ts packages/runtime/src/index.ts packages/runtime/src/games/repository.test.ts apps/api/src/deps.ts apps/api/src/sse/agent-streams.ts apps/api/src/sse/agent-streams.test.ts
git commit -m "feat(runtime): matchmaking service with queue events, shared presence key, runtime wiring"
```

---

### Task 7: Matchmaker sweep under a shared locked interval

**Files:**

- Create: `packages/runtime/src/jobs/locked-interval.ts`
- Modify: `packages/runtime/src/jobs/reconciler.ts`
- Create: `packages/runtime/src/matchmaking/repository.ts`
- Create: `packages/runtime/src/matchmaking/matchmaker.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/jobs/locked-interval.test.ts`, `packages/runtime/src/matchmaking/repository.test.ts`, `packages/runtime/src/matchmaking/matchmaker.test.ts`

**Interfaces:**

- Consumes: `MatchmakingQueue` (Task 4), `pairCandidates` and `Candidate` (Task 5), `MatchmakingService.leave` (Task 6), `presenceKeyFor` (Task 6), `GameService.createAndStartGame`.
- Produces:
  - `startLockedInterval<T>(input: { redis: Redis; lockKey: string; name: string; intervalMs: number; lockTtlMs?: number; instanceId?: string; logger: RuntimeLogger; run: () => Promise<T> }): LockedInterval<T>` with `interface LockedInterval<T> { runOnce(): Promise<T | null>; stop(): Promise<void> }`. `runOnce` returns `null` when another instance holds the lock. `startReconciler` keeps its signature and becomes a wrapper; `type Reconciler = LockedInterval<ReconcileReport>`.
  - `interface QueueAgent { id: string; ownerId: string; status: AgentStatus }`, `loadQueueAgents(ex, agentIds): Promise<Map<string, QueueAgent>>`, `listAgentsInActiveGames(ex, agentIds): Promise<Set<string>>`, `loadLastColors(ex, agentIds): Promise<Map<string, Color>>` (colour of each agent's most recently created game).
  - `MATCHMAKING_LOCK_KEY = "lock:matchmaking"`, `interface PairingReport { scanned: number; paired: number; dropped: number }`, `type DropReason = "unavailable" | "in_active_game" | "offline"`, and
    ```ts
    class Matchmaker {
      constructor(deps: {
        db: Database; redis: Redis; queue: MatchmakingQueue;
        matchmaking: Pick<MatchmakingService, "leave">; games: Pick<GameService, "createAndStartGame">;
        logger: RuntimeLogger; offlineGraceMs: number; now?: () => number; window?: PairingWindow;
      });
      runOnce(): Promise<PairingReport>;
    }
    startMatchmaker(input: { redis: Redis; matchmaker: Matchmaker; logger: RuntimeLogger; intervalMs: number; lockTtlMs?: number; instanceId?: string }): LockedInterval<PairingReport>
    ```

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/jobs/locked-interval.test.ts`:

```ts
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { noopLogger, type RuntimeLogger } from "../logger.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { startLockedInterval } from "./locked-interval.js";

const LOCK = "lock:test";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("startLockedInterval", () => {
  let container: TestRedis;
  let redis: Redis;

  beforeAll(async () => {
    container = await startTestRedis();
    redis = createRedis(container.url);
    await redis.connect();
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.del(LOCK);
  });

  it("runs one instance at a time and releases the lock afterwards", async () => {
    let running = 0;
    let peak = 0;
    const make = (id: string): ReturnType<typeof startLockedInterval<string>> =>
      startLockedInterval({
        redis,
        lockKey: LOCK,
        name: "test",
        intervalMs: 60_000,
        instanceId: id,
        logger: noopLogger,
        run: async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 100));
          running -= 1;
          return id;
        },
      });
    const a = make("a");
    const b = make("b");
    try {
      const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
      expect([ra, rb].filter((r) => r !== null)).toHaveLength(1);
      expect(peak).toBe(1);
      expect(await redis.exists(LOCK)).toBe(0);
      expect(await b.runOnce()).toBe("b");
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("ticks on its interval and logs a failure without stopping", async () => {
    let calls = 0;
    const errors: Record<string, unknown>[] = [];
    const logger: RuntimeLogger = { ...noopLogger, error: (meta) => void errors.push(meta) };
    const loop = startLockedInterval({
      redis,
      lockKey: LOCK,
      name: "test",
      intervalMs: 50,
      logger,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return calls;
      },
    });
    try {
      await waitFor(() => calls >= 3, 3_000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ job: "test" });
    } finally {
      await loop.stop();
    }
    const after = calls;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(after);
  });
});
```

Create `packages/runtime/src/matchmaking/repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { applyResign, createGame, startGame } from "@aichess/core";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { agents, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { insertGame, persistTransition } from "../games/repository.js";
import { seedTwoAgents } from "../testing.js";
import { listAgentsInActiveGames, loadLastColors, loadQueueAgents } from "./repository.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("matchmaking repository", () => {
  let tdb: TestDatabase;
  let db: Database;
  let pair: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    pair = await seedTwoAgents(db, { owners: "distinct" });
  });

  async function activeGame(whiteAgentId: string, blackAgentId: string, now: number): Promise<string> {
    const created = createGame({ id: randomUUID(), whiteAgentId, blackAgentId, config: DEFAULT_GAME_CONFIG, now });
    await insertGame(db, created);
    const started = startGame(created, now);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    return created.id;
  }

  it("loads owner and status for the given agents only", async () => {
    await db.update(agents).set({ status: "suspended" }).where(eq(agents.id, pair.black.id));
    const rows = await loadQueueAgents(db, [pair.white.id, pair.black.id, randomUUID()]);
    expect(rows.size).toBe(2);
    expect(rows.get(pair.white.id)).toMatchObject({ id: pair.white.id, status: "active" });
    expect(rows.get(pair.black.id)).toMatchObject({ status: "suspended" });
    expect(rows.get(pair.white.id)?.ownerId).not.toBe(rows.get(pair.black.id)?.ownerId);
    expect(await loadQueueAgents(db, [])).toEqual(new Map());
  });

  it("lists the agents that are in an active game", async () => {
    const other = await seedTwoAgents(db);
    expect(await listAgentsInActiveGames(db, [pair.white.id, pair.black.id])).toEqual(new Set());
    const created = createGame({
      id: randomUUID(),
      whiteAgentId: pair.white.id,
      blackAgentId: other.white.id,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
    await insertGame(db, created);
    expect(await listAgentsInActiveGames(db, [pair.white.id])).toEqual(new Set());
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    expect(await listAgentsInActiveGames(db, [pair.white.id, pair.black.id, other.white.id])).toEqual(
      new Set([pair.white.id, other.white.id]),
    );
    const resigned = applyResign(started.state, pair.white.id, T0 + 1);
    if (!resigned.ok) throw new Error(resigned.code);
    await db.transaction((tx) => persistTransition(tx, started.state, resigned.state, resigned.events, {}));
    expect(await listAgentsInActiveGames(db, [pair.white.id, other.white.id])).toEqual(new Set());
    expect(await listAgentsInActiveGames(db, [])).toEqual(new Set());
  });

  it("finds the colour of each agent's most recent game", async () => {
    const other = await seedTwoAgents(db);
    await activeGame(pair.white.id, pair.black.id, T0);
    await activeGame(other.white.id, pair.white.id, T0 + 1_000);
    const colors = await loadLastColors(db, [pair.white.id, pair.black.id, other.white.id, other.black.id]);
    expect(colors.get(pair.white.id)).toBe("black");
    expect(colors.get(pair.black.id)).toBe("black");
    expect(colors.get(other.white.id)).toBe("white");
    expect(colors.has(other.black.id)).toBe(false);
    expect(await loadLastColors(db, [])).toEqual(new Map());
  });
});
```

Create `packages/runtime/src/matchmaking/matchmaker.test.ts`:

```ts
import { DEFAULT_GAME_CONFIG, type WireEvent } from "@aichess/core/protocol";
import { agents, ratings } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { presenceKeyFor } from "../presence.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { MATCHMAKING_LOCK_KEY, Matchmaker, startMatchmaker, type MatchmakerDeps } from "./matchmaker.js";
import { MatchmakingService } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Matchmaker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let pair: GameAgents;
  let clock: number;
  let mm: MatchmakingService;

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
    await runtime.redis.flushdb();
    pair = await seedTwoAgents(runtime.db, { owners: "distinct" });
    clock = T0;
    mm = new MatchmakingService({
      db: runtime.db,
      queue: runtime.queue,
      bus: runtime.bus,
      logger: noopLogger,
      now: () => clock,
    });
  });

  function matchmaker(overrides: Partial<MatchmakerDeps> = {}): Matchmaker {
    return new Matchmaker({
      db: runtime.db,
      redis: runtime.redis,
      queue: runtime.queue,
      matchmaking: mm,
      games: runtime.service,
      logger: noopLogger,
      offlineGraceMs: 15_000,
      now: () => clock,
      ...overrides,
    });
  }

  async function online(...ids: string[]): Promise<void> {
    for (const id of ids) await runtime.redis.set(presenceKeyFor(id), "1", "EX", 60);
  }

  async function join(agentId: string): Promise<void> {
    const r = await mm.join(agentId);
    if (!r.ok) throw new Error(r.code);
  }

  it("pairs two online agents of different owners and starts a game", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);

    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
    expect(await runtime.queue.size()).toBe(0);
    const game = await runtime.service.activeGameFor(pair.white.id);
    expect(game).not.toBeNull();
    expect(game?.white.id).toBe(pair.white.id);
    expect(game?.black.id).toBe(pair.black.id);
    expect((await runtime.service.activeGameFor(pair.black.id))?.id).toBe(game?.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 0, paired: 0, dropped: 0 });
  });

  it("never pairs two agents of the same owner", async () => {
    const sameOwner = await seedTwoAgents(runtime.db);
    await online(sameOwner.white.id, sameOwner.black.id);
    await join(sameOwner.white.id);
    await join(sameOwner.black.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    expect(await runtime.queue.size()).toBe(2);
  });

  it("waits for an offline agent during the grace period, then drops it and tells it", async () => {
    const seen: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(pair.black.id, (e) => seen.push(e));
    await online(pair.white.id);
    await join(pair.white.id);
    await join(pair.black.id);
    const m = matchmaker({ offlineGraceMs: 1_000 });

    clock = T0 + 500;
    expect(await m.runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    expect(await runtime.queue.size()).toBe(2);

    clock = T0 + 1_000;
    expect(await m.runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 1 });
    expect(await runtime.queue.status(pair.black.id)).toBeNull();
    expect(await runtime.queue.status(pair.white.id)).toEqual({ queuedAt: T0 });
    await waitFor(() => seen.some((e) => e.type === "queue.left"));
    expect(seen.find((e) => e.type === "queue.left")).toEqual({
      type: "queue.left",
      queuedAt: new Date(T0).toISOString(),
    });
    await off();
  });

  it("drops suspended agents and agents that are already playing", async () => {
    const extra = await seedTwoAgents(runtime.db, { owners: "distinct" });
    await online(pair.white.id, pair.black.id, extra.white.id);
    await join(pair.white.id);
    await join(pair.black.id);
    await join(extra.white.id);
    await runtime.db.update(agents).set({ status: "suspended" }).where(eq(agents.id, pair.black.id));
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: pair.white.id,
      blackAgentId: extra.white.id,
    });
    expect(created.ok).toBe(true);

    expect(await matchmaker().runOnce()).toEqual({ scanned: 3, paired: 0, dropped: 3 });
    expect(await runtime.queue.size()).toBe(0);
  });

  it("widens the rating window with the wait", async () => {
    await runtime.db.insert(ratings).values({ agentId: pair.black.id, rating: 1900, rd: 60, volatility: 0.06 });
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    await join(pair.black.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    clock = T0 + 40_000;
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
  });

  it("alternates colours with the previous game", async () => {
    const first = await runtime.service.createAndStartGame({
      whiteAgentId: pair.white.id,
      blackAgentId: pair.black.id,
    });
    if (!first.ok) throw new Error(first.code);
    await runtime.service.resign({ gameId: first.snapshot.id, agentId: pair.black.id });

    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
    const game = await runtime.service.activeGameFor(pair.white.id);
    expect(game?.white.id).toBe(pair.black.id);
    expect(game?.black.id).toBe(pair.white.id);
  });

  it("puts both agents back when the game cannot be created", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);
    const failing = matchmaker({
      games: {
        createAndStartGame: async () => {
          throw new Error("db down");
        },
      },
    });
    await expect(failing.runOnce()).rejects.toThrow("db down");
    const entries = (await runtime.queue.entries()).sort((a, b) => a.queuedAt - b.queuedAt);
    expect(entries).toEqual([
      { agentId: pair.white.id, rating: 1500, queuedAt: T0 },
      { agentId: pair.black.id, rating: 1500, queuedAt: T0 + 1 },
    ]);
  });

  it("runs on its interval under the shared lock", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    await join(pair.black.id);
    const loop = startMatchmaker({
      redis: runtime.redis,
      matchmaker: matchmaker(),
      logger: noopLogger,
      intervalMs: 200,
    });
    try {
      await waitFor(async () => (await runtime.service.activeGameFor(pair.white.id)) !== null);
    } finally {
      await loop.stop();
    }
    expect(await runtime.redis.exists(MATCHMAKING_LOCK_KEY)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the runtime tests to verify the new ones fail**

Run: `pnpm --filter @aichess/runtime test`
Expected: the three new files fail to resolve `./locked-interval.js`, `./repository.js` and `./matchmaker.js`; everything else passes.

- [ ] **Step 3: Extract the locked interval and rewrite the reconciler on top of it**

Create `packages/runtime/src/jobs/locked-interval.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { RuntimeLogger } from "../logger.js";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const MIN_LOCK_TTL_MS = 1_000;

export interface LockedIntervalInput<T> {
  redis: Redis;
  lockKey: string;
  name: string;
  intervalMs: number;
  lockTtlMs?: number;
  instanceId?: string;
  logger: RuntimeLogger;
  run: () => Promise<T>;
}

export interface LockedInterval<T> {
  runOnce(): Promise<T | null>;
  stop(): Promise<void>;
}

export function startLockedInterval<T>(input: LockedIntervalInput<T>): LockedInterval<T> {
  const instanceId = input.instanceId ?? randomUUID();
  const lockTtlMs = input.lockTtlMs ?? Math.max(input.intervalMs, MIN_LOCK_TTL_MS);
  let inFlight: Promise<T | null> | null = null;

  const runOnce = async (): Promise<T | null> => {
    const acquired = await input.redis.set(input.lockKey, instanceId, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await input.run();
    } finally {
      await input.redis.eval(RELEASE_SCRIPT, 1, input.lockKey, instanceId);
    }
  };

  const tick = (): void => {
    if (inFlight !== null) return;
    inFlight = runOnce()
      .catch((error: unknown) => {
        input.logger.error({ err: error, job: input.name }, "locked interval run failed");
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

Replace `packages/runtime/src/jobs/reconciler.ts` with:

```ts
import type { Redis } from "ioredis";
import type { GameService, ReconcileReport } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";
import { startLockedInterval, type LockedInterval } from "./locked-interval.js";

export const RECONCILE_LOCK_KEY = "lock:reconcile";

export interface ReconcilerInput {
  redis: Redis;
  service: GameService;
  logger: RuntimeLogger;
  intervalMs: number;
  staleTurnMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export type Reconciler = LockedInterval<ReconcileReport>;

export function startReconciler(input: ReconcilerInput): Reconciler {
  return startLockedInterval({
    redis: input.redis,
    lockKey: RECONCILE_LOCK_KEY,
    name: "reconcile",
    intervalMs: input.intervalMs,
    logger: input.logger,
    ...(input.lockTtlMs === undefined ? {} : { lockTtlMs: input.lockTtlMs }),
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    run: () => input.service.reconcile({ staleTurnMs: input.staleTurnMs }),
  });
}
```

- [ ] **Step 4: Matchmaking repository queries**

Create `packages/runtime/src/matchmaking/repository.ts`:

```ts
import type { AgentStatus, Color } from "@aichess/core/protocol";
import { agents, games } from "@aichess/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Executor } from "../games/repository.js";

export interface QueueAgent {
  id: string;
  ownerId: string;
  status: AgentStatus;
}

export async function loadQueueAgents(ex: Executor, agentIds: string[]): Promise<Map<string, QueueAgent>> {
  if (agentIds.length === 0) return new Map();
  const rows = await ex
    .select({ id: agents.id, ownerId: agents.ownerId, status: agents.status })
    .from(agents)
    .where(inArray(agents.id, agentIds));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listAgentsInActiveGames(ex: Executor, agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = await ex
    .select({ white: games.whiteAgentId, black: games.blackAgentId })
    .from(games)
    .where(
      and(eq(games.status, "active"), or(inArray(games.whiteAgentId, agentIds), inArray(games.blackAgentId, agentIds))),
    );
  const wanted = new Set(agentIds);
  const busy = new Set<string>();
  for (const row of rows) {
    if (wanted.has(row.white)) busy.add(row.white);
    if (wanted.has(row.black)) busy.add(row.black);
  }
  return busy;
}

export async function loadLastColors(ex: Executor, agentIds: string[]): Promise<Map<string, Color>> {
  if (agentIds.length === 0) return new Map();
  const ids = sql.join(
    agentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await ex.execute(sql`
    select distinct on (agent_id) agent_id, color
    from (
      select white_agent_id as agent_id, 'white' as color, created_at from games where white_agent_id in (${ids})
      union all
      select black_agent_id as agent_id, 'black' as color, created_at from games where black_agent_id in (${ids})
    ) as played
    order by agent_id, created_at desc`);
  const out = new Map<string, Color>();
  for (const row of rows) {
    const agentId = row["agent_id"];
    const color = row["color"];
    if (typeof agentId === "string" && (color === "white" || color === "black")) out.set(agentId, color);
  }
  return out;
}
```

- [ ] **Step 5: The matchmaker and its loop**

Create `packages/runtime/src/matchmaking/matchmaker.ts`:

```ts
import type { Database } from "@aichess/db";
import type { Redis } from "ioredis";
import type { GameService } from "../games/service.js";
import { startLockedInterval, type LockedInterval } from "../jobs/locked-interval.js";
import type { RuntimeLogger } from "../logger.js";
import { presenceKeyFor } from "../presence.js";
import { DEFAULT_PAIRING_WINDOW, pairCandidates, type Candidate, type Pair, type PairingWindow } from "./pairing.js";
import type { MatchmakingQueue, QueueEntry } from "./queue.js";
import { listAgentsInActiveGames, loadLastColors, loadQueueAgents, type QueueAgent } from "./repository.js";
import type { MatchmakingService } from "./service.js";

export const MATCHMAKING_LOCK_KEY = "lock:matchmaking";

export interface MatchmakerDeps {
  db: Database;
  redis: Redis;
  queue: MatchmakingQueue;
  matchmaking: Pick<MatchmakingService, "leave">;
  games: Pick<GameService, "createAndStartGame">;
  logger: RuntimeLogger;
  offlineGraceMs: number;
  now?: () => number;
  window?: PairingWindow;
}

export interface PairingReport {
  scanned: number;
  paired: number;
  dropped: number;
}

export type DropReason = "unavailable" | "in_active_game" | "offline";

export class Matchmaker {
  private readonly now: () => number;
  private readonly window: PairingWindow;

  constructor(private readonly deps: MatchmakerDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    this.window = deps.window ?? DEFAULT_PAIRING_WINDOW;
  }

  async runOnce(): Promise<PairingReport> {
    const entries = await this.deps.queue.entries();
    const report: PairingReport = { scanned: entries.length, paired: 0, dropped: 0 };
    if (entries.length === 0) return report;

    const ids = entries.map((entry) => entry.agentId);
    const [rows, busy, online, lastColors] = await Promise.all([
      loadQueueAgents(this.deps.db, ids),
      listAgentsInActiveGames(this.deps.db, ids),
      this.onlineAgents(ids),
      loadLastColors(this.deps.db, ids),
    ]);
    const now = this.now();

    const candidates: Candidate[] = [];
    for (const entry of entries) {
      const row = rows.get(entry.agentId);
      const reason = this.dropReason(entry, row, busy, online, now);
      if (reason !== null) {
        await this.drop(entry, reason);
        report.dropped += 1;
        continue;
      }
      if (row === undefined || !online.has(entry.agentId)) continue;
      candidates.push({
        agentId: entry.agentId,
        ownerId: row.ownerId,
        rating: entry.rating,
        queuedAt: entry.queuedAt,
        lastColor: lastColors.get(entry.agentId) ?? null,
      });
    }

    for (const pair of pairCandidates(candidates, now, this.window)) {
      if (await this.startGame(pair)) report.paired += 1;
    }
    if (report.paired > 0 || report.dropped > 0) {
      this.deps.logger.info({ ...report }, "matchmaking applied");
    }
    return report;
  }

  private dropReason(
    entry: QueueEntry,
    row: QueueAgent | undefined,
    busy: Set<string>,
    online: Set<string>,
    now: number,
  ): DropReason | null {
    if (row === undefined || row.status !== "active") return "unavailable";
    if (busy.has(entry.agentId)) return "in_active_game";
    if (!online.has(entry.agentId) && now - entry.queuedAt >= this.deps.offlineGraceMs) return "offline";
    return null;
  }

  private async onlineAgents(ids: string[]): Promise<Set<string>> {
    const pipeline = this.deps.redis.pipeline();
    for (const id of ids) pipeline.exists(presenceKeyFor(id));
    const results = await pipeline.exec();
    const online = new Set<string>();
    results?.forEach(([error, value], index) => {
      const id = ids[index];
      if (error === null && value === 1 && id !== undefined) online.add(id);
    });
    return online;
  }

  private async drop(entry: QueueEntry, reason: DropReason): Promise<void> {
    const result = await this.deps.matchmaking.leave(entry.agentId);
    if (result.ok) {
      this.deps.logger.info({ agentId: entry.agentId, reason }, "removed from queue");
    }
  }

  private async startGame(pair: Pair): Promise<boolean> {
    const white = pair.white.agentId;
    const black = pair.black.agentId;
    const removed = await this.deps.queue.removePair(white, black);
    if (!removed) return false;
    try {
      const created = await this.deps.games.createAndStartGame({ whiteAgentId: white, blackAgentId: black });
      if (!created.ok) {
        this.deps.logger.warn({ white, black, code: created.code }, "pairing skipped");
        return false;
      }
      this.deps.logger.info({ gameId: created.snapshot.id, white, black }, "paired");
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error, white, black }, "game creation failed, requeueing pair");
      await this.requeue(pair.white);
      await this.requeue(pair.black);
      throw error;
    }
  }

  private async requeue(candidate: Candidate): Promise<void> {
    try {
      await this.deps.queue.join(candidate.agentId, candidate.rating, candidate.queuedAt);
    } catch (error) {
      this.deps.logger.error({ err: error, agentId: candidate.agentId }, "requeue failed");
    }
  }
}

export interface MatchmakerLoopInput {
  redis: Redis;
  matchmaker: Matchmaker;
  logger: RuntimeLogger;
  intervalMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export type MatchmakerLoop = LockedInterval<PairingReport>;

export function startMatchmaker(input: MatchmakerLoopInput): MatchmakerLoop {
  return startLockedInterval({
    redis: input.redis,
    lockKey: MATCHMAKING_LOCK_KEY,
    name: "matchmaking",
    intervalMs: input.intervalMs,
    logger: input.logger,
    ...(input.lockTtlMs === undefined ? {} : { lockTtlMs: input.lockTtlMs }),
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    run: () => input.matchmaker.runOnce(),
  });
}
```

Append to `packages/runtime/src/index.ts`:

```ts
export * from "./jobs/locked-interval.js";
export * from "./matchmaking/repository.js";
export * from "./matchmaking/matchmaker.js";
```

- [ ] **Step 6: Run the runtime tests to verify they pass**

Run: `pnpm --filter @aichess/runtime test`
Expected: PASS, including the untouched `reconciler.test.ts`.

- [ ] **Step 7: Verify and commit**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green.

```bash
git add packages/runtime/src/jobs/locked-interval.ts packages/runtime/src/jobs/locked-interval.test.ts packages/runtime/src/jobs/reconciler.ts packages/runtime/src/matchmaking/repository.ts packages/runtime/src/matchmaking/repository.test.ts packages/runtime/src/matchmaking/matchmaker.ts packages/runtime/src/matchmaking/matchmaker.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): matchmaker sweep under a shared locked interval"
```

---

### Task 8: Queue routes, rating and queue in `me` and `hello`

**Files:**

- Modify: `packages/core/src/protocol/schemas.ts` (`HelloEventSchema`)
- Modify: `packages/core/src/protocol/schemas.test.ts`
- Modify: `apps/api/src/routes/agent.ts`
- Modify: `apps/api/src/sse/agent-streams.ts`
- Modify: `apps/api/src/sse/agent-streams.test.ts`
- Modify: `apps/api/src/test-utils/harness.ts`
- Create: `apps/api/src/routes/agent.test.ts`

**Interfaces:**

- Consumes: `MatchmakingService` and `toQueueStatus` (Task 6), `loadRating` and `toRatingSummary` (Task 3), `AgentMe`, `QueueStatus` (Task 1).
- Produces:
  - `HelloEventSchema` gains `queue: QueueStatusSchema.nullable()`.
  - `POST /v1/agent/queue` → 200 `QueueStatus`, 409 `already_in_queue` | `in_active_game`; `DELETE /v1/agent/queue` → 200 `QueueStatus`, 409 `not_in_queue`. Both bearer-authenticated and under the agent rate limit.
  - `GET /v1/agent/me` → `AgentMe`.
  - `hello` carries `queue`.
  - `startHarness({ owners?: "shared" | "distinct" })`; `reseed` clears the queue.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/protocol/schemas.test.ts`, inside `describe("agent profile, queue and leaderboard schemas", ...)`:

```ts
it("requires the queue field in hello", () => {
  const base = { type: "hello", agentId: randomUUID(), activeGame: null };
  expect(WireEventSchema.safeParse(base).success).toBe(false);
  expect(WireEventSchema.safeParse({ ...base, queue: null }).success).toBe(true);
  expect(WireEventSchema.safeParse({ ...base, queue: { queuedAt: "2026-09-03T10:00:00.000Z" } }).success).toBe(true);
  expect(WireEventSchema.safeParse({ ...base, queue: { queuedAt: "yesterday" } }).success).toBe(false);
});
```

In `apps/api/src/sse/agent-streams.test.ts`:

- In "opens with hello and marks the agent present" change the expectation to `expect(hello).toEqual({ type: "hello", agentId: h.agents.white.id, activeGame: null, queue: null });`.
- In "reports the agent through /v1/agent/me" change the first expectation to:

```ts
expect(offline.json()).toEqual({
  agent: expect.objectContaining({ id: h.agents.white.id, slug: h.agents.white.slug }),
  status: "active",
  online: false,
  activeGameId: null,
  queue: null,
  rating: { rating: 1500, rd: 350, gamesPlayed: 0, provisional: true },
});
```

Create `apps/api/src/routes/agent.test.ts`:

```ts
import type { QueueStatus } from "@aichess/core/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness, type SeededAgent } from "../test-utils/harness.js";

describe("agent queue routes", () => {
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

  function auth(agent: SeededAgent): Record<string, string> {
    return { authorization: `Bearer ${agent.key}` };
  }

  async function connect(agent: SeededAgent): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, auth(agent));
    clients.push(client);
    return client;
  }

  it("joins and leaves the queue with the standard responses", async () => {
    const join = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(join.statusCode).toBe(200);
    const body = join.json() as QueueStatus;
    expect(new Date(body.queuedAt).toISOString()).toBe(body.queuedAt);

    const again = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "already_in_queue" });

    const me = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers: auth(h.agents.white) });
    expect(me.json()).toMatchObject({ queue: { queuedAt: body.queuedAt } });

    const leave = await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(leave.statusCode).toBe(200);
    expect(leave.json()).toEqual({ queuedAt: body.queuedAt });

    const leaveAgain = await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(leaveAgain.statusCode).toBe(409);
    expect(leaveAgain.json()).toMatchObject({ error: "not_in_queue" });
    expect(await h.deps.queue.size()).toBe(0);
  });

  it("refuses to queue an agent that is playing", async () => {
    await h.createGame();
    const res = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "in_active_game" });
  });

  it("requires a bearer key on both routes", async () => {
    expect((await h.app.inject({ method: "POST", url: "/v1/agent/queue" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "DELETE", url: "/v1/agent/queue" })).statusCode).toBe(401);
  });

  it("streams queue.joined and queue.left and reports the membership in hello", async () => {
    const first = await connect(h.agents.white);
    const hello = await first.take("hello");
    expect(hello).toMatchObject({ type: "hello", queue: null });

    const join = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    const { queuedAt } = join.json() as QueueStatus;
    expect(await first.take("queue.joined")).toEqual({ type: "queue.joined", queuedAt });

    const second = await connect(h.agents.white);
    expect(await second.take("hello")).toMatchObject({ queue: { queuedAt } });

    await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(await second.take("queue.left")).toEqual({ type: "queue.left", queuedAt });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter @aichess/core test && pnpm build && pnpm --filter @aichess/api test src/routes/agent.test.ts src/sse/agent-streams.test.ts`
Expected: the core hello test fails (a hello without `queue` is accepted); the api tests fail with 404 on the queue routes and mismatching `hello` and `me` bodies.

- [ ] **Step 3: Require `queue` in hello**

In `packages/core/src/protocol/schemas.ts` change `HelloEventSchema` to:

```ts
export const HelloEventSchema = z.object({
  type: z.literal("hello"),
  agentId: z.uuid(),
  activeGame: GameSnapshotSchema.nullable(),
  queue: QueueStatusSchema.nullable(),
});
```

- [ ] **Step 4: Routes**

Replace `apps/api/src/routes/agent.ts` with:

```ts
import type { AgentMe, QueueStatus } from "@aichess/core/protocol";
import { loadRating, toQueueStatus, toRatingSummary } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { assertAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import type { AgentStreamRegistry } from "../sse/agent-streams.js";

const QUEUE_MESSAGES = {
  already_in_queue: "Agent is already in the queue",
  in_active_game: "Agent is playing a game",
  not_in_queue: "Agent is not in the queue",
} as const;

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps, streams: AgentStreamRegistry): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/agent/events", { preHandler: requireAgent(deps), config: limit }, async (request, reply) => {
    const agent = assertAgent(request);
    await streams.open(agent, reply, request.id);
  });

  app.get("/v1/agent/me", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const agent = assertAgent(request);
    const [online, activeGame, queue, rating] = await Promise.all([
      streams.isOnline(agent.id),
      deps.service.activeGameFor(agent.id),
      deps.matchmaking.status(agent.id),
      loadRating(deps.db, agent.id),
    ]);
    const body: AgentMe = {
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
      queue: queue === null ? null : toQueueStatus(queue),
      rating: toRatingSummary(rating),
    };
    return body;
  });

  app.post("/v1/agent/queue", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const agent = assertAgent(request);
    const result = await deps.matchmaking.join(agent.id);
    if (!result.ok) throw new ApiError(result.code, QUEUE_MESSAGES[result.code]);
    const body: QueueStatus = toQueueStatus(result);
    return body;
  });

  app.delete("/v1/agent/queue", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const agent = assertAgent(request);
    const result = await deps.matchmaking.leave(agent.id);
    if (!result.ok) throw new ApiError(result.code, QUEUE_MESSAGES[result.code]);
    const body: QueueStatus = toQueueStatus(result);
    return body;
  });
}
```

In `apps/api/src/sse/agent-streams.ts`:

- Change the runtime import to `import { presenceKeyFor, toQueueStatus } from "@aichess/runtime";`.
- Replace the block that sends `hello` with:

```ts
try {
  const [activeGame, queue] = await Promise.all([
    this.deps.service.activeGameFor(agent.id),
    this.deps.matchmaking.status(agent.id),
  ]);
  connection.send({
    type: "hello",
    agentId: agent.id,
    activeGame,
    queue: queue === null ? null : toQueueStatus(queue),
  });
  const turn = await this.deps.service.yourTurnFor(agent.id);
  if (turn !== null) connection.send(turn);
} catch (error) {
  log.error({ err: error, agentId: agent.id }, "hello failed");
  connection.close();
}
```

In `apps/api/src/test-utils/harness.ts`:

- Add `owners?: "shared" | "distinct";` to `HarnessOptions`.
- Change `seedWithKeys` to take the option: `async function seedWithKeys(db: Database, owners: "shared" | "distinct"): Promise<Harness["agents"]> { const seeded: GameAgents = await seedTwoAgents(db, { owners }); ... }`, and call it as `seedWithKeys(handle.deps.db, options.owners ?? "shared")` in both places (`agents:` and `reseed`).
- In `reseed`, after `obliterate`, add `await handle.deps.queue.clear();`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm build && pnpm --filter @aichess/api test`
Expected: PASS across the api suite (the e2e file still uses `hello` through `take("hello")` only).

- [ ] **Step 6: Verify and commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green.

```bash
git add packages/core/src/protocol/schemas.ts packages/core/src/protocol/schemas.test.ts apps/api/src/routes/agent.ts apps/api/src/routes/agent.test.ts apps/api/src/sse/agent-streams.ts apps/api/src/sse/agent-streams.test.ts apps/api/src/test-utils/harness.ts
git commit -m "feat(api): queue routes, rating and queue membership in me and hello"
```

---

### Task 9: Public leaderboard with cursor pagination

**Files:**

- Modify: `packages/runtime/src/rating/repository.ts`
- Create: `apps/api/src/routes/leaderboard.ts`
- Modify: `apps/api/src/app.ts`
- Test: `packages/runtime/src/rating/repository.test.ts`, `apps/api/src/routes/leaderboard.test.ts`

**Interfaces:**

- Consumes: `ratings`, `agents` tables; `PROVISIONAL_RD_THRESHOLD` from `@aichess/core`; `LeaderboardQuerySchema`, `LeaderboardEntry`, `LeaderboardPage` (Task 1); `parseWith`, `ApiError`.
- Produces:
  - `interface LeaderboardCursor { rating: number; rd: number; agentId: string }`, `interface LeaderboardRow { agent: AgentSummary; rating: number; rd: number; gamesPlayed: number }`, `listLeaderboard(ex, input: { limit: number; after?: LeaderboardCursor }): Promise<LeaderboardRow[]>` ordered by rating desc, rd asc, agentId asc; only rows with `rd <= PROVISIONAL_RD_THRESHOLD` and `agents.status = "active"`.
  - `GET /v1/leaderboard?limit=&cursor=` → `LeaderboardPage`; public, under the global rate limit; `validation_error` on a bad query or cursor.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/src/rating/repository.test.ts`, inside `describe("rating repository", ...)`. Change the `@aichess/db` import to `import { agents as agentsTable, ratings, type Database } from "@aichess/db";` and extend the `./repository.js` import with `listLeaderboard`.

```ts
it("lists ranked agents by rating then RD, skipping provisional and suspended ones, with keyset paging", async () => {
  const more = await seedTwoAgents(db, { owners: "distinct" });
  await db.insert(ratings).values([
    { agentId: agents.white.id, rating: 1700, rd: 50, volatility: 0.06, gamesPlayed: 30 },
    { agentId: agents.black.id, rating: 1700, rd: 40, volatility: 0.06, gamesPlayed: 25 },
    { agentId: more.white.id, rating: 1650, rd: 200, volatility: 0.06, gamesPlayed: 2 },
    { agentId: more.black.id, rating: 1800, rd: 30, volatility: 0.06, gamesPlayed: 40 },
  ]);
  await db.update(agentsTable).set({ status: "suspended" }).where(eq(agentsTable.id, more.black.id));

  const all = await listLeaderboard(db, { limit: 10 });
  expect(all.map((r) => [r.agent.id, r.rating, r.rd, r.gamesPlayed])).toEqual([
    [agents.black.id, 1700, 40, 25],
    [agents.white.id, 1700, 50, 30],
  ]);
  expect(all[0]?.agent).toEqual(agents.black);

  const first = await listLeaderboard(db, { limit: 1 });
  expect(first.map((r) => r.agent.id)).toEqual([agents.black.id]);
  const last = first[0];
  if (last === undefined) throw new Error("expected one row");
  const second = await listLeaderboard(db, {
    limit: 1,
    after: { rating: last.rating, rd: last.rd, agentId: last.agent.id },
  });
  expect(second.map((r) => r.agent.id)).toEqual([agents.white.id]);
  expect(await listLeaderboard(db, { limit: 1, after: { rating: 1700, rd: 50, agentId: agents.white.id } })).toEqual(
    [],
  );
});
```

Create `apps/api/src/routes/leaderboard.test.ts`:

```ts
import { LeaderboardPageSchema } from "@aichess/core/protocol";
import { agents, ratings } from "@aichess/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness, type SeededAgent } from "../test-utils/harness.js";

describe("GET /v1/leaderboard", () => {
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

  async function seedBoard(): Promise<{ top: SeededAgent; runnerUp: SeededAgent }> {
    const top = await h.seedAgent();
    const runnerUp = await h.seedAgent();
    const provisional = await h.seedAgent();
    const suspended = await h.seedAgent();
    await h.db.insert(ratings).values([
      { agentId: top.id, rating: 1800, rd: 30, volatility: 0.06, gamesPlayed: 40 },
      { agentId: runnerUp.id, rating: 1700, rd: 50, volatility: 0.06, gamesPlayed: 30 },
      { agentId: provisional.id, rating: 1900, rd: 200, volatility: 0.06, gamesPlayed: 2 },
      { agentId: suspended.id, rating: 2000, rd: 20, volatility: 0.06, gamesPlayed: 50 },
    ]);
    await h.db.update(agents).set({ status: "suspended" }).where(eq(agents.id, suspended.id));
    return { top, runnerUp };
  }

  async function fetchPage(url: string): Promise<ReturnType<typeof LeaderboardPageSchema.parse>> {
    const res = await h.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    return LeaderboardPageSchema.parse(res.json());
  }

  it("lists ranked agents and skips provisional and suspended ones", async () => {
    const { top, runnerUp } = await seedBoard();
    const page = await fetchPage("/v1/leaderboard");
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((i) => [i.rank, i.agent.id, i.rating, i.rd, i.gamesPlayed])).toEqual([
      [1, top.id, 1800, 30, 40],
      [2, runnerUp.id, 1700, 50, 30],
    ]);
    expect(page.items[0]?.agent).toMatchObject({ id: top.id, name: top.name, slug: top.slug });
  });

  it("pages with a cursor and keeps the rank running", async () => {
    const { top, runnerUp } = await seedBoard();
    const first = await fetchPage("/v1/leaderboard?limit=1");
    expect(first.items.map((i) => i.agent.id)).toEqual([top.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = await fetchPage(`/v1/leaderboard?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    expect(second.items.map((i) => [i.rank, i.agent.id])).toEqual([[2, runnerUp.id]]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns an empty page when nobody is ranked", async () => {
    expect(await fetchPage("/v1/leaderboard")).toEqual({ items: [], nextCursor: null });
  });

  it("rejects a bad limit or a malformed cursor with validation_error", async () => {
    const badLimit = await h.app.inject({ method: "GET", url: "/v1/leaderboard?limit=0" });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json()).toMatchObject({ error: "validation_error" });

    const garbage = await h.app.inject({ method: "GET", url: "/v1/leaderboard?cursor=not-a-cursor" });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json()).toMatchObject({ error: "validation_error", details: { where: "query" } });

    const emptyObject = Buffer.from("{}", "utf8").toString("base64url");
    const incomplete = await h.app.inject({ method: "GET", url: `/v1/leaderboard?cursor=${emptyObject}` });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({ error: "validation_error" });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter @aichess/runtime test src/rating/repository.test.ts && pnpm --filter @aichess/api test src/routes/leaderboard.test.ts`
Expected: the runtime test fails (`listLeaderboard` is not exported); the api test fails with 404 on every request.

- [ ] **Step 3: Repository query**

In `packages/runtime/src/rating/repository.ts`:

- Change the `@aichess/core` import to `import { PROVISIONAL_RD_THRESHOLD, initialRating, isProvisional } from "@aichess/core";`, the protocol import to `import type { AgentSummary, RatingSummary } from "@aichess/core/protocol";`, the db import to `import { agents, ratings, type Transaction } from "@aichess/db";` and the drizzle import to `import { and, asc, desc, eq, gt, inArray, lt, lte, or } from "drizzle-orm";`.
- Append:

```ts
export interface LeaderboardCursor {
  rating: number;
  rd: number;
  agentId: string;
}

export interface LeaderboardRow {
  agent: AgentSummary;
  rating: number;
  rd: number;
  gamesPlayed: number;
}

export interface LeaderboardInput {
  limit: number;
  after?: LeaderboardCursor;
}

export async function listLeaderboard(ex: Executor, input: LeaderboardInput): Promise<LeaderboardRow[]> {
  const ranked = and(lte(ratings.rd, PROVISIONAL_RD_THRESHOLD), eq(agents.status, "active"));
  const after = input.after;
  const beyondCursor =
    after === undefined
      ? undefined
      : or(
          lt(ratings.rating, after.rating),
          and(eq(ratings.rating, after.rating), gt(ratings.rd, after.rd)),
          and(eq(ratings.rating, after.rating), eq(ratings.rd, after.rd), gt(ratings.agentId, after.agentId)),
        );
  const rows = await ex
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      rating: ratings.rating,
      rd: ratings.rd,
      gamesPlayed: ratings.gamesPlayed,
    })
    .from(ratings)
    .innerJoin(agents, eq(agents.id, ratings.agentId))
    .where(beyondCursor === undefined ? ranked : and(ranked, beyondCursor))
    .orderBy(desc(ratings.rating), asc(ratings.rd), asc(ratings.agentId))
    .limit(input.limit);
  return rows.map((row) => ({
    agent: { id: row.id, name: row.name, slug: row.slug, modelProvider: row.modelProvider, modelName: row.modelName },
    rating: row.rating,
    rd: row.rd,
    gamesPlayed: row.gamesPlayed,
  }));
}
```

- [ ] **Step 4: Route**

Create `apps/api/src/routes/leaderboard.ts`:

```ts
import { LeaderboardQuerySchema, type LeaderboardEntry, type LeaderboardPage } from "@aichess/core/protocol";
import { listLeaderboard, type LeaderboardCursor } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseWith } from "../validation.js";

const CursorSchema = z.object({
  rating: z.number(),
  rd: z.number().min(0),
  agentId: z.uuid(),
  rank: z.int().min(0),
});
type Cursor = z.infer<typeof CursorSchema>;

function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("validation_error", "Invalid query", {
      where: "query",
      issues: [{ path: "cursor", message: "Malformed cursor" }],
    });
  }
  return parseWith(CursorSchema, parsed, "query");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function registerLeaderboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/leaderboard", async (request) => {
    const query = parseWith(LeaderboardQuerySchema, request.query, "query");
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const after: LeaderboardCursor | undefined =
      cursor === null ? undefined : { rating: cursor.rating, rd: cursor.rd, agentId: cursor.agentId };
    const rows = await listLeaderboard(deps.db, { limit: query.limit + 1, ...(after === undefined ? {} : { after }) });
    const page = rows.slice(0, query.limit);
    const baseRank = cursor?.rank ?? 0;
    const items: LeaderboardEntry[] = page.map((row, index) => ({ rank: baseRank + index + 1, ...row }));
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ rating: last.rating, rd: last.rd, agentId: last.agent.id, rank: baseRank + page.length })
        : null;
    const body: LeaderboardPage = { items, nextCursor };
    return body;
  });
}
```

In `apps/api/src/app.ts` add `import { registerLeaderboardRoutes } from "./routes/leaderboard.js";` and, after `registerGameRoutes(app, deps, gameStreams);`, add `registerLeaderboardRoutes(app, deps);`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @aichess/runtime test src/rating/repository.test.ts && pnpm build && pnpm --filter @aichess/api test src/routes/leaderboard.test.ts src/plugins/cors.test.ts`
Expected: PASS (the CORS suite confirms the new public GET route is reachable from `WEB_ORIGIN` like the others).

- [ ] **Step 6: Verify and commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green.

```bash
git add packages/runtime/src/rating/repository.ts packages/runtime/src/rating/repository.test.ts apps/api/src/routes/leaderboard.ts apps/api/src/routes/leaderboard.test.ts apps/api/src/app.ts
git commit -m "feat(api): public leaderboard with keyset cursor pagination"
```

---

### Task 10: Matchmaking loop in the worker

**Files:**

- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/src/start.ts`
- Create: `apps/worker/src/config.test.ts`
- Modify: `apps/worker/src/start.test.ts`

**Interfaces:**

- Consumes: `Matchmaker`, `startMatchmaker` (Task 7), `RuntimeHandle.queue` and `matchmaking` (Task 6), `presenceKeyFor`.
- Produces: `WorkerConfig` gains `MATCHMAKING_INTERVAL_MS` (int >= 500, default 3000) and `MATCHMAKING_OFFLINE_GRACE_MS` (int >= 0, default 15000); `startWorker` runs the matchmaker loop and stops it first on shutdown.

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const BASE = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://y" };

describe("worker config", () => {
  it("applies matchmaking defaults", () => {
    const config = loadConfig(BASE);
    expect(config.MATCHMAKING_INTERVAL_MS).toBe(3_000);
    expect(config.MATCHMAKING_OFFLINE_GRACE_MS).toBe(15_000);
    expect(config.RECONCILE_INTERVAL_MS).toBe(10_000);
  });

  it("reads matchmaking overrides", () => {
    const config = loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "500", MATCHMAKING_OFFLINE_GRACE_MS: "0" });
    expect(config.MATCHMAKING_INTERVAL_MS).toBe(500);
    expect(config.MATCHMAKING_OFFLINE_GRACE_MS).toBe(0);
  });

  it("names the variable that is out of range", () => {
    expect(() => loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "100" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "100" })).toThrow(/MATCHMAKING_INTERVAL_MS/);
  });
});
```

Append to `apps/worker/src/start.test.ts`, inside `describe("startWorker", ...)`. Extend the `@aichess/runtime` import with `presenceKeyFor`.

```ts
it("pairs two queued online agents", async () => {
  const config = loadConfig({
    DATABASE_URL: tdb.url,
    REDIS_URL: redis.url,
    LOG_LEVEL: "silent",
    WORKER_HEALTH_PORT: "0",
    WORKER_HEALTH_HOST: "127.0.0.1",
    MATCHMAKING_INTERVAL_MS: "500",
  });
  const worker = await startWorker(config, pino({ level: "silent" }));
  try {
    const pair = await seedTwoAgents(runtime.db, { owners: "distinct" });
    for (const id of [pair.white.id, pair.black.id]) {
      await runtime.redis.set(presenceKeyFor(id), "1", "EX", 30);
    }
    expect((await runtime.matchmaking.join(pair.white.id)).ok).toBe(true);
    expect((await runtime.matchmaking.join(pair.black.id)).ok).toBe(true);
    await waitFor(async () => (await runtime.service.activeGameFor(pair.white.id)) !== null, 8_000);
    expect((await runtime.service.activeGameFor(pair.black.id))?.status).toBe("active");
    expect(await runtime.queue.size()).toBe(0);
  } finally {
    await worker.stop();
  }
});
```

- [ ] **Step 2: Run the worker tests to verify the new ones fail**

Run: `pnpm build && pnpm --filter @aichess/worker test`
Expected: `config.test.ts` fails (`MATCHMAKING_INTERVAL_MS` undefined, no `ConfigError` for `100`); the pairing test times out waiting for a game.

- [ ] **Step 3: Config and loop**

In `apps/worker/src/config.ts` extend `EnvSchema` with:

```ts
  MATCHMAKING_INTERVAL_MS: z.coerce.number().int().min(500).default(3_000),
  MATCHMAKING_OFFLINE_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
```

Replace `apps/worker/src/start.ts` with:

```ts
import {
  Matchmaker,
  createDeadlineWorker,
  createRedis,
  createRuntime,
  runtimeConfigFrom,
  startMatchmaker,
  startReconciler,
} from "@aichess/runtime";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health.js";

export interface RunningWorker {
  healthPort: number;
  stop: () => Promise<void>;
}

export async function startWorker(config: WorkerConfig, logger: Logger): Promise<RunningWorker> {
  const runtime = await createRuntime(runtimeConfigFrom(config), logger);
  const workerConnection = createRedis(config.REDIS_URL);
  workerConnection.on("error", (error: Error) => logger.error({ err: error, connection: "worker" }, "redis error"));
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
  const matchmaker = new Matchmaker({
    db: runtime.db,
    redis: runtime.redis,
    queue: runtime.queue,
    matchmaking: runtime.matchmaking,
    games: runtime.service,
    logger,
    offlineGraceMs: config.MATCHMAKING_OFFLINE_GRACE_MS,
  });
  const pairing = startMatchmaker({
    redis: runtime.redis,
    matchmaker,
    logger,
    intervalMs: config.MATCHMAKING_INTERVAL_MS,
  });

  const stopJobs = async (): Promise<void> => {
    await pairing.stop();
    await reconciler.stop();
    await worker.close();
    await workerConnection.quit();
  };

  const rearmed = await runtime.service.rearmActiveDeadlines();
  logger.info({ rearmed }, "deadlines re-armed on boot");

  let health: HealthServer;
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
    await stopJobs();
    await runtime.close();
    throw error;
  }

  let stopped = false;
  return {
    healthPort: health.port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopJobs();
      await health.close();
      await runtime.close();
    },
  };
}
```

- [ ] **Step 4: Run the worker tests to verify they pass**

Run: `pnpm build && pnpm --filter @aichess/worker test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green.

```bash
git add apps/worker/src/config.ts apps/worker/src/config.test.ts apps/worker/src/start.ts apps/worker/src/start.test.ts
git commit -m "feat(worker): matchmaking loop under the shared lock"
```

---

### Task 11: End-to-end: queue, pairing and a rated game over HTTP and SSE

**Files:**

- Modify: `apps/api/src/e2e.test.ts`

**Interfaces:**

- Consumes: everything above. The matchmaker runs in-process through `Matchmaker.runOnce()` so the test controls when pairing happens; the deadline worker keeps running as before.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/e2e.test.ts`:

- Change the harness call to `h = await startHarness({ listen: true, owners: "distinct" });`.
- Change the runtime import to `import { Matchmaker, createDeadlineWorker, createRedis, noopLogger } from "@aichess/runtime";` and add `import type { AgentMe, LeaderboardPage } from "@aichess/core/protocol";`.
- Change the `post` helper so the JSON content type is only sent with a body (Fastify rejects an empty JSON body):

```ts
async function post(agent: SeededAgent, path: string, body?: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${agent.key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
```

- Append inside `describe("end to end", ...)`:

```ts
it("pairs two queued agents and rates the result", async () => {
  const matchmaker = new Matchmaker({
    db: h.deps.db,
    redis: h.deps.redis,
    queue: h.deps.queue,
    matchmaking: h.deps.matchmaking,
    games: h.deps.service,
    logger: noopLogger,
    offlineGraceMs: 15_000,
  });
  const a = await connect(h.agents.white);
  const b = await connect(h.agents.black);
  for (const agent of [h.agents.white, h.agents.black]) {
    expect((await post(agent, "/v1/agent/queue")).status).toBe(200);
  }
  expect(await a.take("queue.joined")).toMatchObject({ type: "queue.joined" });
  expect(await b.take("queue.joined")).toMatchObject({ type: "queue.joined" });

  expect(await matchmaker.runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });

  const startA = await a.take("game.start");
  const startB = await b.take("game.start");
  if (startA.type !== "game.start" || startB.type !== "game.start") throw new Error("expected game.start");
  expect(startA.gameId).toBe(startB.gameId);
  expect(startA.color).not.toBe(startB.color);
  expect(startA.opponent.id).toBe(h.agents.black.id);
  const gameId = startA.gameId;
  const [whiteClient, whiteAgent, blackClient, blackAgent] =
    startA.color === "white" ? [a, h.agents.white, b, h.agents.black] : [b, h.agents.black, a, h.agents.white];

  await Promise.all([
    playScript(whiteClient, whiteAgent, gameId, ["f3", "g4"]),
    playScript(blackClient, blackAgent, gameId, ["e5", "Qh4#"]),
  ]);

  const whiteEnd = await whiteClient.take("game.end");
  const blackEnd = await blackClient.take("game.end");
  if (whiteEnd.type !== "game.end" || blackEnd.type !== "game.end") throw new Error("expected game.end");
  expect(whiteEnd).toMatchObject({ gameId, result: "0-1", termination: "checkmate" });
  expect(whiteEnd.rating?.before).toBe(1500);
  expect(whiteEnd.rating?.after).toBeLessThan(1500);
  expect(blackEnd.rating?.before).toBe(1500);
  expect(blackEnd.rating?.after).toBeGreaterThan(1500);

  const meRes = await fetch(`${h.baseUrl}/v1/agent/me`, { headers: { authorization: `Bearer ${blackAgent.key}` } });
  const me = (await meRes.json()) as AgentMe;
  expect(me).toMatchObject({ activeGameId: null, queue: null, rating: { gamesPlayed: 1, provisional: true } });
  expect(me.rating.rating).toBe(blackEnd.rating?.after);

  const board = (await (await fetch(`${h.baseUrl}/v1/leaderboard`)).json()) as LeaderboardPage;
  expect(board).toEqual({ items: [], nextCursor: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aichess/api test src/e2e.test.ts`
Expected: the new test fails only if a previous task is incomplete; with Tasks 1 to 10 done it should pass on the first run. If it fails, the failure points at the task to revisit: 404 on the queue route (Task 8), `paired: 0` (Task 7 or the `owners` option in Task 8), `rating: null` (Task 3).

- [ ] **Step 3: Run the whole api suite**

Run: `pnpm build && pnpm --filter @aichess/api test`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Expected: green.

```bash
git add apps/api/src/e2e.test.ts
git commit -m "test(api): end-to-end matchmaking and rated game over HTTP and SSE"
```

---

### Task 12: Documentation, env example, spec alignment, README status

**Files:**

- Modify: `README.md`
- Modify: `apps/api/README.md`
- Modify: `apps/worker/README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 6, 8, 13)

- [ ] **Step 1: Root README**

In `README.md`:

- Endpoints table: add the rows `| \`GET /v1/agent/me\` | profile, `online`, `activeGameId`, queue membership, rating |`after the events row and`| \`GET /v1/leaderboard\` | public ranking, cursor-paginated |` at the end.
- Rules table: add the row `| Pairing | Rated queue. Rating window of 150, widening by 100 every 10 s up to 1000. Longest wait is served first and the closest rating wins. Agents of one owner never meet |`.
- Status table: replace the `Matchmaking, ratings updates` row with `| Matchmaking, ratings updates | Implemented. Redis queue with atomic Lua scripts, pairing sweep under a lock, colour alternation, Glicko-2 settled in the finishing transaction, rating deltas in \`game.end\`, public leaderboard |`.
- Roadmap: mark step 3 done: `- [x] **3. Matchmaking and ratings.** Queue, pairing by rating, per-game Glicko-2 updates, leaderboard`.
- Test badge: update the count to the number reported by `pnpm test` at the root.

- [ ] **Step 2: App READMEs**

In `apps/api/README.md` route table, replace the `GET /v1/agent/me` row with `| \`GET /v1/agent/me\` | bearer | Agent summary, \`online\`, \`activeGameId\`, \`queue\`, \`rating\` |` and add after it:

```markdown
| `POST /v1/agent/queue` | bearer | Join the rated queue; 409 `already_in_queue` or `in_active_game` |
| `DELETE /v1/agent/queue` | bearer | Leave the queue; 409 `not_in_queue` |
| `GET /v1/leaderboard` | none | Ranked agents (RD <= 110, active), `limit` and `cursor` query, `{ items, nextCursor }` |
```

and to the Notes list add: `- The agent stream opens with \`hello\` carrying the active game and the queue membership; \`queue.joined\` and \`queue.left\` follow the routes, and the worker's pairing sweep sends \`queue.left\` when it drops an agent (offline past the grace period, suspended, or already playing).`

In `apps/worker/README.md` add a bullet after the reconciliation one:

```markdown
- **Matchmaking sweep** every `MATCHMAKING_INTERVAL_MS` under the Redis lock `lock:matchmaking`: reads `mm:queue`, drops entries that are suspended, playing, or offline for longer than `MATCHMAKING_OFFLINE_GRACE_MS`, pairs by rating window (150, +100 every 10 s, max 1000) never matching agents of one owner, alternates colours with each agent's previous game, and starts the game through the shared `GameService`.
```

- [ ] **Step 3: Env example**

In `.env.example`, under `# worker`, add:

```
MATCHMAKING_INTERVAL_MS=3000
MATCHMAKING_OFFLINE_GRACE_MS=15000
```

- [ ] **Step 4: Align the spec**

In `docs/superpowers/specs/2026-09-03-aichess-platform-design.md`:

- Section 6, "### Stream eventi": change the `hello` bullet to ``- `hello`: `{ agentId, activeGame: GameSnapshot | null, queue: { queuedAt } | null }`. Se e' il turno dell'agente, subito dopo arriva un `game.your_turn`.`` and extend the `queue.joined`, `queue.left` bullet with: "`queue.left` arriva anche quando il job di pairing rimuove l'agente dalla coda."
- Section 6, "### Endpoint": change the queue bullets to ``- `POST /v1/agent/queue`: entra in coda. 200 `{ queuedAt }`. 409 `already_in_queue` o `in_active_game`.`` and ``- `DELETE /v1/agent/queue`: esce dalla coda. 200 `{ queuedAt }`. 409 `not_in_queue`.``; change the `me` bullet to ``- `GET /v1/agent/me`: `{ agent, status, online, activeGameId, queue: { queuedAt } | null, rating: { rating, rd, gamesPlayed, provisional } }`.``
- Section 6, "### Endpoint pubblici": change the last bullet to ``- `GET /v1/games`, `GET /v1/agents/{slug}`: letture usate dal web. Paginazione a cursore.`` and add ``- `GET /v1/leaderboard?limit=&cursor=`: `{ items: [{ rank, agent, rating, rd, gamesPlayed }], nextCursor }`, esclusi agenti provvisori o sospesi, ordinato per rating decrescente e RD crescente. `limit` da 1 a 100, default 50.``
- Section 8: append these bullets:

```markdown
- Un agente offline viene saltato; viene rimosso dalla coda, con `queue.left`, solo
  se e' offline da almeno `MATCHMAKING_OFFLINE_GRACE_MS` dall'ingresso in coda,
  cosi' chi entra in coda prima di aprire lo stream non viene scartato al primo giro.
  Vengono rimossi subito gli agenti sospesi o gia' in partita.
- La finestra e' quella dell'agente che cerca, in ordine di attesa; tra i candidati
  validi vince il rating piu' vicino. Ogni agente e' accoppiato al massimo una volta
  per giro.
- Colori: ogni agente preferisce il colore opposto alla partita precedente; in caso
  di conflitto vince chi aspetta da piu' tempo; senza partite precedenti chi aspetta
  da piu' tempo ha il bianco.
- Se la creazione della partita fallisce dopo la rimozione atomica, entrambi gli
  agenti tornano in coda con il `queuedAt` originale e l'errore viene loggato.
- Il job gira ogni `MATCHMAKING_INTERVAL_MS` (3 s) sotto il lock `lock:matchmaking`.
```

- Section 13, extend the variable list with `MATCHMAKING_INTERVAL_MS`, `MATCHMAKING_OFFLINE_GRACE_MS`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm format:check && pnpm lint && pnpm test && pnpm typecheck`
Expected: green; note the total test count for the badge.

```bash
git add README.md apps/api/README.md apps/worker/README.md .env.example docs/superpowers/specs/2026-09-03-aichess-platform-design.md
git commit -m "docs: matchmaking, ratings and leaderboard for roadmap step 3"
```

---

## Plan Self-Review Notes

- **Spec coverage for roadmap step 3.** Section 5 `ratings` and `rating_history` in Task 2. Section 6 queue endpoints, `queue.joined`/`queue.left`, `game.end.rating` and the leaderboard read in Tasks 3, 8 and 9. Section 8 queue keys, 3 s lock-protected job, window 150/+100 per 10 s/max 1000, validity rules (online, different owner, not playing, once per round), atomic removal, `createGame` + `deadline` + `game.start` + `game.your_turn` through `createAndStartGame`, offline removal in Tasks 4 to 7 and 10. Section 9 constants, per-game update in the finishing transaction, aborted games untouched, provisional badge and leaderboard exclusions in Tasks 3 and 9. Section 13 new variables in Tasks 10 and 12. Section 15 "pairing con finestre di rating, esclusione stesso proprietario" in Tasks 5 and 7.
- **Not in this plan.** Unrated queue and house sparring agent (Plan 3b), `GET /v1/games` and `GET /v1/agents/{slug}` (Plan 4 with the web), rating shown on `GameSnapshot` (Plan 4 if the board needs it), tournaments and direct challenges (later iterations).
- **Type consistency checked while writing.** `QueueMembership { queuedAt: number }` (Task 4) is what `MatchmakingService.status`, `toQueueStatus` (Task 6), `hello` and `me` (Task 8) consume; `RatingChanges`/`WireExtras` keep their Plan 2a shape and `NO_RATING_CHANGES` (Task 3) replaces the inline `{ white: null, black: null }`; `GameRatingColumns` is defined in `games/repository.ts` and imported by `rating/settle.ts`; `Candidate` (Task 5) is built by `Matchmaker` (Task 7) from `QueueEntry` + `QueueAgent` + `loadLastColors`; `Matchmaker` takes `Pick<MatchmakingService, "leave">` and `Pick<GameService, "createAndStartGame">` so Task 7's failure test can stub game creation and the worker (Task 10) and the e2e (Task 11) pass the real handles; `LeaderboardCursor` (Task 9 runtime) has no `rank`, the api cursor adds it.
- **Ordering.** Task 1 is additive; `hello.queue` lands in Task 8 with the api that sends it, so `pnpm typecheck` at the root is green after every task. Task 6 touches `apps/api/src/deps.ts` because `AppDeps` mirrors `RuntimeHandle`.
- **Placeholder scan.** No TBD/TODO; every code step has its code; every test has its assertions.
