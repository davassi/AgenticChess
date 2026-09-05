# Unrated Queue and House Sparring Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the arena's first user an opponent — an unrated queue where the anti-self-play rule does not apply, and a house sparring agent running Gemma 3 270M through Ollama that always sits in it.

**Architecture:** A `rated` flag rides inside `GameConfig`, which every layer already carries end to end, and a `games.rated` column stores it. Redis grows a second queue; `pairCandidates` takes an `allowSameOwner` option; `settleRatings` returns early for an unrated game so no rating moves. The bot itself is a new service, `apps/sparring`, that talks to the arena through the published SDK exactly like anybody else's agent, calls Ollama for a move, and falls back to a local pure-function policy whenever the model's answer names no legal move.

**Tech Stack:** TypeScript 5.9, Node 22, pnpm 10 workspaces, turbo, zod 4.5, drizzle-orm 0.45 + drizzle-kit 0.31 (Postgres 17), ioredis 5.6, Fastify (api), Next 16 + React 19 (web), vitest 3.2 with testcontainers, Ollama + `gemma3:270m`.

**Spec:** `docs/superpowers/specs/2026-09-05-unrated-queue-and-house-sparring-design.md`

## Global Constraints

- **Node 22 is required.** The machine's default node is 20. Start every shell with `source ~/.nvm/nvm.sh && nvm use 22` before any `pnpm` command.
- **Ports 5432 and 6379 are taken on this machine.** Anything started by hand must use 55433 (Postgres) and 6380 (Redis). The test suites start their own containers through testcontainers and pick free ports themselves — do not configure them.
- **Work inline on `main`.** No feature branch, no worktree. Commit after every task.
- **Stage explicit paths.** Never `git add -A`: another session edits `site/`.
- **Commit message shape:** a conventional prefix and a sentence that says what changed and why, matching the existing log (`feat(web): a rejected move flashes on the board where it was tried`). Every commit ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
```

- **English** in code, comments, tests and commit messages.
- **TDD, strictly.** Write the failing test, run it and see it fail for the stated reason, write the minimum that passes, run it again, commit.
- **Full type annotations, including return types.** `any` is banned; the eslint config enforces it.
- **Defaults preserve today's behaviour.** `rated` defaults to `true`, `isHouse` to `false`, the queue mode to `"rated"`. A client written against the published API must keep working untouched.
- **Verification gate before each commit** (from the repository root):

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm --filter <the package you touched> test
pnpm typecheck && pnpm lint
```

and before the final commit of the plan: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format`.

## File Structure

**New files**

| Path                                     | Responsibility                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/db/src/sparring.ts`            | Idempotent upsert of the house user and agent from a supplied API key           |
| `packages/db/src/sparring.test.ts`       | Its integration test against real Postgres                                      |
| `packages/db/src/cli/ensure-sparring.ts` | The CLI wrapper that reads the environment and calls it                         |
| `packages/sdk-ts/src/read-move.ts`       | `readMoveFromAnswer`: parse a model's prose into a legal move. No policy        |
| `packages/sdk-ts/src/read-move.test.ts`  | Its tests, moved from the example                                               |
| `apps/sparring/src/config.ts`            | Environment schema for the bot                                                  |
| `apps/sparring/src/prompt.ts`            | Builds the turn prompt. Pure                                                    |
| `apps/sparring/src/policy.ts`            | `greedy` and `random` fallbacks, seeded RNG, material from a FEN. Pure          |
| `apps/sparring/src/ollama.ts`            | The HTTP client for `/api/generate`, with its timeout                           |
| `apps/sparring/src/turn.ts`              | The turn handler: model, then parser, then fallback. The one place that decides |
| `apps/sparring/src/start.ts`             | Wires clients, queue rejoining and the health server                            |
| `apps/sparring/src/main.ts`              | Entry point and signal handling                                                 |
| `apps/sparring/src/health.ts`            | Health endpoint, same shape as the worker's                                     |

**Modified files**

| Path                                                            | Change                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/protocol/enums.ts`                           | `rated` in `DEFAULT_GAME_CONFIG`, `QUEUE_MODES`                                                                                                                                  |
| `packages/core/src/protocol/schemas.ts`                         | `rated` in `GameConfig` and `GameListItem`, `isHouse` in `AgentSummary`, `mode` in `QueueStatus` and `QueueEntryPublic`, `QueueJoinRequestSchema`, `rated` in `GamesQuerySchema` |
| `packages/db/src/schema/games.ts`, `agents.ts`                  | The two columns                                                                                                                                                                  |
| `packages/db/drizzle/`                                          | One generated migration                                                                                                                                                          |
| `packages/db/src/index.ts`                                      | Export the sparring helper                                                                                                                                                       |
| `packages/runtime/src/games/repository.ts`                      | `rated` through `rowToState`, `insertGame`, `loadAgentSummaries`                                                                                                                 |
| `packages/runtime/src/games/listing.ts`                         | `rated` selected, returned and filtered                                                                                                                                          |
| `packages/runtime/src/agents/profile.ts`, `management.ts`       | `isHouse` selected; `loadStats` counts rated games only                                                                                                                          |
| `packages/runtime/src/lobby.ts`                                 | `isHouse`, and both queues                                                                                                                                                       |
| `packages/runtime/src/matchmaking/queue.ts`                     | Two sorted sets, one entry hash carrying the mode                                                                                                                                |
| `packages/runtime/src/matchmaking/pairing.ts`                   | `allowSameOwner`                                                                                                                                                                 |
| `packages/runtime/src/matchmaking/matchmaker.ts`                | One sweep per mode, `rated` passed to game creation                                                                                                                              |
| `packages/runtime/src/matchmaking/service.ts`                   | `join(agentId, mode)`                                                                                                                                                            |
| `packages/runtime/src/rating/settle.ts`                         | Skip an unrated game                                                                                                                                                             |
| `packages/runtime/src/config.ts`                                | `rated: true` in the default game config                                                                                                                                         |
| `packages/runtime/src/testing.ts`                               | `isHouse` in the seeded summaries                                                                                                                                                |
| `apps/api/src/routes/agent.ts`, `games.ts`                      | Queue mode in the body, `rated` in the query                                                                                                                                     |
| `packages/sdk-ts/src/client.ts`, `index.ts`                     | `joinQueue({ mode })`, export the parser                                                                                                                                         |
| `examples/agent-claude/src/choose.ts`, `choose.test.ts`         | Reduced to the fallback decision                                                                                                                                                 |
| `apps/web/src/components/**`                                    | The `training` and `house` badges                                                                                                                                                |
| `apps/web/src/styles/arena.css`                                 | Two chip colours                                                                                                                                                                 |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`   | The sparring service, Ollama, the model pull                                                                                                                                     |
| `.env.example`, `deploy/env.prod.example`, `deploy/init-env.sh` | The new variables                                                                                                                                                                |
| `README.md`                                                     | Status, roadmap and the development section                                                                                                                                      |

---

### Task 1: The flags exist — protocol and database

Nothing reads them yet. This task is complete when a game row can be unrated and an agent row can be the house, and the schemas say so.

**Files:**

- Modify: `packages/core/src/protocol/enums.ts`
- Modify: `packages/core/src/protocol/schemas.ts`
- Modify: `packages/db/src/schema/games.ts`, `packages/db/src/schema/agents.ts`
- Create: `packages/db/drizzle/0003_*.sql` (generated)
- Test: `packages/core/src/protocol/schemas.test.ts`, `packages/db/src/schema.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `GameConfig` gains `rated: boolean`; `DEFAULT_GAME_CONFIG.rated === true`; `AgentSummary` gains `isHouse: boolean`; `GameListItem` gains `rated: boolean`; the drizzle columns `games.rated` and `agents.isHouse`.

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/core/src/protocol/schemas.test.ts`:

```ts
describe("the rated flag and the house flag", () => {
  it("carries rated inside the game config, defaulting to true in DEFAULT_GAME_CONFIG", () => {
    expect(DEFAULT_GAME_CONFIG.rated).toBe(true);
    expect(GameConfigSchema.parse({ ...DEFAULT_GAME_CONFIG })).toMatchObject({ rated: true });
    expect(
      GameConfigSchema.safeParse({ timePerMoveMs: 60_000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 }).success,
    ).toBe(false);
  });

  it("says on every agent summary whether it is the house", () => {
    const summary = {
      id: "0f1d3a8e-2b47-4c9a-8f5e-6d2c1b0a9e88",
      name: "Sparring Partner",
      slug: "sparring",
      modelProvider: "ollama",
      modelName: "gemma3:270m",
      isHouse: true,
    };
    expect(AgentSummarySchema.parse(summary).isHouse).toBe(true);
    const { isHouse: _omitted, ...withoutFlag } = summary;
    expect(AgentSummarySchema.safeParse(withoutFlag).success).toBe(false);
  });

  it("says on every listed game whether it counted", () => {
    expect(GameListItemSchema.shape.rated).toBeDefined();
  });
});
```

Add `DEFAULT_GAME_CONFIG`, `GameConfigSchema`, `AgentSummarySchema` and `GameListItemSchema` to the imports at the top of that file if they are not there already.

- [ ] **Step 2: Run the test and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm --filter @aichess/core test -- schemas
```

Expected: FAIL — `DEFAULT_GAME_CONFIG.rated` is `undefined`, and the schemas accept the objects that should be rejected.

- [ ] **Step 3: Add the fields to the protocol**

In `packages/core/src/protocol/enums.ts`, extend the default:

```ts
export const DEFAULT_GAME_CONFIG = {
  timePerMoveMs: 60_000,
  moveLimitPlies: 300,
  illegalAttemptsPerTurn: 3,
  // Practice games are the exception, so the default is the rated one: a
  // caller that says nothing gets a game that counts.
  rated: true,
} as const;
```

In `packages/core/src/protocol/schemas.ts`:

```ts
export const GameConfigSchema = z.object({
  timePerMoveMs: z.int().min(1_000).max(3_600_000),
  moveLimitPlies: z.int().min(2).max(2_000),
  illegalAttemptsPerTurn: z.int().min(1).max(10),
  /**
   * Whether the result moves the players' ratings. It rides in the config
   * because the config is the one object already carried from `createGame`
   * through the snapshot to the SDK and the board.
   */
  rated: z.boolean(),
});
```

```ts
export const AgentSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  modelProvider: z.string(),
  modelName: z.string(),
  /** The arena's own sparring agent, so a viewer knows who they are looking at. */
  isHouse: z.boolean(),
});
```

and add `rated: z.boolean(),` to `GameListItemSchema`, directly under `status` — the list item does not carry the config, so it needs the flag of its own.

- [ ] **Step 4: Run the core tests and watch them pass**

```bash
pnpm --filter @aichess/core test
```

Expected: PASS. Other packages do not typecheck yet; that is Task 2.

- [ ] **Step 5: Write the failing database test**

In `packages/db/src/schema.test.ts`, add a test beside the existing defaults test:

```ts
it("defaults a game to rated and an agent to not being the house", async () => {
  const [owner] = await tdb.db.insert(users).values({ email: "house@example.com", name: "House" }).returning();
  if (owner === undefined) throw new Error("insert returned nothing");
  const inserted = await tdb.db
    .insert(agents)
    .values([
      {
        ownerId: owner.id,
        name: "Ordinary",
        slug: "ordinary",
        modelProvider: "anthropic",
        modelName: "claude-haiku-4-5",
        apiKeyPrefix: "aaaaaaaa",
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: owner.id,
        name: "Sparring",
        slug: "sparring",
        modelProvider: "ollama",
        modelName: "gemma3:270m",
        apiKeyPrefix: "bbbbbbbb",
        apiKeyHash: "1".repeat(64),
        isHouse: true,
      },
    ])
    .returning();
  const [ordinary, house] = inserted;
  if (ordinary === undefined || house === undefined) throw new Error("agents not inserted");
  expect(ordinary.isHouse).toBe(false);
  expect(house.isHouse).toBe(true);

  const [game] = await tdb.db
    .insert(games)
    .values({
      whiteAgentId: ordinary.id,
      blackAgentId: house.id,
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
      currentFen: START_FEN,
    })
    .returning();
  expect(game?.rated).toBe(true);

  const [practice] = await tdb.db
    .insert(games)
    .values({
      whiteAgentId: ordinary.id,
      blackAgentId: house.id,
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
      currentFen: START_FEN,
      rated: false,
    })
    .returning();
  expect(practice?.rated).toBe(false);
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
pnpm --filter @aichess/db test -- schema
```

Expected: FAIL — `isHouse` and `rated` are not properties of the insert types, and the columns do not exist.

- [ ] **Step 7: Add the columns**

In `packages/db/src/schema/games.ts`, beside `illegalAttemptsPerTurn`:

```ts
    illegalAttemptsPerTurn: integer("illegal_attempts_per_turn").notNull(),
    // Defaults to true so the migration needs no backfill: every game played
    // before this column existed was rated.
    rated: boolean("rated").notNull().default(true),
```

and add `boolean` to the `drizzle-orm/pg-core` import.

In `packages/db/src/schema/agents.ts`, beside `status`:

```ts
    status: agentStatusEnum("status").notNull().default("active"),
    /** The arena's own sparring agent. Excluded from fair-play baselines. */
    isHouse: boolean("is_house").notNull().default(false),
```

adding `boolean` to its import too.

- [ ] **Step 8: Generate the migration**

```bash
pnpm --filter @aichess/db generate
git status --short packages/db/drizzle
```

Expected: a new `packages/db/drizzle/0003_*.sql` plus an updated `meta/_journal.json`. Open the SQL and confirm it is exactly two `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT ...` statements and nothing else. If drizzle-kit proposes anything more, stop and investigate rather than committing it.

- [ ] **Step 9: Run the database tests and watch them pass**

```bash
pnpm --filter @aichess/db test
```

Expected: PASS, including the existing "applies migrations idempotently" test.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/protocol/enums.ts packages/core/src/protocol/schemas.ts \
  packages/core/src/protocol/schemas.test.ts packages/db/src/schema/games.ts \
  packages/db/src/schema/agents.ts packages/db/src/schema.test.ts packages/db/drizzle
git commit -m "$(cat <<'MSG'
feat(core,db): a game can be unrated and an agent can be the house

Both default to what the arena does today - every existing game was rated and
no agent is the house - so the migration needs no backfill and no caller
changes behaviour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 2: The flags travel — runtime mappers

Every place that builds a `GameState`, an `AgentSummary` or a `GameListItem` learns the new fields. After this task the whole workspace typechecks again and the flags survive a round trip through Postgres.

**Files:**

- Modify: `packages/runtime/src/games/repository.ts`, `listing.ts`
- Modify: `packages/runtime/src/agents/profile.ts`, `agents/management.ts`
- Modify: `packages/runtime/src/lobby.ts`, `config.ts`, `testing.ts`
- Test: `packages/runtime/src/games/repository.test.ts`, `packages/runtime/src/games/listing.test.ts`

**Interfaces:**

- Consumes: `GameConfig.rated`, `AgentSummary.isHouse`, `GameListItem.rated`, `games.rated`, `agents.isHouse` from Task 1.
- Produces: `insertGame` persists `state.config.rated`; `loadGame` reads it back; `listGames` returns `rated` per row; every `AgentSummary` built in the runtime carries `isHouse`; `gameConfigFrom(env)` returns `rated: true`.

- [ ] **Step 1: Write the failing round-trip test**

In `packages/runtime/src/games/repository.test.ts`, add:

```ts
it("stores and reads back an unrated game", async () => {
  const players = await seedTwoAgents(db);
  const state = createGame({
    id: randomUUID(),
    whiteAgentId: players.white.id,
    blackAgentId: players.black.id,
    config: { ...DEFAULT_GAME_CONFIG, rated: false },
    now: Date.now(),
  });
  await insertGame(db, state);
  const loaded = await loadGame(db, state.id);
  expect(loaded?.config.rated).toBe(false);
});
```

Use whatever names the surrounding tests already use for the database handle and the seeding helper; do not introduce a second style in the same file.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- games/repository
```

Expected: FAIL — `loaded.config.rated` is `undefined`, because `rowToState` does not read the column.

- [ ] **Step 3: Carry `rated` through the repository**

In `packages/runtime/src/games/repository.ts`, in `rowToState`:

```ts
    config: {
      timePerMoveMs: row.timePerMoveMs,
      moveLimitPlies: row.moveLimitPlies,
      illegalAttemptsPerTurn: row.illegalAttemptsPerTurn,
      rated: row.rated,
    },
```

and in `insertGame`, beside the other config columns:

```ts
    illegalAttemptsPerTurn: state.config.illegalAttemptsPerTurn,
    rated: state.config.rated,
```

`persistTransition` needs no change: `rated` is decided when the game is created and never moves.

In the same file, add `isHouse` to the select in `loadAgentSummaries`:

```ts
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      isHouse: agents.isHouse,
    })
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @aichess/runtime test -- games/repository
```

Expected: PASS.

- [ ] **Step 5: Write the failing listing test**

In `packages/runtime/src/games/listing.test.ts`, add:

```ts
it("says of each listed game whether it counted", async () => {
  const players = await seedTwoAgents(db);
  const rated = await insertFinishedGame(players, { rated: true });
  const practice = await insertFinishedGame(players, { rated: false });
  const rows = await listGames(db, { limit: 10 });
  const byId = new Map(rows.map((row) => [row.id, row]));
  expect(byId.get(rated)?.rated).toBe(true);
  expect(byId.get(practice)?.rated).toBe(false);
  expect(byId.get(rated)?.white.isHouse).toBe(false);
});
```

Reuse the file's existing helper for inserting a game; if it does not take options, extend it with an optional `{ rated?: boolean }` argument defaulting to `true` rather than writing a second helper.

- [ ] **Step 6: Run it and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- games/listing
```

Expected: FAIL — `rated` and `isHouse` are missing from the returned rows.

- [ ] **Step 7: Select and return the flags in the listing**

In `packages/runtime/src/games/listing.ts`, add to the `select` object:

```ts
      id: games.id,
      status: games.status,
      rated: games.rated,
```

add `isHouse: whiteAgent.isHouse,` inside the `white:` sub-object and `isHouse: blackAgent.isHouse,` inside `black:`, and add `rated: row.rated,` to the returned mapping beside `status`.

- [ ] **Step 8: Update the remaining `AgentSummary` builders**

Each of these selects the five summary columns and now needs `isHouse` as well. Add `isHouse: agents.isHouse,` to the select and, where the summary is assembled by hand, `isHouse: row.isHouse,` to the object:

- `packages/runtime/src/lobby.ts` — the `select` inside `loadLobby`.
- `packages/runtime/src/agents/profile.ts` — the selects behind `loadProfile`, `listAgents` and the leaderboard query. In `listAgents` the summary is built explicitly, so add the field there too.
- `packages/runtime/src/agents/management.ts` — `toOwnedAgent`, which builds a summary from an `agents` row: `isHouse: row.isHouse,`.
- `packages/runtime/src/testing.ts` — the `summary` helper inside `seedTwoAgents`: `isHouse: row.isHouse,`.

In `packages/runtime/src/config.ts`, `gameConfigFrom` must produce the new field:

```ts
return {
  timePerMoveMs: env.DEFAULT_TIME_PER_MOVE_MS,
  moveLimitPlies: env.MOVE_LIMIT_PLIES,
  illegalAttemptsPerTurn: env.ILLEGAL_ATTEMPTS_PER_TURN,
  // The arena's default game counts. The unrated queue overrides it per game.
  rated: true,
};
```

- [ ] **Step 9: Typecheck the whole workspace**

```bash
pnpm typecheck
```

Expected: PASS. If `apps/web` or `apps/api` still fail, the failure names a summary or a config built there — fix it in place with the same field, then run again.

- [ ] **Step 10: Run every test**

```bash
pnpm test
```

Expected: PASS. Existing tests that assert on whole summary objects will need `isHouse: false` added to their expectations; that is the correct fix, not a loosening of the assertion.

- [ ] **Step 11: Commit**

```bash
git add packages/runtime/src packages/core/src apps/api/src apps/web/src
git commit -m "$(cat <<'MSG'
feat(runtime): the rated flag and the house flag travel with the game and the agent

rowToState and insertGame carry config.rated, and every place that builds an
AgentSummary now selects is_house, so both facts reach the API, the SDK and
the board without a second read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 3: Two queues in Redis

One sorted set per mode, one hash that says which queue an agent is in. The hash is also the "at most one queue" guard, and it is what lets `leave` work without being told the mode.

**Files:**

- Modify: `packages/core/src/protocol/enums.ts`, `schemas.ts`
- Modify: `packages/runtime/src/matchmaking/queue.ts`, `service.ts`
- Modify: `packages/runtime/src/lobby.ts`
- Modify: `packages/runtime/src/matchmaking/matchmaker.ts` (call sites only)
- Test: `packages/runtime/src/matchmaking/queue.test.ts`, `service.test.ts`, `lobby.test.ts` if present

**Interfaces:**

- Consumes: Task 1's protocol.
- Produces:

```ts
export type QueueMode = "rated" | "unrated";
export const QUEUE_KEYS: Record<QueueMode, string>;   // mm:queue:rated | mm:queue:unrated
export const QUEUE_ENTRY_KEY = "mm:entry";
export interface QueueEntry { agentId: string; rating: number; queuedAt: number; mode: QueueMode }
export interface QueueMembership { queuedAt: number; mode: QueueMode }
class MatchmakingQueue {
  join(agentId: string, rating: number, queuedAt: number, mode: QueueMode): Promise<boolean>;
  leave(agentId: string): Promise<QueueMembership | null>;
  removePair(a: string, b: string, mode: QueueMode): Promise<boolean>;
  status(agentId: string): Promise<QueueMembership | null>;
  entries(mode: QueueMode): Promise<QueueEntry[]>;
  size(mode: QueueMode): Promise<number>;
  clear(): Promise<void>;
}
MatchmakingService.join(agentId: string, mode?: QueueMode): Promise<JoinQueueResult>;  // default "rated"
```

- [ ] **Step 1: Write the failing queue tests**

Replace the mode-less calls in `packages/runtime/src/matchmaking/queue.test.ts` with the four-argument form and add the two new cases:

```ts
it("keeps the two modes apart and reports the mode back", async () => {
  expect(await queue.join("a", 1500, 10, "rated")).toBe(true);
  expect(await queue.join("b", 1400, 12, "unrated")).toBe(true);
  expect(await queue.entries("rated")).toEqual([{ agentId: "a", rating: 1500, queuedAt: 10, mode: "rated" }]);
  expect(await queue.entries("unrated")).toEqual([{ agentId: "b", rating: 1400, queuedAt: 12, mode: "unrated" }]);
  expect(await queue.size("rated")).toBe(1);
  expect(await queue.status("b")).toEqual({ queuedAt: 12, mode: "unrated" });
});

it("refuses a second queue while the agent is in the first, and leaves without being told which", async () => {
  expect(await queue.join("a", 1500, 10, "rated")).toBe(true);
  expect(await queue.join("a", 1500, 11, "unrated")).toBe(false);
  expect(await queue.leave("a")).toEqual({ queuedAt: 10, mode: "rated" });
  expect(await queue.status("a")).toBeNull();
  expect(await redis.zcard(QUEUE_KEYS.rated)).toBe(0);
  expect(await redis.hlen(QUEUE_ENTRY_KEY)).toBe(0);
});

it("removes a pair only from the mode it was queued in", async () => {
  await queue.join("a", 1500, 1, "unrated");
  await queue.join("b", 1500, 2, "unrated");
  expect(await queue.removePair("a", "b", "rated")).toBe(false);
  expect(await queue.removePair("a", "b", "unrated")).toBe(true);
  expect(await queue.size("unrated")).toBe(0);
});
```

Update the imports in that file from `QUEUE_KEY, QUEUE_META_KEY` to `QUEUE_KEYS, QUEUE_ENTRY_KEY`.

- [ ] **Step 2: Run and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm --filter @aichess/runtime test -- matchmaking/queue
```

Expected: FAIL to compile — `QUEUE_KEYS` does not exist and `join` takes three arguments.

- [ ] **Step 3: Add the mode to the protocol**

In `packages/core/src/protocol/enums.ts`:

```ts
export const QUEUE_MODES = ["rated", "unrated"] as const;
export type QueueMode = (typeof QUEUE_MODES)[number];
```

In `packages/core/src/protocol/schemas.ts`, add `QUEUE_MODES` to the import from `./enums.js` and then:

```ts
export const QueueModeSchema = z.enum(QUEUE_MODES);

export const QueueStatusSchema = z.object({
  queuedAt: z.iso.datetime(),
  mode: QueueModeSchema,
});
```

and add `mode: QueueModeSchema,` to `QueueEntryPublicSchema` so the arena can say what someone is waiting for.

- [ ] **Step 4: Rewrite the queue**

`packages/runtime/src/matchmaking/queue.ts` in full:

```ts
import type { QueueMode } from "@aichess/core/protocol";
import type { Redis } from "ioredis";

/**
 * One sorted set per mode, and one hash holding every waiting agent.
 *
 * The hash is deliberately shared. It is what makes "an agent is in at most
 * one queue" a single atomic check instead of two, and it is what lets `leave`
 * find the right sorted set without the caller having to remember which queue
 * the agent joined.
 *
 * The key names are new: the previous single-queue layout used `mm:queue` and
 * `mm:meta`, whose values do not carry a mode. Rather than parse two formats
 * for ever, the old keys are simply abandoned - the queue holds nothing that
 * outlives a deploy.
 */
export const QUEUE_KEYS: Record<QueueMode, string> = {
  rated: "mm:queue:rated",
  unrated: "mm:queue:unrated",
};
export const QUEUE_ENTRY_KEY = "mm:entry";

export interface QueueEntry {
  agentId: string;
  rating: number;
  queuedAt: number;
  mode: QueueMode;
}

export interface QueueMembership {
  queuedAt: number;
  mode: QueueMode;
}

const JOIN_SCRIPT = `
if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 1 then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
return 1`;

const LEAVE_SCRIPT = `
local entry = redis.call("HGET", KEYS[3], ARGV[1])
if not entry then return {0, ""} end
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
redis.call("HDEL", KEYS[3], ARGV[1])
return {1, entry}`;

const REMOVE_PAIR_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
if not redis.call("ZSCORE", KEYS[1], ARGV[2]) then return 0 end
redis.call("ZREM", KEYS[1], ARGV[1], ARGV[2])
redis.call("HDEL", KEYS[2], ARGV[1], ARGV[2])
return 1`;

function encodeEntry(queuedAt: number, mode: QueueMode): string {
  return `${String(queuedAt)}:${mode}`;
}

function parseEntry(agentId: string, raw: string | null | undefined): QueueMembership {
  const [at, mode] = (raw ?? "").split(":");
  const queuedAt = at === undefined ? Number.NaN : Number(at);
  if (!Number.isFinite(queuedAt) || (mode !== "rated" && mode !== "unrated")) {
    throw new Error(`queue metadata missing or corrupt for agent ${agentId}`);
  }
  return { queuedAt, mode };
}

export class MatchmakingQueue {
  constructor(private readonly redis: Redis) {}

  async join(agentId: string, rating: number, queuedAt: number, mode: QueueMode): Promise<boolean> {
    const added = await this.redis.eval(
      JOIN_SCRIPT,
      2,
      QUEUE_KEYS[mode],
      QUEUE_ENTRY_KEY,
      agentId,
      String(rating),
      encodeEntry(queuedAt, mode),
    );
    return added === 1;
  }

  async leave(agentId: string): Promise<QueueMembership | null> {
    const result = (await this.redis.eval(
      LEAVE_SCRIPT,
      3,
      QUEUE_KEYS.rated,
      QUEUE_KEYS.unrated,
      QUEUE_ENTRY_KEY,
      agentId,
    )) as [number, string];
    if (result[0] !== 1) return null;
    return parseEntry(agentId, result[1]);
  }

  async removePair(a: string, b: string, mode: QueueMode): Promise<boolean> {
    const removed = await this.redis.eval(REMOVE_PAIR_SCRIPT, 2, QUEUE_KEYS[mode], QUEUE_ENTRY_KEY, a, b);
    return removed === 1;
  }

  async status(agentId: string): Promise<QueueMembership | null> {
    const raw = await this.redis.hget(QUEUE_ENTRY_KEY, agentId);
    if (raw === null) return null;
    return parseEntry(agentId, raw);
  }

  async entries(mode: QueueMode): Promise<QueueEntry[]> {
    const [members, stored] = await Promise.all([
      this.redis.zrange(QUEUE_KEYS[mode], 0, -1, "WITHSCORES"),
      this.redis.hgetall(QUEUE_ENTRY_KEY),
    ]);
    const out: QueueEntry[] = [];
    for (let i = 0; i + 1 < members.length; i += 2) {
      const agentId = members[i];
      const score = members[i + 1];
      if (agentId === undefined || score === undefined) continue;
      const entry = parseEntry(agentId, stored[agentId]);
      out.push({ agentId, rating: Number(score), queuedAt: entry.queuedAt, mode: entry.mode });
    }
    return out;
  }

  async size(mode: QueueMode): Promise<number> {
    return this.redis.zcard(QUEUE_KEYS[mode]);
  }

  async clear(): Promise<void> {
    await this.redis.del(QUEUE_KEYS.rated, QUEUE_KEYS.unrated, QUEUE_ENTRY_KEY);
  }
}
```

- [ ] **Step 5: Run the queue tests and watch them pass**

```bash
pnpm --filter @aichess/runtime test -- matchmaking/queue
```

Expected: PASS.

- [ ] **Step 6: Teach the service the mode**

In `packages/runtime/src/matchmaking/service.ts`:

```ts
export function toQueueStatus(membership: QueueMembership): QueueStatus {
  return { queuedAt: new Date(membership.queuedAt).toISOString(), mode: membership.mode };
}
```

and in the class:

```ts
  async join(agentId: string, mode: QueueMode = "rated"): Promise<JoinQueueResult> {
    if ((await findActiveGameIdForAgent(this.deps.db, agentId)) !== null) {
      return { ok: false, code: "in_active_game" };
    }
    const rating = await loadRating(this.deps.db, agentId);
    const queuedAt = this.now();
    const added = await this.deps.queue.join(agentId, rating.rating, queuedAt, mode);
    if (!added) return { ok: false, code: "already_in_queue" };
    await this.notify(agentId, { type: "queue.joined", ...toQueueStatus({ queuedAt, mode }) });
    return { ok: true, queuedAt, mode };
  }
```

`JoinQueueResult`'s success branch becomes `{ ok: true; queuedAt: number; mode: QueueMode }` and `LeaveQueueResult`'s becomes `{ ok: true; queuedAt: number; mode: QueueMode }`; `leave` returns the mode the membership came back with. Import `QueueMode` from `@aichess/core/protocol`.

- [ ] **Step 7: Show both queues in the lobby**

In `packages/runtime/src/lobby.ts`:

```ts
const [onlineIds, rated, unrated] = await Promise.all([
  listOnlineAgentIds(redis, limit),
  queue.entries("rated"),
  queue.entries("unrated"),
]);
// Both queues are shown. Someone waiting for practice is still someone
// waiting, and an arena that hid them would look emptier than it is.
const entries = [...rated, ...unrated];
```

and in the `waiting` mapping add `mode: entry.mode` to the object beside `rating` and `queuedAt`.

- [ ] **Step 8: Fix the matchmaker's call sites only**

In `packages/runtime/src/matchmaking/matchmaker.ts`, make the three now-broken calls explicit about the rated queue; Task 4 generalises them:

- `await this.deps.queue.entries()` becomes `await this.deps.queue.entries("rated")`
- `await this.deps.queue.removePair(white, black)` becomes `await this.deps.queue.removePair(white, black, "rated")`
- inside `requeue`, `queue.join(candidate.agentId, candidate.rating, candidate.queuedAt)` gains a fourth argument `"rated"`

- [ ] **Step 9: Run every runtime and api test**

```bash
pnpm --filter @aichess/runtime test && pnpm --filter @aichess/api test
```

Expected: PASS. Tests asserting on a `QueueStatus` need `mode: "rated"` added to their expectation.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/protocol packages/runtime/src/matchmaking packages/runtime/src/lobby.ts \
  packages/runtime/src/matchmaking/queue.test.ts packages/runtime/src/matchmaking/service.test.ts
git commit -m "$(cat <<'MSG'
feat(runtime): a second queue, for games where the rating is not at stake

One sorted set per mode and one shared hash of who is waiting. The hash is the
guard that keeps an agent in a single queue, and it is what lets leave find the
right set without being told the mode.

The key names are new on purpose: the old mm:queue and mm:meta values carry no
mode, and a queue holds nothing that has to survive a deploy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 4: Pairing and the matchmaker, once per mode

**Files:**

- Modify: `packages/runtime/src/matchmaking/pairing.ts`, `matchmaker.ts`
- Test: `packages/runtime/src/matchmaking/pairing.test.ts`, `matchmaker.test.ts`

**Interfaces:**

- Consumes: `QueueMode`, `MatchmakingQueue.entries(mode)`, `removePair(a, b, mode)` from Task 3; `GameConfig.rated` from Task 1.
- Produces:

```ts
export interface PairingOptions {
  window?: PairingWindow;
  allowSameOwner?: boolean;
}
export function pairCandidates(candidates: Candidate[], now: number, options?: PairingOptions): Pair[];
```

`Matchmaker.runOnce()` keeps its signature and its `PairingReport` return, now summed over both modes.

- [ ] **Step 1: Write the failing pairing test**

In `packages/runtime/src/matchmaking/pairing.test.ts`:

```ts
it("pairs two agents of the same owner only when the rating is not at stake", () => {
  const mine = (agentId: string, queuedAt: number): Candidate => ({
    agentId,
    ownerId: "owner-1",
    rating: 1500,
    queuedAt,
    lastColor: null,
  });
  const candidates = [mine("a", 1), mine("b", 2)];

  expect(pairCandidates(candidates, 100)).toEqual([]);

  const pairs = pairCandidates(candidates, 100, { allowSameOwner: true });
  expect(pairs).toHaveLength(1);
  expect([pairs[0]?.white.agentId, pairs[0]?.black.agentId].sort()).toEqual(["a", "b"]);
});
```

Every other call in this file passes the window positionally; change those to `{ window }`.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- matchmaking/pairing
```

Expected: FAIL — the third argument is a `PairingWindow`, so `{ allowSameOwner: true }` does not typecheck, and same-owner candidates are never paired.

- [ ] **Step 3: Give pairing its options**

In `packages/runtime/src/matchmaking/pairing.ts`:

```ts
export interface PairingOptions {
  window?: PairingWindow;
  /**
   * Off by default. A rating built out of an owner playing themselves is not a
   * rating - but in the unrated queue there is no rating to protect, and
   * putting two of your own agents against each other is the point.
   */
  allowSameOwner?: boolean;
}

export function pairCandidates(candidates: Candidate[], now: number, options: PairingOptions = {}): Pair[] {
  const window = options.window ?? DEFAULT_PAIRING_WINDOW;
  const allowSameOwner = options.allowSameOwner ?? false;
  const sorted = [...candidates].sort(byWait);
  const taken = new Set<string>();
  const pairs: Pair[] = [];
  for (const seeker of sorted) {
    if (taken.has(seeker.agentId)) continue;
    const width = windowFor(now - seeker.queuedAt, window);
    let best: { candidate: Candidate; distance: number } | null = null;
    for (const other of sorted) {
      if (other.agentId === seeker.agentId || taken.has(other.agentId)) continue;
      if (!allowSameOwner && other.ownerId === seeker.ownerId) continue;
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

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @aichess/runtime test -- matchmaking/pairing
```

Expected: PASS.

- [ ] **Step 5: Write the failing matchmaker test**

In `packages/runtime/src/matchmaking/matchmaker.test.ts`, add:

```ts
it("pairs inside a mode and never across, and marks the unrated game as such", async () => {
  const players = await seedTwoAgents(db, { owners: "distinct" });
  await markOnline(players.white.id);
  await markOnline(players.black.id);
  await queue.join(players.white.id, 1500, Date.now(), "rated");
  await queue.join(players.black.id, 1500, Date.now(), "unrated");

  expect((await matchmaker.runOnce()).paired).toBe(0);

  await queue.leave(players.white.id);
  await queue.join(players.white.id, 1500, Date.now(), "unrated");
  expect((await matchmaker.runOnce()).paired).toBe(1);

  const [game] = await db.select().from(games).limit(1);
  expect(game?.rated).toBe(false);
});
```

Use the file's existing helpers for the database handle, the presence marker and the matchmaker instance; do not build a second harness.

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- matchmaking/matchmaker
```

Expected: FAIL — the matchmaker only ever reads the rated queue, so the second call pairs nothing.

- [ ] **Step 7: Sweep once per mode**

In `packages/runtime/src/matchmaking/matchmaker.ts`, rename the body of `runOnce` to `sweep(mode)` and add the loop:

```ts
  /** Both queues, in turn. They never see each other's candidates. */
  async runOnce(): Promise<PairingReport> {
    const total: PairingReport = { scanned: 0, paired: 0, dropped: 0 };
    for (const mode of QUEUE_MODES) {
      const report = await this.sweep(mode);
      total.scanned += report.scanned;
      total.paired += report.paired;
      total.dropped += report.dropped;
    }
    return total;
  }

  private async sweep(mode: QueueMode): Promise<PairingReport> {
    const entries = await this.deps.queue.entries(mode);
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

    for (const pair of pairCandidates(candidates, now, { window: this.window, allowSameOwner: mode === "unrated" })) {
      if (await this.startGame(pair, mode)) report.paired += 1;
    }
    if (report.paired > 0 || report.dropped > 0) {
      this.deps.logger.info({ ...report, mode }, "matchmaking applied");
    }
    return report;
  }
```

`startGame` takes the mode and passes it on:

```ts
  private async startGame(pair: Pair, mode: QueueMode): Promise<boolean> {
    const white = pair.white.agentId;
    const black = pair.black.agentId;
    const removed = await this.deps.queue.removePair(white, black, mode);
    if (!removed) return false;
    try {
      const created = await this.deps.games.createAndStartGame({
        whiteAgentId: white,
        blackAgentId: black,
        config: { rated: mode === "rated" },
      });
      if (!created.ok) {
        this.deps.logger.warn({ white, black, mode, code: created.code }, "pairing skipped");
        return false;
      }
      this.deps.logger.info({ gameId: created.snapshot.id, white, black, mode }, "paired");
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error, white, black, mode }, "game creation failed, requeueing pair");
      await this.requeue(pair.white, mode);
      await this.requeue(pair.black, mode);
      throw error;
    }
  }

  private async requeue(candidate: Candidate, mode: QueueMode): Promise<void> {
    try {
      await this.deps.queue.join(candidate.agentId, candidate.rating, candidate.queuedAt, mode);
    } catch (error) {
      this.deps.logger.error({ err: error, agentId: candidate.agentId, mode }, "requeue failed");
    }
  }
```

Import `QUEUE_MODES` and `QueueMode` from `@aichess/core/protocol`. `createAndStartGame` already merges a partial config over the defaults, so passing only `rated` is enough and no signature changes.

- [ ] **Step 8: Run and watch it pass**

```bash
pnpm --filter @aichess/runtime test -- matchmaking
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/matchmaking
git commit -m "$(cat <<'MSG'
feat(runtime): the unrated sweep lets an owner face themselves

pairCandidates takes allowSameOwner and the matchmaker runs the whole sweep
once per queue, passing rated: false to the games the unrated one produces. The
two modes never see each other's candidates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 5: A practice game moves nothing

Settlement skips it, the profile's statistics ignore it, and the listing can filter it out.

**Files:**

- Modify: `packages/runtime/src/rating/settle.ts`
- Modify: `packages/runtime/src/agents/profile.ts`
- Modify: `packages/runtime/src/games/listing.ts`
- Test: `packages/runtime/src/rating/settle.test.ts`, `packages/runtime/src/agents/profile.test.ts`, `packages/runtime/src/games/listing.test.ts`

**Interfaces:**

- Consumes: `GameState.config.rated`, `games.rated`.
- Produces: `GamesListInput` gains `rated?: boolean`. No other signature changes.

- [ ] **Step 1: Write the failing settlement test**

In `packages/runtime/src/rating/settle.test.ts`:

```ts
it("leaves both ratings alone when the game was not rated", async () => {
  const players = await seedTwoAgents(db);
  const before = await loadRating(db, players.white.id);
  const state: GameState = {
    ...finishedState(players),
    config: { ...DEFAULT_GAME_CONFIG, rated: false },
  };

  const settled = await db.transaction((tx) => settleRatings(tx, state, Date.now()));

  expect(settled).toBeNull();
  const after = await loadRating(db, players.white.id);
  expect(after.rating).toBe(before.rating);
  expect(after.gamesPlayed).toBe(before.gamesPlayed);
  const history = await db.select().from(ratingHistory).where(eq(ratingHistory.gameId, state.id));
  expect(history).toEqual([]);
});
```

Build `finishedState` from whatever the file already uses to make a finished game; if it constructs one inline, extract that into a small local helper first and use it from both tests.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- rating/settle
```

Expected: FAIL — the rating moves and a history row appears.

- [ ] **Step 3: Skip the unrated game**

In `packages/runtime/src/rating/settle.ts`, at the top of `settleRatings`:

```ts
export async function settleRatings(tx: Transaction, state: GameState, now: number): Promise<SettledRatings | null> {
  if (state.status !== "finished" || state.result === null) return null;
  // A practice game is played under the same rules and stored like any other.
  // The only difference is here: nothing it produced is allowed to move a
  // rating, so the function reports its existing "nothing to settle" answer
  // before it locks either row.
  if (!state.config.rated) return null;
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @aichess/runtime test -- rating/settle
```

Expected: PASS.

- [ ] **Step 5: Write the failing statistics test**

In `packages/runtime/src/agents/profile.test.ts`:

```ts
it("counts only rated games in the profile statistics", async () => {
  const players = await seedTwoAgents(db);
  await insertFinishedGame(players, { result: "1-0", rated: true });
  await insertFinishedGame(players, { result: "1-0", rated: false });

  const profile = await loadProfile(db, redis, players.white.slug);

  expect(profile?.stats.games).toBe(1);
  expect(profile?.stats.wins).toBe(1);
});
```

Extend the file's existing insert helper with the `rated` option rather than adding a parallel one.

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @aichess/runtime test -- agents/profile
```

Expected: FAIL — `stats.games` is 2.

- [ ] **Step 7: Filter the three aggregates**

In `packages/runtime/src/agents/profile.ts`, inside `loadStats`, add `eq(games.rated, true)` to each of the three `where` clauses — the results query, the moves query and the attempts query. The comment above the second query already explains why the three must agree; extend it:

```ts
// Both aggregates are shown beside `games`, which counts finished rated
// games only: a game still being played, or one played for practice, would
// otherwise drag the averages printed next to a total that excludes it.
```

The rating curve needs no filter: it is read from `rating_history`, where an unrated game never writes a row.

- [ ] **Step 8: Run and watch it pass**

```bash
pnpm --filter @aichess/runtime test -- agents/profile
```

Expected: PASS.

- [ ] **Step 9: Add the listing filter with its test**

In `packages/runtime/src/games/listing.ts`, add `rated?: boolean;` to `GamesListInput` and, with the other conditions:

```ts
if (input.rated !== undefined) conditions.push(eq(games.rated, input.rated));
```

and in `packages/runtime/src/games/listing.test.ts`:

```ts
it("filters by whether the game counted", async () => {
  const players = await seedTwoAgents(db);
  const rated = await insertFinishedGame(players, { rated: true });
  const practice = await insertFinishedGame(players, { rated: false });
  expect((await listGames(db, { limit: 10, rated: true })).map((row) => row.id)).toEqual([rated]);
  expect((await listGames(db, { limit: 10, rated: false })).map((row) => row.id)).toEqual([practice]);
  expect(await listGames(db, { limit: 10 })).toHaveLength(2);
});
```

- [ ] **Step 10: Run the whole runtime suite**

```bash
pnpm --filter @aichess/runtime test
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/runtime/src/rating packages/runtime/src/agents packages/runtime/src/games
git commit -m "$(cat <<'MSG'
feat(runtime): a practice game moves no rating and inflates no record

settleRatings reports its existing "nothing to settle" answer before it locks a
row, and loadStats counts rated games only - all three aggregates, because they
are printed side by side and filtering one would contradict the others. The
rating curve needs nothing: rating_history never sees the game.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 6: The API says which queue

**Files:**

- Modify: `packages/core/src/protocol/schemas.ts` (`QueueJoinRequestSchema`, `rated` in `GamesQuerySchema`)
- Modify: `apps/api/src/routes/agent.ts`, `apps/api/src/routes/games.ts`
- Test: `apps/api/src/routes/agent.test.ts`, `apps/api/src/routes/games.test.ts`

**Interfaces:**

- Consumes: `MatchmakingService.join(agentId, mode)`, `GamesListInput.rated`.
- Produces: `POST /v1/agent/queue` accepts `{ "mode": "rated" | "unrated" }` and defaults to `rated`; `GET /v1/games?rated=true|false`.

- [ ] **Step 1: Write the failing API tests**

In `apps/api/src/routes/agent.test.ts`:

```ts
it("joins the rated queue when the body says nothing", async () => {
  const res = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ mode: "rated" });
});

it("joins the unrated queue when asked, and reports it on /me", async () => {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/agent/queue",
    headers: { ...auth(h.agents.white), "content-type": "application/json" },
    payload: { mode: "unrated" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ mode: "unrated" });

  const me = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers: auth(h.agents.white) });
  expect(me.json().queue).toMatchObject({ mode: "unrated" });
});

it("rejects a mode the arena does not have", async () => {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/agent/queue",
    headers: { ...auth(h.agents.white), "content-type": "application/json" },
    payload: { mode: "friendly" },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("validation_error");
});
```

In `apps/api/src/routes/games.test.ts`:

```ts
it("filters the archive by whether the game counted", async () => {
  const res = await h.app.inject({ method: "GET", url: "/v1/games?rated=false" });
  expect(res.statusCode).toBe(200);
  for (const item of res.json().items) expect(item.rated).toBe(false);
});

it("refuses a rated filter that is not a boolean", async () => {
  const res = await h.app.inject({ method: "GET", url: "/v1/games?rated=maybe" });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm --filter @aichess/api test -- routes/agent
```

Expected: FAIL — the response has no `mode`, an unknown mode is accepted and ignored, and `rated=false` is ignored.

- [ ] **Step 3: Add the request schemas**

In `packages/core/src/protocol/schemas.ts`:

```ts
/** The body of `POST /v1/agent/queue`. Absent means rated, which is what every existing client sends. */
export const QueueJoinRequestSchema = z.object({
  mode: QueueModeSchema.default("rated"),
});
export type QueueJoinRequest = z.infer<typeof QueueJoinRequestSchema>;
```

and in `GamesQuerySchema`, beside `termination`:

```ts
    // z.stringbool, not z.coerce.boolean: the latter parses the string "false"
    // as true, which would silently turn "show me practice games" into "show me
    // everything".
    rated: z.stringbool().optional(),
```

- [ ] **Step 4: Read the mode in the route**

In `apps/api/src/routes/agent.ts`:

```ts
app.post("/v1/agent/queue", { preHandler: [requireAgent(deps), limit] }, async (request) => {
  const agent = assertAgent(request);
  // A POST with no body at all is the shape every client shipped so far
  // sends, and it means the rated queue.
  const { mode } = parseWith(QueueJoinRequestSchema, request.body ?? {}, "body");
  const result = await deps.matchmaking.join(agent.id, mode);
  if (!result.ok) throw new ApiError(result.code, QUEUE_MESSAGES[result.code]);
  const body: QueueStatus = toQueueStatus(result);
  return body;
});
```

Import `QueueJoinRequestSchema` from `@aichess/core/protocol` and `parseWith` from `../validation.js`. The `DELETE` route needs no change: `toQueueStatus` now carries the mode the membership came back with.

- [ ] **Step 5: Pass the filter through the games route**

In `apps/api/src/routes/games.ts`, inside the `listGames` call:

```ts
      ...(query.termination === undefined ? {} : { termination: query.termination }),
      ...(query.rated === undefined ? {} : { rated: query.rated }),
```

- [ ] **Step 6: Run and watch them pass**

```bash
pnpm --filter @aichess/api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/protocol/schemas.ts apps/api/src/routes
git commit -m "$(cat <<'MSG'
feat(api): an agent can ask for a game that does not count

POST /v1/agent/queue takes an optional {mode}; a body-less request still joins
the rated queue, so every client shipped so far keeps working. The archive
gains ?rated=, parsed with z.stringbool because z.coerce.boolean reads the
string "false" as true.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 7: The SDK asks for a mode, and lends out its parser

**Files:**

- Create: `packages/sdk-ts/src/read-move.ts`, `packages/sdk-ts/src/read-move.test.ts`
- Modify: `packages/sdk-ts/src/client.ts`, `packages/sdk-ts/src/index.ts`
- Modify: `examples/agent-claude/src/choose.ts`, `examples/agent-claude/src/choose.test.ts`
- Test: `packages/sdk-ts/src/client.test.ts` (or the file holding the client's tests)

**Interfaces:**

- Consumes: the API from Task 6.
- Produces:

```ts
export function readMoveFromAnswer(answer: string, legalMoves: readonly LegalMove[]): LegalMove | null;
AgenticChessClient.joinQueue(options?: { mode?: QueueMode }): Promise<QueueStatus>;
```

- [ ] **Step 1: Write the failing parser tests**

Create `packages/sdk-ts/src/read-move.test.ts`, moving the parsing cases out of `examples/agent-claude/src/choose.test.ts` and adding the null case:

```ts
import { describe, expect, it } from "vitest";
import { readMoveFromAnswer } from "./read-move.js";

const legal = [
  { san: "Nf3", uci: "g1f3" },
  { san: "Nc3", uci: "b1c3" },
  { san: "d5", uci: "d7d5" },
  { san: "Nxd5", uci: "c3d5" },
  { san: "O-O", uci: "e1g1" },
  { san: "O-O-O", uci: "e1c1" },
];

describe("readMoveFromAnswer", () => {
  it("takes an exact answer as it stands, in either notation", () => {
    expect(readMoveFromAnswer("Nf3", legal)?.san).toBe("Nf3");
    expect(readMoveFromAnswer("g1f3", legal)?.san).toBe("Nf3");
  });

  it("prefers the longest SAN mentioned, so a substring does not win", () => {
    expect(readMoveFromAnswer("I will castle: O-O-O", legal)?.san).toBe("O-O-O");
    expect(readMoveFromAnswer("The knight takes: Nxd5", legal)?.san).toBe("Nxd5");
  });

  it("only reads UCI when no SAN was mentioned at all", () => {
    expect(readMoveFromAnswer("I decided against g1f3 and played Nc3", legal)?.san).toBe("Nc3");
    expect(readMoveFromAnswer("my move is b1c3", legal)?.san).toBe("Nc3");
  });

  it("returns null when the answer names no legal move", () => {
    expect(readMoveFromAnswer("I resign, this is hopeless", legal)).toBeNull();
    expect(readMoveFromAnswer("", legal)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @agenticchess/sdk test
```

Expected: FAIL — `./read-move.js` does not exist.

- [ ] **Step 3: Move the parser into the SDK**

Create `packages/sdk-ts/src/read-move.ts` with the two helpers lifted verbatim from `examples/agent-claude/src/choose.ts` — including their comments, which are the reason the function is shaped the way it is — under a new public entry point:

```ts
import type { LegalMove } from "@aichess/core/protocol";

/**
 * The legal move an answer names, or null.
 *
 * This reads; it does not choose. The client never calls it on the agent's
 * behalf, because deciding what to do with a model that answered something
 * unusable is the agent author's decision and an SDK that quietly corrected a
 * model would corrupt the leaderboard it feeds. It lives here because the
 * reading itself is subtle enough that every agent should not rewrite it.
 *
 * An exact answer wins outright. Otherwise the longest match within one
 * notation is preferred: SAN is checked first ("O-O" is a substring of
 * "O-O-O", and "d5" of "Nxd5", so a first-match search would silently play a
 * different move than the model named), and UCI is only consulted when no
 * move's SAN was mentioned at all. SAN lengths (2-7) and UCI lengths (4-5) are
 * different scales, so ranking a SAN mention against a UCI mention by raw
 * character count is not a "longest match" at all - "I decided against g1f3
 * and played Nc3" would score the rejected Nf3 higher than the played Nc3.
 *
 * When two matches in the same notation are the same length - "I considered
 * Nf3 but played Nc3" - this returns whichever the arena listed first. That is
 * a genuine ambiguity, not a bug this function tries to resolve.
 */
export function readMoveFromAnswer(answer: string, legalMoves: readonly LegalMove[]): LegalMove | null {
  const said = answer.trim();
  if (said === "") return null;
  const exact = legalMoves.find((move) => move.san === said || move.uci === said);
  if (exact !== undefined) return exact;
  return longestMention(said, legalMoves) ?? null;
}
```

with `longestMention` and `longestByNotation` copied below it, unexported.

Export it from `packages/sdk-ts/src/index.ts`:

```ts
export { readMoveFromAnswer } from "./read-move.js";
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @agenticchess/sdk test
```

Expected: PASS.

- [ ] **Step 5: Reduce the example to its decision**

Rewrite `examples/agent-claude/src/choose.ts` so it holds only the policy, importing the parser:

```ts
import { readMoveFromAnswer, type LegalMove, type MoveChoice, type Turn } from "@agenticchess/sdk";

const MAX_QUOTED = 40;

/** The deterministic fallback: the first move the arena listed. */
export function firstLegal(turn: Turn): MoveChoice {
  const move = turn.legalMoves[0];
  if (move === undefined) throw new Error("The arena offered no legal move");
  return { move: move.san, comment: "No model configured: playing the first legal move." };
}

/**
 * Map whatever the model said onto a move the arena will accept.
 *
 * The SDK reads the answer but refuses to decide what to do when it reads
 * nothing: falling back rather than forfeiting the turn is a choice, and it
 * belongs to the agent's author. Here it is explicit, and any author is free
 * to change it.
 */
export function toLegalChoice(answer: string, turn: Turn): MoveChoice {
  const said = answer.trim();
  const read: LegalMove | null = readMoveFromAnswer(said, turn.legalMoves);
  if (read !== null) {
    const exact = read.san === said || read.uci === said;
    return { move: read.san, comment: exact ? `Playing ${read.san}.` : `Read ${read.san} out of the answer.` };
  }
  const quoted = said.slice(0, MAX_QUOTED);
  return {
    move: firstLegal(turn).move,
    comment: `The answer "${quoted}" is not legal here, so I played the first legal move instead.`,
  };
}
```

Add `LegalMove` to the SDK's re-exports in `packages/sdk-ts/src/index.ts` if it is not already there — it is, in the protocol re-export block.

In `examples/agent-claude/src/choose.test.ts`, delete the cases that now live in `read-move.test.ts` and keep the ones about the decision: an exact answer, an answer read out of prose, and an unusable answer falling back to the first legal move with the quoted text in the comment.

- [ ] **Step 6: Write the failing client test**

In the SDK's client test file:

```ts
it("asks for the unrated queue only when told to", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = clientWith(async (url, init) => {
    calls.push({
      path: new URL(url as string).pathname,
      body: init?.body === undefined ? null : JSON.parse(init.body as string),
    });
    return jsonResponse({ queuedAt: new Date().toISOString(), mode: "unrated" });
  });

  await client.joinQueue();
  expect(calls[0]?.body).toBeNull();

  await client.joinQueue({ mode: "unrated" });
  expect(calls[1]?.body).toEqual({ mode: "unrated" });
});
```

Use the file's existing helpers for building a client over a fake fetch and for JSON responses rather than inventing new ones.

- [ ] **Step 7: Run and watch it fail, then add the option**

```bash
pnpm --filter @agenticchess/sdk test
```

Expected: FAIL — `joinQueue` takes no arguments.

In `packages/sdk-ts/src/client.ts`:

```ts
  /**
   * Join a queue. Defaults to the rated one.
   *
   * A join whose response was lost is retried by the HTTP layer and comes back
   * as `already_in_queue`. That is the same outcome the caller asked for, so it
   * is resolved by reading the real state rather than raised as a failure - but
   * only if the arena confirms we are queued.
   */
  async joinQueue(options: { mode?: QueueMode } = {}): Promise<QueueStatus> {
    // Nothing is sent when no mode was asked for, so the request stays exactly
    // the one older versions of this client sent.
    const body = options.mode === undefined ? undefined : { mode: options.mode };
    try {
      return await this.http.requestJson<QueueStatus>("POST", "/v1/agent/queue", body);
    } catch (error) {
      if (!(error instanceof ArenaError) || error.code !== "already_in_queue") throw error;
      const me = await this.me();
      if (me.queue === null) throw error;
      return me.queue;
    }
  }
```

Import `QueueMode` in the type import from `@aichess/core/protocol` and add it to the SDK's re-exports in `index.ts`.

- [ ] **Step 8: Run every SDK and example test**

```bash
pnpm --filter @agenticchess/sdk test && pnpm --filter agent-claude test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk-ts/src examples/agent-claude/src
git commit -m "$(cat <<'MSG'
feat(sdk): joinQueue takes a mode, and the move parser moves in

readMoveFromAnswer is the half of the example's chooser that every agent would
otherwise rewrite: it reads an answer, it never decides. The example keeps the
decision - fall back rather than forfeit - which is the half that belongs to
the author.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 8: The house identity, created idempotently

**Files:**

- Create: `packages/db/src/sparring.ts`, `packages/db/src/sparring.test.ts`, `packages/db/src/cli/ensure-sparring.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `agents.isHouse` from Task 1, `splitApiKey`/`hashApiKey` from `@aichess/core`.
- Produces:

```ts
export interface EnsureSparringInput {
  apiKey: string;
  slug: string;
  name: string;
  description: string;
  ownerEmail: string;
  modelProvider: string;
  modelName: string;
}
export interface EnsuredSparringAgent {
  id: string;
  ownerId: string;
  created: boolean;
}
export function ensureSparringAgent(db: Database, input: EnsureSparringInput): Promise<EnsuredSparringAgent>;
```

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/sparring.test.ts`:

```ts
import { generateApiKey, hashApiKey } from "@aichess/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents } from "./schema/index.js";
import { ensureSparringAgent, type EnsureSparringInput } from "./sparring.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

describe("ensureSparringAgent", () => {
  let tdb: TestDatabase;
  const input = (apiKey: string): EnsureSparringInput => ({
    apiKey,
    slug: "sparring",
    name: "Sparring Partner",
    description: "The arena's house agent. Its games are never rated.",
    ownerEmail: "house@agenticchess.online",
    modelProvider: "ollama",
    modelName: "gemma3:270m",
  });

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("creates the house agent once and is safe to run again", async () => {
    const key = generateApiKey().key;
    const first = await ensureSparringAgent(tdb.db, input(key));
    expect(first.created).toBe(true);

    const second = await ensureSparringAgent(tdb.db, input(key));
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.ownerId).toBe(first.ownerId);

    const rows = await tdb.db.select().from(agents).where(eq(agents.slug, "sparring"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isHouse).toBe(true);
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.apiKeyHash).toBe(hashApiKey(key));
  });

  it("adopts a rotated key", async () => {
    const first = generateApiKey().key;
    await ensureSparringAgent(tdb.db, input(first));
    const rotated = generateApiKey().key;
    await ensureSparringAgent(tdb.db, input(rotated));
    const [row] = await tdb.db.select().from(agents).where(eq(agents.slug, "sparring"));
    expect(row?.apiKeyHash).toBe(hashApiKey(rotated));
  });

  it("refuses a key that is not an arena key", async () => {
    await expect(ensureSparringAgent(tdb.db, input("not-a-key"))).rejects.toThrow(/api key/i);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @aichess/db test -- sparring
```

Expected: FAIL — `./sparring.js` does not exist.

- [ ] **Step 3: Write the helper**

Create `packages/db/src/sparring.ts`:

```ts
import { hashApiKey, splitApiKey } from "@aichess/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { agents } from "./schema/agents.js";
import { users } from "./schema/users.js";

/**
 * The arena's own sparring agent.
 *
 * Unlike `createAgent`, which mints a key and prints it once, this takes the
 * key it is given: the bot's process needs to know it, so it lives in the
 * environment and the database is made to agree with it. That is what makes
 * the function safe to run on every deploy, which is how it is used - a
 * one-shot container beside the migration.
 */

export interface EnsureSparringInput {
  apiKey: string;
  slug: string;
  name: string;
  description: string;
  ownerEmail: string;
  modelProvider: string;
  modelName: string;
}

export interface EnsuredSparringAgent {
  id: string;
  ownerId: string;
  /** False when the agent was already there and this run only reconciled it. */
  created: boolean;
}

export async function ensureSparringAgent(db: Database, input: EnsureSparringInput): Promise<EnsuredSparringAgent> {
  const parts = splitApiKey(input.apiKey);
  if (parts === null) {
    throw new Error("the sparring api key is not an arena api key: expected the ac_ form issued by generateApiKey");
  }
  const apiKeyPrefix = parts.prefix;
  const apiKeyHash = hashApiKey(input.apiKey);

  return db.transaction(async (tx): Promise<EnsuredSparringAgent> => {
    const [owner] = await tx
      .insert(users)
      .values({ email: input.ownerEmail, name: input.name })
      .onConflictDoUpdate({ target: users.email, set: { updatedAt: new Date() } })
      .returning({ id: users.id });
    if (owner === undefined) throw new Error("the house owner was not inserted");

    const [existing] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.slug, input.slug));
    if (existing !== undefined) {
      await tx
        .update(agents)
        .set({
          ownerId: owner.id,
          name: input.name,
          description: input.description,
          modelProvider: input.modelProvider,
          modelName: input.modelName,
          apiKeyPrefix,
          apiKeyHash,
          isHouse: true,
          // A suspended house agent would leave the unrated queue empty with
          // no sign of why, so a deploy puts it back in service.
          status: "active",
          suspendedReason: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, existing.id));
      return { id: existing.id, ownerId: owner.id, created: false };
    }

    const [created] = await tx
      .insert(agents)
      .values({
        ownerId: owner.id,
        name: input.name,
        slug: input.slug,
        description: input.description,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        apiKeyPrefix,
        apiKeyHash,
        isHouse: true,
      })
      .returning({ id: agents.id });
    if (created === undefined) throw new Error("the sparring agent was not inserted");
    return { id: created.id, ownerId: owner.id, created: true };
  });
}
```

Export it from `packages/db/src/index.ts` beside `createAgent`:

```ts
export { ensureSparringAgent, type EnsureSparringInput, type EnsuredSparringAgent } from "./sparring.js";
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @aichess/db test -- sparring
```

Expected: PASS. If the `users` upsert fails because `email` has no unique constraint in the generated types, check `packages/db/src/schema/users.ts` — it is declared `.unique()`, so `onConflictDoUpdate({ target: users.email })` is valid.

- [ ] **Step 5: Write the CLI**

Create `packages/db/src/cli/ensure-sparring.ts`:

```ts
import { createDb } from "../client.js";
import { ensureSparringAgent } from "../sparring.js";

/**
 * Makes the database agree with the sparring bot's environment.
 *
 * Runs as a one-shot beside the migration:
 *
 *   docker compose -f docker-compose.prod.yml run --rm --no-deps api \
 *     node packages/db/dist/cli/ensure-sparring.js
 */

const url = process.env["DATABASE_URL"];
const apiKey = process.env["SPARRING_API_KEY"];

if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (apiKey === undefined || apiKey.length === 0) {
  console.error("SPARRING_API_KEY is required: it is the key the sparring service authenticates with");
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  const agent = await ensureSparringAgent(handle.db, {
    apiKey,
    slug: process.env["SPARRING_SLUG"] ?? "sparring",
    name: process.env["SPARRING_NAME"] ?? "Sparring Partner",
    description:
      process.env["SPARRING_DESCRIPTION"] ??
      "The arena's house agent. It plays gemma3:270m through Ollama, sits in the unrated queue, and its games never move a rating.",
    ownerEmail: process.env["SPARRING_OWNER_EMAIL"] ?? "house@agenticchess.online",
    modelProvider: process.env["SPARRING_MODEL_PROVIDER"] ?? "ollama",
    modelName: process.env["SPARRING_MODEL"] ?? "gemma3:270m",
  });
  console.log(`sparring agent ${agent.created ? "created" : "already present"}: ${agent.id}`);
} catch (error) {
  console.error("could not ensure the sparring agent:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
```

- [ ] **Step 6: Build the package and run the CLI against a throwaway database**

```bash
docker run -d --rm --name aichess-plan3b-pg -e POSTGRES_USER=aichess -e POSTGRES_PASSWORD=aichess \
  -e POSTGRES_DB=aichess -p 55433:5432 postgres:17-alpine
export DATABASE_URL=postgres://aichess:aichess@localhost:55433/aichess
pnpm --filter @aichess/db migrate
SPARRING_API_KEY=$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('base64url')+require('node:crypto').randomBytes(32).toString('base64url'))" | sed 's/^/ac_/') \
  node packages/db/dist/cli/ensure-sparring.js
```

Expected: `sparring agent created: <uuid>`. Run the same command twice and expect `already present` the second time. Then `docker rm -f aichess-plan3b-pg`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sparring.ts packages/db/src/sparring.test.ts \
  packages/db/src/cli/ensure-sparring.ts packages/db/src/index.ts
git commit -m "$(cat <<'MSG'
feat(db): the house agent is created from the key the deploy already holds

createAgent mints a key and shows it once, which is no good for a service that
has to authenticate with it. This takes the key from the environment and makes
the database agree - safe on every deploy, and it adopts a rotated key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 9: `apps/sparring` — the parts that are pure

The package, the prompt and the fallback policies. No network, no arena: everything here is a function of its arguments and is tested as one.

**Files:**

- Create: `apps/sparring/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `apps/sparring/src/config.ts`, `prompt.ts`, `policy.ts`
- Test: `apps/sparring/src/policy.test.ts`, `prompt.test.ts`, `config.test.ts`

**Interfaces:**

- Consumes: `Turn` and `LegalMove` from `@agenticchess/sdk`, `tryMove` and `turnOf` from `@aichess/core`.
- Produces:

```ts
export type Fallback = "greedy" | "random";
export function seededRandom(seed: number): () => number;
export function materialFor(fen: string, color: Color): number;
export function chooseByPolicy(
  fen: string,
  legal: readonly LegalMove[],
  fallback: Fallback,
  random: () => number,
): LegalMove;
export function buildPrompt(turn: Turn): string;
export function loadConfig(env?: NodeJS.ProcessEnv): SparringConfig;
export class ConfigError extends Error {}
```

- [ ] **Step 1: Create the package**

`apps/sparring/package.json`:

```json
{
  "name": "@aichess/sparring",
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
    "@agenticchess/sdk": "workspace:*",
    "@aichess/core": "workspace:*",
    "pino": "^10.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/sparring/tsconfig.json`:

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

`apps/sparring/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/sparring/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string): string => fileURLToPath(new URL(`../../packages/${path}/src`, import.meta.url));
const core = src("core");
const sdk = src("sdk-ts");

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${core}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${core}/protocol/index.ts` },
      { find: /^@agenticchess\/sdk$/, replacement: `${sdk}/index.ts` },
    ],
  },
});
```

Then install so the workspace links exist:

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm install
```

- [ ] **Step 2: Write the failing policy tests**

Create `apps/sparring/src/policy.test.ts`:

```ts
import { legalMoves } from "@aichess/core";
import { describe, expect, it } from "vitest";
import { chooseByPolicy, materialFor, seededRandom } from "./policy.js";

// White to move with a free black queen on d5, reachable by the knight on c3.
const FREE_QUEEN = "rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 4";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("materialFor", () => {
  it("counts the position from the named side's point of view", () => {
    expect(materialFor(START, "white")).toBe(0);
    expect(materialFor(FREE_QUEEN, "white")).toBe(9);
    expect(materialFor(FREE_QUEEN, "black")).toBe(-9);
  });
});

describe("chooseByPolicy", () => {
  it("takes the free queen when it is greedy", () => {
    const move = chooseByPolicy(FREE_QUEEN, legalMoves(FREE_QUEEN), "greedy", seededRandom(1));
    expect(move.san).toBe("Nxd5");
  });

  it("stays inside the legal list when it is random, and repeats with the same seed", () => {
    const legal = legalMoves(START);
    const first = chooseByPolicy(START, legal, "random", seededRandom(7));
    const again = chooseByPolicy(START, legal, "random", seededRandom(7));
    expect(legal.map((move) => move.san)).toContain(first.san);
    expect(again.san).toBe(first.san);
  });

  it("does not always answer the same thing when nothing is winnable", () => {
    const legal = legalMoves(START);
    const random = seededRandom(3);
    const played = new Set(Array.from({ length: 20 }, () => chooseByPolicy(START, legal, "greedy", random).san));
    expect(played.size).toBeGreaterThan(1);
  });

  it("refuses an empty list rather than inventing a move", () => {
    expect(() => chooseByPolicy(START, [], "greedy", seededRandom(1))).toThrow(/no legal move/i);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter @aichess/sparring test
```

Expected: FAIL — `./policy.js` does not exist.

- [ ] **Step 4: Write the policies**

Create `apps/sparring/src/policy.ts`:

```ts
import { tryMove, turnOf } from "@aichess/core";
import type { Color, LegalMove } from "@aichess/core/protocol";

/**
 * What the bot plays when the model's answer is unusable.
 *
 * `greedy` is the default because a deterministic fallback plus a model that
 * often answers nothing usable would produce the same game every time. Both
 * take their randomness as an argument so a game can be reproduced from a seed.
 */
export type Fallback = "greedy" | "random";

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** mulberry32: small, fast, and good enough to break ties without a dependency. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Own material minus the opponent's, read straight out of the placement field. */
export function materialFor(fen: string, color: Color): number {
  const placement = fen.split(" ")[0] ?? "";
  let score = 0;
  for (const char of placement) {
    const value = VALUES[char.toLowerCase()];
    if (value === undefined) continue;
    const belongsToWhite = char === char.toUpperCase();
    score += (belongsToWhite === (color === "white") ? 1 : -1) * value;
  }
  return score;
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)] ?? items[0];
  if (item === undefined) throw new Error("the arena offered no legal move");
  return item;
}

/**
 * Score every legal move by the material it leaves behind and play the best,
 * ties broken at random. Scoring the resulting position rather than reading the
 * SAN is what makes en passant and promotions come out right without this file
 * knowing anything about either.
 */
export function chooseByPolicy(
  fen: string,
  legal: readonly LegalMove[],
  fallback: Fallback,
  random: () => number,
): LegalMove {
  if (legal.length === 0) throw new Error("the arena offered no legal move");
  if (fallback === "random") return pickOne(legal, random);

  const mover = turnOf(fen);
  let best: LegalMove[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of legal) {
    const played = tryMove(fen, move.san);
    // A move the arena listed and the rules engine refuses is a disagreement
    // between two things that should agree. Skipping it lets the rest of the
    // list decide instead of throwing away the turn.
    if (!played.ok) continue;
    const score = materialFor(played.move.fenAfter, mover);
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return pickOne(best.length === 0 ? legal : best, random);
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter @aichess/sparring test
```

Expected: PASS.

- [ ] **Step 6: Write the prompt with its test**

Create `apps/sparring/src/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";
import type { Turn } from "@agenticchess/sdk";

const turn = (history: string[]): Turn => ({
  gameId: "g",
  ply: history.length,
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  history,
  lastMove: null,
  legalMoves: [
    { san: "e4", uci: "e2e4" },
    { san: "d4", uci: "d2d4" },
  ],
  deadlineAt: "2026-09-05T10:00:00.000Z",
  attemptsLeft: 3,
  remainingMs: () => 60_000,
});

describe("buildPrompt", () => {
  it("offers the legal moves as a closed list", () => {
    const prompt = buildPrompt(turn([]));
    expect(prompt).toContain("e4 d4");
    expect(prompt).toContain("none");
  });

  it("keeps the history short, because the position is in the FEN", () => {
    const long = Array.from({ length: 40 }, (_unused, index) => `m${String(index)}`);
    const prompt = buildPrompt(turn(long));
    expect(prompt).not.toContain("m0 ");
    expect(prompt).toContain("m39");
  });
});
```

Create `apps/sparring/src/prompt.ts`:

```ts
import type { Turn } from "@agenticchess/sdk";

/**
 * How many half-moves of history to show.
 *
 * The FEN already is the position, so the history is context rather than
 * information, and a 270M model on two shared vCPUs pays for every token it
 * reads. Twelve plies is enough to see what just happened.
 */
const RECENT_PLIES = 12;

export function buildPrompt(turn: Turn): string {
  const recent = turn.history.slice(-RECENT_PLIES).join(" ");
  return [
    "You are playing a chess game. Answer with one move and nothing else.",
    `Position (FEN): ${turn.fen}`,
    `Recent moves: ${recent === "" ? "none" : recent}`,
    `Legal moves: ${turn.legalMoves.map((move) => move.san).join(" ")}`,
    "Answer with exactly one move copied from that list. No explanation.",
  ].join("\n");
}
```

- [ ] **Step 7: Write the configuration with its test**

Create `apps/sparring/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const KEY = `ac_${"a".repeat(8)}${"b".repeat(43)}`;

describe("loadConfig", () => {
  it("fills in every default around the one required value", () => {
    const config = loadConfig({ SPARRING_API_KEY: KEY });
    expect(config.apiKeys).toEqual([KEY]);
    expect(config.model).toBe("gemma3:270m");
    expect(config.fallback).toBe("greedy");
    expect(config.enabled).toBe(true);
    expect(config.timeoutMs).toBeLessThan(60_000);
  });

  it("reads several identities from one variable", () => {
    const second = `ac_${"c".repeat(8)}${"d".repeat(43)}`;
    expect(loadConfig({ SPARRING_API_KEY: `${KEY}, ${second}` }).apiKeys).toEqual([KEY, second]);
  });

  it("says what is missing instead of starting without a key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("reads SPARRING_ENABLED=false as false", () => {
    expect(loadConfig({ SPARRING_API_KEY: KEY, SPARRING_ENABLED: "false" }).enabled).toBe(false);
  });
});
```

Create `apps/sparring/src/config.ts`:

```ts
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const EnvSchema = z.object({
  // z.stringbool, not z.coerce.boolean: the latter reads "false" as true, and
  // an off switch that cannot be switched off is worse than none.
  SPARRING_ENABLED: z.stringbool().default(true),
  SPARRING_API_KEY: z.string().min(1),
  SPARRING_BASE_URL: z.url().default("http://api:3001"),
  OLLAMA_URL: z.url().default("http://ollama:11434"),
  SPARRING_MODEL: z.string().min(1).default("gemma3:270m"),
  // Far below the arena's 60 s turn, so a slow generation costs a fallback
  // move rather than the game.
  SPARRING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(45_000).default(15_000),
  SPARRING_FALLBACK: z.enum(["greedy", "random"]).default("greedy"),
  SPARRING_SEED: z.coerce.number().int().optional(),
  SPARRING_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3003),
  SPARRING_HEALTH_HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.string().min(1).default("info"),
});

export interface SparringConfig {
  enabled: boolean;
  apiKeys: string[];
  baseUrl: string;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
  fallback: "greedy" | "random";
  seed: number;
  healthPort: number;
  healthHost: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SparringConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ConfigError(`the sparring service cannot start: ${issues}`);
  }
  const value = parsed.data;
  const apiKeys = value.SPARRING_API_KEY.split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (apiKeys.length === 0) throw new ConfigError("SPARRING_API_KEY holds no key");
  return {
    enabled: value.SPARRING_ENABLED,
    apiKeys,
    baseUrl: value.SPARRING_BASE_URL,
    ollamaUrl: value.OLLAMA_URL,
    model: value.SPARRING_MODEL,
    timeoutMs: value.SPARRING_TIMEOUT_MS,
    fallback: value.SPARRING_FALLBACK,
    seed: value.SPARRING_SEED ?? Date.now(),
    healthPort: value.SPARRING_HEALTH_PORT,
    healthHost: value.SPARRING_HEALTH_HOST,
    logLevel: value.LOG_LEVEL,
  };
}
```

- [ ] **Step 8: Run the package's tests, then typecheck and lint**

```bash
pnpm --filter @aichess/sparring test && pnpm --filter @aichess/sparring typecheck && pnpm --filter @aichess/sparring lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/sparring pnpm-lock.yaml
git commit -m "$(cat <<'MSG'
feat(sparring): the house bot's pure half - prompt, policies, configuration

The fallback scores every legal move by the material its own result leaves,
which gets en passant and promotions right without this file knowing either
exists. Randomness is an argument, so a game replays from a seed - and a greedy
bot that never randomises would play the same game every time.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 10: `apps/sparring` — the model, the turn, the service

**Files:**

- Create: `apps/sparring/src/ollama.ts`, `turn.ts`, `health.ts`, `start.ts`, `main.ts`
- Test: `apps/sparring/src/ollama.test.ts`, `apps/sparring/src/turn.test.ts`

**Interfaces:**

- Consumes: `buildPrompt`, `chooseByPolicy`, `seededRandom`, `Fallback`, `SparringConfig` from Task 9; `readMoveFromAnswer`, `AgenticChessClient`, `Turn`, `MoveChoice` from Task 7.
- Produces:

```ts
export class OllamaError extends Error {
  readonly reason: "timeout" | "unreachable" | "bad_response";
}
export class OllamaClient {
  generate(prompt: string): Promise<string>;
}
export function createTurnHandler(deps: TurnHandlerDeps): (turn: Turn) => Promise<MoveChoice>;
export function startSparring(config: SparringConfig, logger: Logger): Promise<SparringService>;
```

- [ ] **Step 1: Write the failing Ollama tests**

Create `apps/sparring/src/ollama.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OllamaClient, OllamaError } from "./ollama.js";

const options = { url: "http://ollama.test", model: "gemma3:270m", timeoutMs: 50 };

function client(fetchImpl: typeof fetch): OllamaClient {
  return new OllamaClient({ ...options, fetch: fetchImpl });
}

describe("OllamaClient", () => {
  it("posts the prompt and returns what the model said", async () => {
    let seen: unknown = null;
    const answer = await client(async (url, init) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ response: " Nf3 " }), { status: 200 });
    }).generate("play something");
    expect(answer).toBe("Nf3");
    expect(seen).toMatchObject({
      url: "http://ollama.test/api/generate",
      body: { model: "gemma3:270m", prompt: "play something", stream: false },
    });
  });

  it("reports a timeout as a timeout", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    await expect(client(hanging).generate("x")).rejects.toMatchObject({ reason: "timeout" });
  });

  it("reports an unreachable server as unreachable", async () => {
    const refused: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    await expect(client(refused).generate("x")).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("reports a body it cannot read", async () => {
    const nonsense: typeof fetch = async () => new Response("not json", { status: 200 });
    await expect(client(nonsense).generate("x")).rejects.toBeInstanceOf(OllamaError);
  });

  it("reports a refusal from the server", async () => {
    const failing: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "model not found" }), { status: 404 });
    await expect(client(failing).generate("x")).rejects.toMatchObject({ reason: "bad_response" });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @aichess/sparring test -- ollama
```

Expected: FAIL — `./ollama.js` does not exist.

- [ ] **Step 3: Write the Ollama client**

Create `apps/sparring/src/ollama.ts`:

```ts
export type OllamaFailure = "timeout" | "unreachable" | "bad_response";

/** Carries why the model did not answer, so the move's comment can say it. */
export class OllamaError extends Error {
  constructor(
    readonly reason: OllamaFailure,
    message: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs: number;
  /** Injected so tests never open a socket. */
  fetch?: typeof fetch;
  numPredict?: number;
  temperature?: number;
}

const DEFAULT_NUM_PREDICT = 16;
const DEFAULT_TEMPERATURE = 0.3;

export class OllamaClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  /**
   * One generation, capped by its own timer.
   *
   * The timer is the whole reliability story: the arena gives a turn 60 s, and
   * a bot that waits for a model that will never answer loses on time and looks
   * like the newcomer's bug rather than ours.
   */
  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);
    try {
      const response = await this.doFetch(`${this.options.url.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          prompt,
          stream: false,
          options: {
            num_predict: this.options.numPredict ?? DEFAULT_NUM_PREDICT,
            temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OllamaError("bad_response", `ollama answered ${String(response.status)}`);
      }
      const body: unknown = await response.json().catch(() => null);
      if (typeof body !== "object" || body === null || typeof (body as { response?: unknown }).response !== "string") {
        throw new OllamaError("bad_response", "ollama returned a body with no response field");
      }
      return (body as { response: string }).response.trim();
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OllamaError("timeout", `ollama did not answer within ${String(this.options.timeoutMs)} ms`);
      }
      throw new OllamaError("unreachable", `ollama is unreachable: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @aichess/sparring test -- ollama
```

Expected: PASS.

- [ ] **Step 5: Write the failing turn-handler tests**

Create `apps/sparring/src/turn.test.ts`:

```ts
import { legalMoves } from "@aichess/core";
import type { Turn } from "@agenticchess/sdk";
import { describe, expect, it } from "vitest";
import { OllamaError } from "./ollama.js";
import { seededRandom } from "./policy.js";
import { createTurnHandler } from "./turn.js";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const turn: Turn = {
  gameId: "g",
  ply: 0,
  fen: FEN,
  history: [],
  lastMove: null,
  legalMoves: legalMoves(FEN),
  deadlineAt: "2026-09-05T10:00:00.000Z",
  attemptsLeft: 3,
  remainingMs: () => 60_000,
};

const handler = (generate: (prompt: string) => Promise<string>) =>
  createTurnHandler({
    brain: { generate },
    fallback: "greedy",
    random: seededRandom(1),
    label: "gemma3:270m",
  });

describe("createTurnHandler", () => {
  it("plays the move the model named and quotes it", async () => {
    const choice = await handler(async () => "e4")(turn);
    expect(choice.move).toBe("e4");
    expect(choice.comment).toContain("gemma3:270m");
  });

  it("falls back when the answer names no legal move, and says so", async () => {
    const choice = await handler(async () => "I would like to castle immediately")(turn);
    expect(turn.legalMoves.map((move) => move.san)).toContain(choice.move);
    expect(choice.comment).toMatch(/names no legal move/i);
    expect(choice.comment).toContain("greedy");
  });

  it("falls back when the model does not answer, and names the reason", async () => {
    const choice = await handler(() => Promise.reject(new OllamaError("timeout", "too slow")))(turn);
    expect(turn.legalMoves.map((move) => move.san)).toContain(choice.move);
    expect(choice.comment).toMatch(/timeout/);
  });

  it("plays without a model at all", async () => {
    const choice = await createTurnHandler({
      brain: null,
      fallback: "random",
      random: seededRandom(2),
      label: "gemma3:270m",
    })(turn);
    expect(turn.legalMoves.map((move) => move.san)).toContain(choice.move);
  });

  it("never writes a comment the arena would reject", async () => {
    const choice = await handler(async () => "x".repeat(2_000))(turn);
    expect(choice.comment?.length ?? 0).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @aichess/sparring test -- turn
```

Expected: FAIL — `./turn.js` does not exist.

- [ ] **Step 7: Write the turn handler**

Create `apps/sparring/src/turn.ts`:

```ts
import { MAX_COMMENT_LENGTH } from "@aichess/core/protocol";
import { readMoveFromAnswer, type MoveChoice, type Turn } from "@agenticchess/sdk";
import { OllamaError } from "./ollama.js";
import { buildPrompt } from "./prompt.js";
import { chooseByPolicy, type Fallback } from "./policy.js";

const MAX_QUOTED = 60;

export interface TurnBrain {
  generate: (prompt: string) => Promise<string>;
}

export type MoveSource = "model" | "unusable_answer" | "no_answer";

export interface TurnHandlerDeps {
  /** Null when no model is configured: the bot still plays. */
  brain: TurnBrain | null;
  fallback: Fallback;
  random: () => number;
  /** What to call the model in the comment, e.g. "gemma3:270m". */
  label: string;
  onDecision?: (decision: { source: MoveSource; san: string }) => void;
}

function trim(comment: string): string {
  return comment.length <= MAX_COMMENT_LENGTH ? comment : `${comment.slice(0, MAX_COMMENT_LENGTH - 1)}…`;
}

function reasonOf(error: unknown): string {
  return error instanceof OllamaError ? error.reason : "error";
}

/**
 * Model first, then the parser, then the local policy - and the comment always
 * says which of the three produced the move.
 *
 * A 270M model will often answer something that names no legal move, so the
 * fallback shapes a good share of every practice game. Saying so on the move
 * is what keeps a spectator from mistaking the fallback's chess for the
 * model's.
 */
export function createTurnHandler(deps: TurnHandlerDeps): (turn: Turn) => Promise<MoveChoice> {
  const fallbackMove = (turn: Turn): string =>
    chooseByPolicy(turn.fen, turn.legalMoves, deps.fallback, deps.random).san;

  const decide = (source: MoveSource, move: string, comment: string): MoveChoice => {
    deps.onDecision?.({ source, san: move });
    return { move, comment: trim(comment) };
  };

  return async (turn: Turn): Promise<MoveChoice> => {
    if (deps.brain === null) {
      const move = fallbackMove(turn);
      return decide("no_answer", move, `No model is configured, so the ${deps.fallback} fallback played ${move}.`);
    }
    let said: string;
    try {
      said = await deps.brain.generate(buildPrompt(turn));
    } catch (error) {
      const move = fallbackMove(turn);
      return decide(
        "no_answer",
        move,
        `${deps.label} did not answer (${reasonOf(error)}), so the ${deps.fallback} fallback played ${move}.`,
      );
    }
    const read = readMoveFromAnswer(said, turn.legalMoves);
    if (read !== null) return decide("model", read.san, `${deps.label}: ${said}`);
    const move = fallbackMove(turn);
    return decide(
      "unusable_answer",
      move,
      `${deps.label} answered "${said.slice(0, MAX_QUOTED)}", which names no legal move, so the ${deps.fallback} fallback played ${move}.`,
    );
  };
}
```

- [ ] **Step 8: Run and watch it pass**

```bash
pnpm --filter @aichess/sparring test
```

Expected: PASS.

- [ ] **Step 9: Wire the service**

Copy `apps/worker/src/health.ts` to `apps/sparring/src/health.ts` unchanged — it is a generic health endpoint and the two services need exactly the same one.

Create `apps/sparring/src/start.ts`:

```ts
import { AgenticChessClient } from "@agenticchess/sdk";
import type { Logger } from "pino";
import type { SparringConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health.js";
import { OllamaClient } from "./ollama.js";
import { seededRandom } from "./policy.js";
import { createTurnHandler } from "./turn.js";

export interface SparringService {
  healthPort: number;
  stop: () => Promise<void>;
}

export async function startSparring(config: SparringConfig, logger: Logger): Promise<SparringService> {
  const brain = new OllamaClient({
    url: config.ollamaUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
  const clients: AgenticChessClient[] = [];
  let healthy = true;

  config.apiKeys.forEach((apiKey, index) => {
    const client = new AgenticChessClient({
      apiKey,
      baseUrl: config.baseUrl,
      onEvent: (event) => {
        if (event.type === "game.start") logger.info({ gameId: event.gameId, color: event.color }, "game started");
        if (event.type === "game.end") {
          logger.info({ gameId: event.gameId, result: event.result }, "game ended");
          // One game is not a career: back into the practice queue, or the
          // next newcomer finds nobody waiting.
          void client.joinQueue({ mode: "unrated" }).catch((error: unknown) => {
            logger.error({ err: error }, "could not re-queue");
          });
        }
      },
      onError: (error) => {
        logger.warn({ err: error }, "recovered");
      },
    });
    client.onYourTurn(
      createTurnHandler({
        brain,
        fallback: config.fallback,
        // A different stream per identity, so two house agents in the same
        // position do not play the same fallback move.
        random: seededRandom(config.seed + index),
        label: config.model,
        onDecision: ({ source, san }) => {
          logger.info({ source, san }, "move chosen");
        },
      }),
    );
    clients.push(client);
  });

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.joinQueue({ mode: "unrated" });
      } catch (error) {
        // Already playing is the normal shape of a restart mid-game: the hello
        // event carries the game and the turn handler picks it up.
        logger.warn({ err: error }, "could not join the practice queue at start-up");
      }
      void client.run().catch((error: unknown) => {
        healthy = false;
        logger.error({ err: error }, "the arena stream stopped for good");
      });
    }),
  );

  const health: HealthServer = await startHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    check: () => Promise.resolve(healthy),
  });

  return {
    healthPort: health.port,
    stop: async (): Promise<void> => {
      for (const client of clients) client.stop();
      await health.close();
    },
  };
}
```

Create `apps/sparring/src/main.ts`, mirroring `apps/worker/src/main.ts`:

```ts
import pino from "pino";
import { ConfigError, loadConfig, type SparringConfig } from "./config.js";
import { startSparring } from "./start.js";

function readConfig(): SparringConfig {
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
const logger = pino({ level: config.logLevel });

if (!config.enabled) {
  logger.info("SPARRING_ENABLED is false: the house agent stays out of the queue");
  process.exit(0);
}

const service = await startSparring(config, logger);
logger.info({ healthPort: service.healthPort, identities: config.apiKeys.length }, "sparring running");

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    await service.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

- [ ] **Step 10: Verify against the real thing**

Bring up Postgres, Redis, the API and Ollama by hand and watch the bot play a whole game. This is the step that catches what the fakes cannot.

```bash
docker run -d --rm --name aichess-plan3b-pg -e POSTGRES_USER=aichess -e POSTGRES_PASSWORD=aichess \
  -e POSTGRES_DB=aichess -p 55433:5432 postgres:17-alpine
docker run -d --rm --name aichess-plan3b-redis -p 6380:6379 redis:7-alpine
docker run -d --rm --name aichess-plan3b-ollama -p 11435:11434 -v aichess-ollama:/root/.ollama ollama/ollama
docker exec aichess-plan3b-ollama ollama pull gemma3:270m
```

Write a root `.env` pointing at those ports (55433, 6380, `OLLAMA_URL=http://localhost:11435`, `SPARRING_BASE_URL=http://localhost:3001`) with a `SPARRING_API_KEY` minted as in Task 8, then:

```bash
pnpm --filter @aichess/db migrate
node packages/db/dist/cli/ensure-sparring.js
pnpm --filter @aichess/api dev &
pnpm --filter @aichess/sparring dev &
```

Register a second agent with `create-agent`, run `examples/agent-claude` against it with no `ANTHROPIC_API_KEY` so it plays the first legal move, and have it join the unrated queue. Confirm, in order:

1. the two are paired within a few seconds of both being online;
2. `GET /v1/games/<id>` shows `config.rated === false`;
3. the comments on the house's moves name the path — some `gemma3:270m: …`, some `…names no legal move…`;
4. when the game ends, `select rating, games_played from ratings` is unchanged for both agents and `select count(*) from rating_history` is 0;
5. the house re-queues by itself.

Then stop the containers: `docker rm -f aichess-plan3b-pg aichess-plan3b-redis aichess-plan3b-ollama`.

- [ ] **Step 11: Commit**

```bash
git add apps/sparring
git commit -m "$(cat <<'MSG'
feat(sparring): the house agent plays, through the same API as everyone else

It authenticates with its own key, joins the unrated queue and re-queues when a
game ends - a normal client of the published SDK, so a broken quickstart shows
up as a bot that stopped playing.

The turn is decided in one place: the model, then the parser, then the local
policy, and the comment on every move says which of the three it was.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 11: The site says which games counted, and who the house is

**Files:**

- Modify: `apps/web/src/components/layout/AgentCell.tsx`
- Modify: `apps/web/src/components/games/GameRow.tsx`
- Modify: `apps/web/src/components/arena/LiveBoardCard.tsx`
- Modify: `apps/web/src/components/game/GameView.tsx`
- Modify: `apps/web/src/components/agents/AgentHeader.tsx`
- Modify: `apps/web/src/styles/arena.css`
- Test: `apps/web/src/components/games/GameRow.test.tsx`

**Interfaces:**

- Consumes: `GameListItem.rated`, `GameSnapshot.config.rated`, `AgentSummary.isHouse`.
- Produces: no exported API changes.

- [ ] **Step 1: Write the failing component tests**

In `apps/web/src/components/games/GameRow.test.tsx`, add to the fixtures and the suite:

```ts
it("marks a practice game and leaves a rated one unmarked", () => {
  renderRow({ ...BASE, rated: false });
  expect(screen.getByText("training")).toBeInTheDocument();
  cleanup();
  renderRow(BASE);
  expect(screen.queryByText("training")).toBeNull();
});

it("marks the house agent wherever its name appears", () => {
  renderRow({ ...BASE, white: { ...BASE.white, isHouse: true } });
  expect(screen.getByText("house")).toBeInTheDocument();
});
```

Import `cleanup` from `@testing-library/react`. `BASE` gains `rated: true`, and both agent summaries gain `isHouse: false` — that edit is part of Task 2 and should already be there; if it is not, make it here.

- [ ] **Step 2: Run and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm --filter @aichess/web test -- GameRow
```

Expected: FAIL — neither chip is rendered.

- [ ] **Step 3: Add the two badges**

In `apps/web/src/components/layout/AgentCell.tsx`, inside the `<span>`, after the name:

```tsx
<span>
  <b>{agent.name}</b>
  {agent.isHouse ? <span className="chip chip--house">house</span> : null}
  {extra === undefined ? null : <small>{extra}</small>}
</span>
```

In `apps/web/src/components/games/GameRow.tsx`, in the identifier cell:

```tsx
<td>
  <Link href={`/games/${game.id}`}>#{game.id.slice(0, 8)}</Link>
  {game.rated ? null : <span className="chip chip--training">training</span>}
</td>
```

In `apps/web/src/components/arena/LiveBoardCard.tsx`, beside the live chip:

```tsx
<span className="board-id">
  <span>Game #{game.id.slice(0, 8)}</span>
  {game.rated ? null : <span className="chip chip--training">training</span>}
  {active ? <span className="chip chip--live">live</span> : null}
</span>
```

In `apps/web/src/components/game/GameView.tsx`, the status line currently hardcodes the word `rated`. Make it tell the truth:

```tsx
          {revealed ? "Finished" : "Live"} · {snapshot.config.rated ? "rated" : "training"} ·{" "}
          {Math.round(snapshot.config.timePerMoveMs / 1000)} s per move
```

In `apps/web/src/components/agents/AgentHeader.tsx`, in the heading, before the suspended chip:

```tsx
{
  profile.agent.isHouse ? <span className="chip chip--house">house</span> : null;
}
```

- [ ] **Step 4: Give the chips their colours**

In `apps/web/src/styles/arena.css`, beside the existing chip modifiers:

```css
.chip--training {
  color: var(--cyan);
  border: 2px solid var(--cyan);
  margin: 0;
}
.chip--house {
  color: var(--gold);
  border: 2px solid var(--gold);
  margin: 0 0 0 6px;
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter @aichess/web test
```

Expected: PASS.

- [ ] **Step 6: Look at it**

```bash
pnpm --filter @aichess/web build && pnpm --filter @aichess/web start &
google-chrome --headless --disable-gpu --screenshot=/tmp/claude-1001/games.png --window-size=1280,1400 http://localhost:3000/games
```

Confirm the badge reads as a badge next to the game id rather than colliding with the live chip, and that the house badge does not push the agent's name onto a second line in the archive's narrow columns. If the arena page is needed too, screenshot `/arena`; the game page's SSE stream never settles under `--virtual-time-budget`, so drive that one with Playwright as recorded in the plan-4b notes, or check it by eye in a browser.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components apps/web/src/styles/arena.css
git commit -m "$(cat <<'MSG'
feat(web): a practice game says so, and the house says who it is

The game page's status line had the word "rated" hardcoded, which was true
until today. Both badges come from data already on the wire: config.rated on
the snapshot, rated on the list item, isHouse on every agent summary.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

---

### Task 12: Ship it

**Files:**

- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`
- Modify: `.env.example`, `deploy/env.prod.example`, `deploy/init-env.sh`
- Modify: `README.md`

**Interfaces:**

- Consumes: everything above.
- Produces: `SPARRING_*` and `OLLAMA_URL` in the environment; the `ollama`, `ollama-pull`, `sparring-bootstrap` and `sparring` services.

Do not touch `site/`: another session owns those files.

- [ ] **Step 1: Put the new app in the image**

In `Dockerfile`, in the `manifests` stage, beside the other app manifests:

```dockerfile
COPY apps/sparring/package.json apps/sparring/package.json
```

In the `build` stage, add the filter:

```dockerfile
RUN pnpm build --filter=@aichess/api --filter=@aichess/worker --filter=@aichess/web --filter=@aichess/sparring
```

In the `runtime` stage, copy both new dist folders:

```dockerfile
COPY --from=build /app/apps/sparring/dist apps/sparring/dist
# The SDK used to be a dev dependency of the API's contract test and never
# shipped. The sparring service imports it at run time, so its build travels
# with the image now.
COPY --from=build /app/packages/sdk-ts/dist packages/sdk-ts/dist
```

- [ ] **Step 2: Verify the image builds and the entry point resolves**

```bash
docker build -t agenticchess:plan3b .
docker run --rm agenticchess:plan3b node -e "import('/app/apps/sparring/dist/main.js').catch((error) => { console.log(String(error).slice(0, 200)); })"
```

Expected: the build succeeds, and the run prints the configuration error about `SPARRING_API_KEY` — which is the module loading, resolving `@agenticchess/sdk`, and refusing to start without a key. An `ERR_MODULE_NOT_FOUND` here means a dist was not copied.

- [ ] **Step 3: Add the services to production compose**

In `docker-compose.prod.yml`, after `worker`:

```yaml
# The house sparring agent's model. No published ports: only the sparring
# service talks to it, over the compose network.
ollama:
  image: ollama/ollama:latest
  environment:
    # One request at a time and one model resident: this box has two vCPUs
    # and the API has to keep answering while a game is being played.
    OLLAMA_NUM_PARALLEL: "1"
    OLLAMA_MAX_LOADED_MODELS: "1"
    OLLAMA_KEEP_ALIVE: "5m"
  volumes:
    - ollama-models:/root/.ollama
  mem_limit: 1g
  healthcheck:
    test: ["CMD", "ollama", "list"]
    interval: 10s
    timeout: 5s
    retries: 12
    start_period: 30s
  restart: unless-stopped
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"

# One shot, like migrate: the image ships no weights.
ollama-pull:
  image: ollama/ollama:latest
  entrypoint: ["/bin/sh", "-c"]
  command: ["ollama pull ${SPARRING_MODEL:-gemma3:270m}"]
  environment:
    OLLAMA_HOST: http://ollama:11434
  depends_on:
    ollama:
      condition: service_healthy
  restart: "no"

# One shot: makes the database agree with SPARRING_API_KEY. Safe on every
# deploy, and it adopts a rotated key.
sparring-bootstrap:
  <<: *app
  command: ["node", "packages/db/dist/cli/ensure-sparring.js"]
  restart: "no"
  depends_on:
    migrate:
      condition: service_completed_successfully

sparring:
  <<: *app
  command: ["node", "apps/sparring/dist/main.js"]
  depends_on:
    api:
      condition: service_healthy
    ollama-pull:
      condition: service_completed_successfully
    sparring-bootstrap:
      condition: service_completed_successfully
  healthcheck:
    test:
      - CMD
      - node
      - -e
      - "fetch('http://127.0.0.1:'+(process.env.SPARRING_HEALTH_PORT||3003)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 30s
```

and add `ollama-models:` to the `volumes:` block at the bottom.

- [ ] **Step 4: Make it optional in development**

In `docker-compose.yml`, add:

```yaml
# Only with `docker compose --profile sparring up -d`: developing the arena
# does not require running a model.
ollama:
  image: ollama/ollama:latest
  profiles: ["sparring"]
  ports:
    - "11435:11434"
  volumes:
    - ollama-models:/root/.ollama
  healthcheck:
    test: ["CMD", "ollama", "list"]
    interval: 10s
    timeout: 5s
    retries: 12
```

and `ollama-models:` to its `volumes:` block.

- [ ] **Step 5: Declare the variables**

Append to `.env.example`:

```
# sparring (the house agent; optional in development)
SPARRING_ENABLED=true
# An arena key in the ac_ form. Mint one, then run
# `node packages/db/dist/cli/ensure-sparring.js` to register the agent with it.
SPARRING_API_KEY=
SPARRING_BASE_URL=http://localhost:3001
OLLAMA_URL=http://localhost:11435
SPARRING_MODEL=gemma3:270m
SPARRING_TIMEOUT_MS=15000
SPARRING_FALLBACK=greedy
SPARRING_HEALTH_PORT=3003
```

Append the same block to `deploy/env.prod.example`, with `SPARRING_BASE_URL=http://api:3001` and `OLLAMA_URL=http://ollama:11434`, under a `# --- sparring ---` heading matching the file's style.

In `deploy/init-env.sh`, mint the key beside the other generated secrets:

```bash
# The arena's own key format: ac_ + 8 url-safe characters + 43 more, which is
# what splitApiKey accepts and what ensure-sparring hashes into the agent row.
SPARRING_API_KEY="ac_$(openssl rand -base64 6 | tr '+/' '-_' | tr -d '=')$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

and add its substitution to the `sed` invocation:

```bash
  -e "s|^SPARRING_API_KEY=.*|SPARRING_API_KEY=${SPARRING_API_KEY}|" \
```

- [ ] **Step 6: Update the README**

In the status table, add a row after the matchmaking one:

```
| Practice games, house agent       | Implemented. Unrated queue where two agents of the same owner may meet, and a house sparring agent running `gemma3:270m` through Ollama that always waits in it                                                          |
```

In the roadmap's "Later" line, drop `an unrated queue with a house sparring agent for newcomers,` — it is no longer later.

In the Development section, after the stack commands:

````markdown
The house sparring agent is optional locally. It needs Ollama and the model:

```bash
docker compose --profile sparring up -d ollama
docker compose exec ollama ollama pull gemma3:270m
# put an ac_ key in SPARRING_API_KEY, then register the agent with it
pnpm --filter @aichess/db build && node packages/db/dist/cli/ensure-sparring.js
pnpm --filter @aichess/sparring dev
```
````

Your own agent then asks for a practice game instead of a rated one:

```ts
await client.joinQueue({ mode: "unrated" });
```

````

- [ ] **Step 7: Run the whole gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format
git diff --stat
````

Expected: everything green. `pnpm format` may reformat the files this task touched; that is why it runs before the commit.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.prod.yml .env.example deploy README.md
git commit -m "$(cat <<'MSG'
feat(deploy): Ollama, the model pull and the sparring service

Three services in the shape the stack already uses: a one-shot that pulls the
weights and a one-shot that reconciles the house agent, both gated with
service_completed_successfully so nothing starts against a half-ready host.

Ollama is capped at one request, one loaded model and a gigabyte: it shares two
vCPUs with an API that has to keep answering.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5TbtyPapLPJWVXFSoJe54
MSG
)"
```

- [ ] **Step 9: Deploy, with the one manual step**

`init-env.sh` refuses to touch an existing `.env`, so the live host needs the key added by hand. On the box:

```bash
ssh <the arena host>
cd /srv/agenticchess
grep -q '^SPARRING_API_KEY=' .env || cat >> .env <<EOF
SPARRING_ENABLED=true
SPARRING_API_KEY=ac_$(openssl rand -base64 6 | tr '+/' '-_' | tr -d '=')$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
SPARRING_BASE_URL=http://api:3001
OLLAMA_URL=http://ollama:11434
SPARRING_MODEL=gemma3:270m
SPARRING_TIMEOUT_MS=15000
SPARRING_FALLBACK=greedy
SPARRING_HEALTH_PORT=3003
EOF
git pull
./deploy/deploy.sh
```

Then clean up the abandoned queue keys from the single-queue layout, which nothing reads any more:

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli DEL mm:queue mm:meta
```

- [ ] **Step 10: Verify in production**

1. `docker compose -f docker-compose.prod.yml ps` — `ollama` healthy, both one-shots exited 0, `sparring` healthy.
2. `docker compose -f docker-compose.prod.yml logs sparring | tail` — "sparring running", then the queue join.
3. `https://agenticchess.online/agents/sparring` — the profile exists and carries the house badge.
4. From a registered agent of your own, `joinQueue({ mode: "unrated" })`, and watch the game at `https://agenticchess.online/arena`: the card carries the training badge.
5. When it ends, the leaderboard is unchanged and both profiles still show the same rating and the same number of games.
6. `docker stats --no-stream` — the box has memory to spare with the model loaded.

- [ ] **Step 11: Record what was learned**

Update `docs/superpowers/plans/` is not the place; put the outcome where the next session will read it — the project memory at `/home/exquisitus/.claude/projects/-home-exquisitus-NewProjects-aichess/memory/aichess-plan-sequence.md`: what shipped, the test count, and anything the execution taught that the plan got wrong.

---

## Self-Review

Run against the spec after writing:

**Spec coverage.** §1.1 → Task 1; §1.2 → Task 3; §1.3 → Task 4; §1.4 → Task 5; §1.5 → Tasks 5 (statistics, filter) and 11 (badges); §1.6 → Tasks 3, 6, 7; §2.1 → Tasks 1 (column) and 8 (set at bootstrap); §2.2 → Task 8; §2.3 → Tasks 9 (prompt) and 10 (client, handler); §2.4 → Task 7; §2.5 → Task 9; §2.6 → Tasks 9 (`SPARRING_ENABLED`) and 10 (every failure falls back); §3 → Tasks 9 (config) and 12 (compose, env, host); §4 → Task 11; §6 → the test steps in every task; §8's rollout order → the task order.

**Two things the spec did not say, decided here:**

1. **`GameListItem` needs its own `rated`.** A list item does not carry `GameConfig`, so the archive and the arena could not draw the badge from the snapshot's config as §1.1 implies. Added to the schema in Task 1.
2. **The lobby shows both queues.** `GET /v1/lobby` reads `queue.entries()`, which now needs a mode. Task 3 lists both and adds `mode` to `QueueEntryPublic`, on the same reasoning as §1.5's archive decision: someone waiting for practice is still someone waiting.

Both are additive, backward compatible, and consistent with the spec's own arguments.

**Type consistency.** `QueueMode`, `QueueEntry`, `QueueMembership`, `PairingOptions`, `EnsureSparringInput`, `Fallback`, `TurnHandlerDeps` and `SparringConfig` are declared once, in the task that introduces them, and every later use matches. `readMoveFromAnswer` has one signature across Tasks 7 and 10. `chooseByPolicy` takes `(fen, legal, fallback, random)` in both its own task and the handler.
