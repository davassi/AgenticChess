# Plan 2a: Database and Game Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist games in Postgres and drive them through a shared runtime service (create, move, resign, deadline expiry) that publishes per-recipient wire events on Redis and schedules idempotent deadline jobs, so that Plan 2b can expose it over HTTP and SSE and the worker can expire clocks.

**Architecture:** `packages/db` holds the Drizzle schema, SQL migrations, a Postgres client factory and a testcontainers helper. `packages/runtime` wraps the pure `@aichess/core` transitions with persistence under row locks, maps `DomainEvent`s to `WireEvent`s per recipient, publishes them on Redis channels, and schedules BullMQ deadline jobs. `apps/api` and `apps/worker` (Plan 2b) become thin shells over `runtime`. Plan 2a ends with integration tests that play complete games through the service against real Postgres and Redis containers.

**Tech Stack:** Node 22, pnpm 10, Turborepo 2, TypeScript 5.9, vitest 3, drizzle-orm 0.45, drizzle-kit 0.31, postgres 3.4, ioredis 5, bullmq 6, testcontainers 12 (postgres:17-alpine, redis:7-alpine), ESLint 9, typescript-eslint 8, Prettier 3.

**Spec:** `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 4, 5, 6, 7, 13, 14, 15 drive this plan). Plan 1 (`docs/superpowers/plans/2026-09-03-plan-1-core-package.md`) defines the `@aichess/core` API consumed here.

## Global Constraints

- Run every `pnpm` and `node` command under Node 22: prefix with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`. Docker must be running: integration tests start containers with testcontainers.
- ESM only, explicit `.js` extensions on relative imports, `verbatimModuleSyntax` on.
- Workspace packages are consumed through their `dist/` export maps at typecheck and runtime. Before running `typecheck` in any package other than `core`, run `pnpm build` at the root once (Turborepo caches). Vitest resolves workspace packages to their `src/` through explicit aliases, so tests never need a rebuild.
- Timestamps: epoch milliseconds (`number`) inside `core` and `runtime` logic, `timestamptz` in Postgres, ISO 8601 strings on the wire.
- Source of truth is Postgres. Every game mutation runs inside one transaction that first locks the game row with `SELECT ... FOR UPDATE`. A move is acknowledged only after commit. Events are published and jobs scheduled only after commit.
- Deadline job id is `deadline:{gameId}:{ply}`. It fires at `moveDeadlineAt + NETWORK_GRACE_MS` (1000 ms). The job re-reads the game under lock and applies the timeout only if `status` is `active` and `ply` still equals the job's ply.
- Abort rule, illegal-move budget, draw rules and the ply convention are inherited from `core`: `state.ply` counts plies played and is the value in `turn` events and `MoveCommand.ply`; `MoveRecord.ply` is 1-based.
- `fenHistory` is not stored. Rebuild it as `[START_FEN, ...moves.map(m => m.fenAfter)]` when loading a game.
- Redis channels: `agent:{agentId}` for agent-only events, `game:{gameId}` for public events. Messages are JSON-encoded `WireEvent`s.
- Public stream events carry no `legalMoves` and no `rating`. The public stream gets `game.turn` (who is on move and the deadline) and `game.illegal_attempt` instead of `game.your_turn`.
- Configuration comes from environment variables validated with zod; no hardcoded URLs. Defaults: `DEFAULT_TIME_PER_MOVE_MS` 60000, `MOVE_LIMIT_PLIES` 300, `ILLEGAL_ATTEMPTS_PER_TURN` 3.
- drizzle-orm 0.45 wraps driver errors in `DrizzleQueryError` (`message` starts with `Failed query:`); the Postgres error with its SQLSTATE `code` is in `error.cause`. Tests and error mapping must look at `cause.code`, never at the message.
- Every external call (Postgres, Redis, BullMQ) either propagates its error or logs it with context; nothing is swallowed.
- `core` keeps exactly two runtime dependencies: `chess.js` and `zod`. `db` depends on `core`, `runtime` depends on `core` and `db`.
- Every task ends with `pnpm lint`, the package's `test` and `typecheck` green, then a commit whose message ends with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy`

## Deviations from the spec, decided in this plan

- The spec places the orchestrator inside `apps/api`. This plan puts it in `packages/runtime` so that `apps/worker` (deadline expiry) and `apps/api` (moves, resignations) share one implementation instead of two. Task 8 records this in the spec.
- Three wire events are added to `core/protocol` for spectators: `game.snapshot` (sent once when a spectator stream opens), `game.turn` (side to move and deadline, no legal moves) and `game.illegal_attempt` (rejected attempts are part of the show and of the public statistics). `game.your_turn` stays agent-only.
- Two columns are added to `games` beyond the spec's list because `GameState` cannot be rebuilt without them: `turn_started_at` and `illegal_attempts_this_turn`. The full `GameConfig` is stored (`time_per_move_ms`, `move_limit_plies`, `illegal_attempts_per_turn`), not just the time budget.

---

## File Structure

```
eslint.config.mjs                 flat config: @eslint/js + typescript-eslint + prettier
.prettierrc / .prettierignore
docker-compose.yml                local postgres:17 and redis:7 for development (not used by tests)
.env.example                      DATABASE_URL, REDIS_URL and game defaults
packages/core/
  src/protocol/schemas.ts         + SnapshotEvent, TurnEvent, IllegalAttemptEvent in WireEventSchema
packages/db/
  package.json                    @aichess/db, exports "." and "./testing"
  drizzle.config.ts
  drizzle/                        generated SQL migrations + meta (committed)
  src/schema/enums.ts             pg enums built from core's const arrays
  src/schema/users.ts
  src/schema/agents.ts
  src/schema/games.ts
  src/schema/moves.ts             moves + move_attempts
  src/schema/index.ts
  src/client.ts                   createDb(url) -> { db, close }, Database and Transaction types
  src/migrate.ts                  runMigrations(db)
  src/cli/migrate.ts              `pnpm --filter @aichess/db migrate`
  src/testing.ts                  startTestDatabase(), truncateAll()  (tests only)
  src/index.ts
packages/runtime/
  package.json                    @aichess/runtime
  src/games/repository.ts         insertGame, loadGame, loadGameForUpdate, persistTransition, loadAgentSummaries
  src/events/wire.ts              toSnapshot, toWireEvents (pure)
  src/events/bus.ts               EventBus over ioredis pub/sub
  src/jobs/deadlines.ts           deadline queue, job id, scheduleDeadline
  src/games/service.ts            GameService: createAndStartGame, getSnapshot, submitMove, resign, expireDeadline, rearmActiveDeadlines
  src/testing.ts                  startTestRedis() (tests only)
  src/index.ts
```

Each `src/**/x.ts` has a sibling `x.test.ts`.

---

### Task 1: Tooling: lint, format, dev compose, env example

**Files:**

- Modify: `package.json` (root: scripts and devDependencies)
- Modify: `turbo.json` (add `lint`)
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `packages/core/package.json` (add `lint` script)
- Modify: `README.md` (development section)

**Interfaces:**

- Consumes: nothing.
- Produces: root commands `pnpm lint`, `pnpm format`, `pnpm format:check`; the per-package convention `"lint": "eslint src"`; `docker compose up -d` for local development.

- [ ] **Step 1: Add root dev dependencies and scripts**

Run from the repository root:

```bash
pnpm add -w -D eslint@^9.39.0 @eslint/js@^9.39.0 typescript-eslint@^8.69.0 eslint-config-prettier@^10.1.0 prettier@^3.9.0
```

Replace the `scripts` block in the root `package.json` with:

```json
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
```

Replace `turbo.json` with:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 2: Write the lint and format configuration**

`eslint.config.mjs`:

```js
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/**", "**/.next/**", "**/.turbo/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
    },
  },
);
```

`.prettierrc`:

```json
{
  "printWidth": 120,
  "singleQuote": false,
  "trailingComma": "all"
}
```

`.prettierignore`:

```
pnpm-lock.yaml
**/dist/
**/drizzle/
**/node_modules/
**/.turbo/
**/.next/
```

In `packages/core/package.json` add to `scripts`:

```json
    "lint": "eslint src",
```

- [ ] **Step 3: Write the development compose file and env example**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: aichess
      POSTGRES_PASSWORD: aichess
      POSTGRES_DB: aichess
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aichess"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
  redis-data:
```

`.env.example`:

```
DATABASE_URL=postgres://aichess:aichess@localhost:5432/aichess
REDIS_URL=redis://localhost:6379
DEFAULT_TIME_PER_MOVE_MS=60000
MOVE_LIMIT_PLIES=300
ILLEGAL_ATTEMPTS_PER_TURN=3
LOG_LEVEL=info
```

Append to the `## Development` section of `README.md`:

````markdown
Local services for manual runs (tests start their own containers):

```bash
cp .env.example .env
docker compose up -d
```
````

Lint and format:

```bash
pnpm lint
pnpm format
```

````

- [ ] **Step 4: Format and lint the existing code**

Run: `pnpm format && pnpm lint`
Expected: Prettier rewrites some files in `packages/core` (line wrapping only). ESLint exits 0. If ESLint reports `explicit-function-return-type` on an arrow function assigned to a `const` inside `core`, add the return type; do not disable the rule.

- [ ] **Step 5: Verify nothing broke**

Run: `pnpm test && pnpm typecheck && pnpm format:check`
Expected: 97 core tests pass, typecheck exits 0, Prettier reports all files formatted.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: eslint, prettier, dev compose and env example"
````

---

### Task 2: `@aichess/db`: schema, migrations, client, test database helper

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/tsconfig.build.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/enums.ts`
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/agents.ts`
- Create: `packages/db/src/schema/games.ts`
- Create: `packages/db/src/schema/moves.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/cli/migrate.ts`
- Create: `packages/db/src/testing.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/drizzle/0000_*.sql` and `packages/db/drizzle/meta/*` (generated)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**

- Consumes: `COLORS`, `AGENT_STATUSES`, `GAME_STATUSES`, `RESULTS`, `TERMINATIONS`, `ILLEGAL_REASONS` from `@aichess/core/protocol`.
- Produces:
  - Tables: `users`, `agents`, `games`, `moves`, `moveAttempts` (Drizzle table objects, exported from `@aichess/db`).
  - `type Database = PostgresJsDatabase<typeof schema>`; `type Transaction` (the `tx` inside `db.transaction`).
  - `createDb(url: string, options?: { max?: number }): { db: Database; close: () => Promise<void> }`
  - `runMigrations(db: Database): Promise<void>`
  - From `@aichess/db/testing` (tests only): `startTestDatabase(): Promise<{ db: Database; url: string; stop: () => Promise<void> }>`, `truncateAll(db: Database): Promise<void>`.
- Column naming is snake_case in SQL and camelCase in TypeScript; every table has `id` uuid, `createdAt`, and where rows change, `updatedAt`.

- [ ] **Step 1: Create the package files**

`packages/db/package.json`:

```json
{
  "name": "@aichess/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing.d.ts", "default": "./dist/testing.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "generate": "drizzle-kit generate",
    "migrate": "pnpm build && node dist/cli/migrate.js"
  },
  "dependencies": {
    "@aichess/core": "workspace:*",
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.7"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^12.0.0",
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.31.0",
    "testcontainers": "^12.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/db/tsconfig.json`:

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

`packages/db/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreSrc = fileURLToPath(new URL("../core/src", import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${coreSrc}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${coreSrc}/protocol/index.ts` },
    ],
  },
});
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"];

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  ...(url === undefined ? {} : { dbCredentials: { url } }),
});
```

Run: `pnpm install`
Expected: workspace links `@aichess/core` into `packages/db/node_modules`.

- [ ] **Step 2: Write the failing schema test**

`packages/db/src/schema.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { agents, games, moves, users } from "./schema/index.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const UNIQUE_VIOLATION = "23505";

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === UNIQUE_VIOLATION;
  });
}

describe("database schema", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("applies migrations idempotently", async () => {
    await expect(runMigrations(tdb.db)).resolves.toBeUndefined();
  });

  it("stores a user, two agents and a game with defaults", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    expect(owner.role).toBe("user");

    const inserted = await tdb.db
      .insert(agents)
      .values([
        {
          ownerId: owner.id,
          name: "Alpha",
          slug: "alpha",
          modelProvider: "anthropic",
          modelName: "claude-sonnet-5",
          apiKeyPrefix: "AAAAAAAA",
          apiKeyHash: "0".repeat(64),
        },
        {
          ownerId: owner.id,
          name: "Beta",
          slug: "beta",
          modelProvider: "openai",
          modelName: "gpt-5",
          apiKeyPrefix: "BBBBBBBB",
          apiKeyHash: "1".repeat(64),
        },
      ])
      .returning();
    const [alpha, beta] = inserted;
    if (alpha === undefined || beta === undefined) throw new Error("agents not inserted");
    expect(alpha.status).toBe("active");

    const [game] = await tdb.db
      .insert(games)
      .values({
        whiteAgentId: alpha.id,
        blackAgentId: beta.id,
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
      })
      .returning();
    if (game === undefined) throw new Error("game not inserted");
    expect(game.status).toBe("created");
    expect(game.ply).toBe(0);
    expect(game.result).toBeNull();
    expect(game.moveDeadlineAt).toBeNull();

    const loaded = await tdb.db.query.games.findFirst({
      where: eq(games.id, game.id),
      with: { white: true, black: true },
    });
    expect(loaded?.white.slug).toBe("alpha");
    expect(loaded?.black.slug).toBe("beta");
  });

  it("rejects a duplicate agent slug", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    const base = {
      ownerId: owner.id,
      name: "Alpha",
      slug: "alpha",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-5",
      apiKeyPrefix: "AAAAAAAA",
      apiKeyHash: "0".repeat(64),
    };
    await tdb.db.insert(agents).values(base);
    await expectUniqueViolation(tdb.db.insert(agents).values({ ...base, apiKeyPrefix: "CCCCCCCC" }));
  });

  it("rejects two moves at the same ply of one game", async () => {
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
    const move = {
      gameId: game.id,
      ply: 1,
      color: "white" as const,
      san: "e4",
      uci: "e2e4",
      fenAfter: START_FEN,
      thinkTimeMs: 10,
    };
    await tdb.db.insert(moves).values(move);
    await expectUniqueViolation(tdb.db.insert(moves).values(move));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @aichess/db test`
Expected: FAIL, cannot resolve `./migrate.js`.

- [ ] **Step 4: Write the schema**

`packages/db/src/schema/enums.ts`:

```ts
import { AGENT_STATUSES, COLORS, GAME_STATUSES, ILLEGAL_REASONS, RESULTS, TERMINATIONS } from "@aichess/core/protocol";
import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const agentStatusEnum = pgEnum("agent_status", AGENT_STATUSES);
export const colorEnum = pgEnum("color", COLORS);
export const gameStatusEnum = pgEnum("game_status", GAME_STATUSES);
export const gameResultEnum = pgEnum("game_result", RESULTS);
export const terminationEnum = pgEnum("termination", TERMINATIONS);
export const illegalReasonEnum = pgEnum("illegal_reason", ILLEGAL_REASONS);
```

`packages/db/src/schema/users.ts`:

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./enums.js";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/schema/agents.ts`:

```ts
import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentStatusEnum } from "./enums.js";
import { users } from "./users.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    status: agentStatusEnum("status").notNull().default("active"),
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_api_key_prefix_idx").on(t.apiKeyPrefix), index("agents_owner_idx").on(t.ownerId)],
);

export const agentsRelations = relations(agents, ({ one }) => ({
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
}));
```

`packages/db/src/schema/games.ts`:

```ts
import { relations } from "drizzle-orm";
import { doublePrecision, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { gameResultEnum, gameStatusEnum, terminationEnum } from "./enums.js";
import { moves } from "./moves.js";

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    whiteAgentId: uuid("white_agent_id")
      .notNull()
      .references(() => agents.id),
    blackAgentId: uuid("black_agent_id")
      .notNull()
      .references(() => agents.id),
    status: gameStatusEnum("status").notNull().default("created"),
    result: gameResultEnum("result"),
    termination: terminationEnum("termination"),
    timePerMoveMs: integer("time_per_move_ms").notNull(),
    moveLimitPlies: integer("move_limit_plies").notNull(),
    illegalAttemptsPerTurn: integer("illegal_attempts_per_turn").notNull(),
    currentFen: text("current_fen").notNull(),
    ply: integer("ply").notNull().default(0),
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
    moveDeadlineAt: timestamp("move_deadline_at", { withTimezone: true }),
    illegalAttemptsThisTurn: integer("illegal_attempts_this_turn").notNull().default(0),
    pgn: text("pgn"),
    whiteRatingBefore: doublePrecision("white_rating_before"),
    whiteRatingAfter: doublePrecision("white_rating_after"),
    blackRatingBefore: doublePrecision("black_rating_before"),
    blackRatingAfter: doublePrecision("black_rating_after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("games_status_idx").on(t.status),
    index("games_white_idx").on(t.whiteAgentId, t.finishedAt),
    index("games_black_idx").on(t.blackAgentId, t.finishedAt),
  ],
);

export const gamesRelations = relations(games, ({ one, many }) => ({
  white: one(agents, { fields: [games.whiteAgentId], references: [agents.id], relationName: "white" }),
  black: one(agents, { fields: [games.blackAgentId], references: [agents.id], relationName: "black" }),
  moves: many(moves),
}));
```

`packages/db/src/schema/moves.ts`:

```ts
import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { colorEnum, illegalReasonEnum } from "./enums.js";
import { games } from "./games.js";

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ply: integer("ply").notNull(),
    color: colorEnum("color").notNull(),
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    fenAfter: text("fen_after").notNull(),
    comment: text("comment"),
    thinkTimeMs: integer("think_time_ms").notNull(),
    illegalAttemptsBefore: integer("illegal_attempts_before").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("moves_game_ply_idx").on(t.gameId, t.ply)],
);

export const movesRelations = relations(moves, ({ one }) => ({
  game: one(games, { fields: [moves.gameId], references: [games.id] }),
}));

export const moveAttempts = pgTable(
  "move_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    ply: integer("ply").notNull(),
    submitted: text("submitted").notNull(),
    reason: illegalReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("move_attempts_game_idx").on(t.gameId), index("move_attempts_agent_idx").on(t.agentId)],
);
```

`packages/db/src/schema/index.ts`:

```ts
export * from "./enums.js";
export * from "./users.js";
export * from "./agents.js";
export * from "./games.js";
export * from "./moves.js";
```

The circular import between `games.ts` and `moves.ts` is fine: both only reference each other inside `references(() => ...)` callbacks and `relations(...)` factories, which run lazily.

- [ ] **Step 5: Write client, migrator, CLI, testing helper and index**

`packages/db/src/client.ts`:

```ts
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
}

export function createDb(url: string, options: CreateDbOptions = {}): DatabaseHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
```

`packages/db/src/migrate.ts`:

```ts
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.js";

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Database, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}
```

`packages/db/src/cli/migrate.ts`:

```ts
import { createDb } from "../client.js";
import { runMigrations } from "../migrate.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
```

`packages/db/src/testing.ts`:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

export interface TestDatabase {
  db: Database;
  url: string;
  stop: () => Promise<void>;
}

const POSTGRES_IMAGE = "postgres:17-alpine";

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  const handle = createDb(url, { max: 5 });
  try {
    await runMigrations(handle.db);
  } catch (error) {
    await handle.close();
    await container.stop();
    throw error;
  }
  return {
    db: handle.db,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE move_attempts, moves, games, agents, users RESTART IDENTITY CASCADE`);
}
```

`packages/db/src/index.ts`:

```ts
export * from "./schema/index.js";
export * from "./client.js";
export { runMigrations } from "./migrate.js";
```

- [ ] **Step 6: Generate the first migration**

Run from the root:

```bash
pnpm --filter @aichess/core build && pnpm --filter @aichess/db generate
ls packages/db/drizzle
grep -c 'CREATE TYPE' packages/db/drizzle/0000_*.sql
grep -c 'CREATE TABLE' packages/db/drizzle/0000_*.sql
```

Expected: one `0000_<adjective>_<name>.sql` plus `meta/_journal.json` and `meta/0000_snapshot.json`. Seven `CREATE TYPE` (user_role, agent_status, color, game_status, game_result, termination, illegal_reason) and five `CREATE TABLE` (users, agents, games, moves, move_attempts). If drizzle-kit cannot resolve `@aichess/core/protocol`, `core` was not built; rerun the build.

- [ ] **Step 7: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/db test && pnpm --filter @aichess/db lint && pnpm build && pnpm --filter @aichess/db typecheck`
Expected: 4 tests pass (the first run pulls `postgres:17-alpine`, allow a few minutes). ESLint and `tsc` exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): drizzle schema, migrations, client and test database helper"
```

---

### Task 3: Spectator events in the protocol, `runtime` scaffold, wire mapping

**Files:**

- Modify: `packages/core/src/protocol/schemas.ts` (three new event schemas in `WireEventSchema`)
- Modify: `packages/core/src/protocol/schemas.test.ts` (parse the new events)
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/tsconfig.build.json`
- Create: `packages/runtime/vitest.config.ts`
- Create: `packages/runtime/src/events/wire.ts`
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/events/wire.test.ts`

**Interfaces:**

- Consumes: `GameState`, `DomainEvent`, `MoveRecord`, `legalMoves`, `sideToMove`, `agentColor` from `@aichess/core`; `AgentSummary`, `GameSnapshot`, `WireEvent` from `@aichess/core/protocol`.
- Produces (core protocol): `SnapshotEventSchema` (`game.snapshot`, `{ game: GameSnapshot }`), `TurnEventSchema` (`game.turn`, `{ gameId, color, ply, deadlineAt }`), `IllegalAttemptEventSchema` (`game.illegal_attempt`, `{ gameId, color, ply, submitted, reason, attemptsLeft }`), all members of `WireEventSchema`.
- Produces (runtime):
  - `interface GameAgents { white: AgentSummary; black: AgentSummary }`
  - `interface RatingChange { before: number; after: number }`
  - `interface RatingChanges { white: RatingChange | null; black: RatingChange | null }`
  - `interface Outgoing { toWhite: WireEvent[]; toBlack: WireEvent[]; toPublic: WireEvent[] }`
  - `toSnapshot(state: GameState, agents: GameAgents, viewerAgentId?: string): GameSnapshot`
  - `toWireEvents(state: GameState, agents: GameAgents, events: DomainEvent[], extras: { pgn: string | null; ratings: RatingChanges }): Outgoing` where `state` is the state **after** the transition that produced `events`.
- Recipient rules: `started` becomes `game.start` for each agent with its own colour and the opponent's summary, nothing for the public. `turn` becomes `game.your_turn` (with legal moves) for the agent on move and `game.turn` for the public. `move` goes to everyone as `game.move`. `illegal_attempt` goes to the public only. `ended` goes to everyone as `game.end`; agents get their own rating change, the public gets `rating: null`.

- [ ] **Step 1: Extend the protocol tests**

Append to `packages/core/src/protocol/schemas.test.ts`, inside `describe("WireEventSchema", ...)`:

```ts
it("parses the spectator-only events", () => {
  const gameId = "3f2c1f0e-3d1a-4d9b-9f0e-1c2b3a4d5e6f";
  expect(
    WireEventSchema.parse({ type: "game.turn", gameId, color: "black", ply: 1, deadlineAt: "2026-09-03T10:00:00.000Z" })
      .type,
  ).toBe("game.turn");
  expect(
    WireEventSchema.parse({
      type: "game.illegal_attempt",
      gameId,
      color: "white",
      ply: 0,
      submitted: "Nf6",
      reason: "not_legal",
      attemptsLeft: 2,
    }).type,
  ).toBe("game.illegal_attempt");
  const snapshot = WireEventSchema.parse({
    type: "game.snapshot",
    game: {
      id: gameId,
      status: "active",
      white: { id: "5b1d0d3e-1c2b-4a4d-9e0f-0a1b2c3d4e5f", name: "A", slug: "a", modelProvider: "x", modelName: "y" },
      black: { id: "6c2e1e4f-2d3c-4b5e-8f10-1b2c3d4e5f60", name: "B", slug: "b", modelProvider: "x", modelName: "y" },
      config: { timePerMoveMs: 60000, moveLimitPlies: 300, illegalAttemptsPerTurn: 3 },
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      ply: 0,
      history: [],
      turn: "white",
      moveDeadlineAt: "2026-09-03T10:01:00.000Z",
      result: null,
      termination: null,
      startedAt: "2026-09-03T10:00:00.000Z",
      finishedAt: null,
    },
  });
  expect(snapshot.type).toBe("game.snapshot");
});
```

- [ ] **Step 2: Run the core tests to verify the new test fails**

Run: `pnpm --filter @aichess/core test -- schemas`
Expected: FAIL on "parses the spectator-only events" with a zod invalid discriminator error.

- [ ] **Step 3: Add the schemas**

In `packages/core/src/protocol/schemas.ts`, insert after `GameEndEventSchema`:

```ts
export const SnapshotEventSchema = z.object({
  type: z.literal("game.snapshot"),
  game: GameSnapshotSchema,
});

export const TurnEventSchema = z.object({
  type: z.literal("game.turn"),
  gameId: z.uuid(),
  color: ColorSchema,
  ply: z.int().min(0),
  deadlineAt: z.iso.datetime(),
});

export const IllegalAttemptEventSchema = z.object({
  type: z.literal("game.illegal_attempt"),
  gameId: z.uuid(),
  color: ColorSchema,
  ply: z.int().min(0),
  submitted: z.string().max(64),
  reason: IllegalReasonSchema,
  attemptsLeft: z.int().min(0),
});
```

and replace the `WireEventSchema` union with:

```ts
export const WireEventSchema = z.discriminatedUnion("type", [
  HelloEventSchema,
  QueueJoinedEventSchema,
  QueueLeftEventSchema,
  GameStartEventSchema,
  YourTurnEventSchema,
  MoveEventSchema,
  GameEndEventSchema,
  SnapshotEventSchema,
  TurnEventSchema,
  IllegalAttemptEventSchema,
  PingEventSchema,
]);
```

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck && pnpm --filter @aichess/core build`
Expected: all core tests pass; `dist/` refreshed so `runtime` can typecheck against it.

- [ ] **Step 4: Scaffold the runtime package**

`packages/runtime/package.json`:

```json
{
  "name": "@aichess/runtime",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing.d.ts", "default": "./dist/testing.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@aichess/core": "workspace:*",
    "@aichess/db": "workspace:*",
    "bullmq": "^6.3.0",
    "ioredis": "^5.6.0"
  },
  "devDependencies": {
    "@testcontainers/redis": "^12.0.0",
    "@types/node": "^22.0.0",
    "testcontainers": "^12.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/runtime/tsconfig.json`:

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

`packages/runtime/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/runtime/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreSrc = fileURLToPath(new URL("../core/src", import.meta.url));
const dbSrc = fileURLToPath(new URL("../db/src", import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${coreSrc}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${coreSrc}/protocol/index.ts` },
      { find: /^@aichess\/db$/, replacement: `${dbSrc}/index.ts` },
      { find: /^@aichess\/db\/testing$/, replacement: `${dbSrc}/testing.ts` },
    ],
  },
});
```

`fileParallelism: false` keeps one Postgres and one Redis container at a time on a developer machine.

`packages/runtime/src/index.ts` (initial):

```ts
export * from "./events/wire.js";
```

Run: `pnpm install`
Expected: workspace links `@aichess/core` and `@aichess/db`; `bullmq` and `ioredis` installed.

- [ ] **Step 5: Write the failing wire tests**

`packages/runtime/src/events/wire.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { applyMove, applyResign, createGame, startGame, type DomainEvent, type GameState } from "@aichess/core";
import { DEFAULT_GAME_CONFIG, WireEventSchema, type WireEvent } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { toSnapshot, toWireEvents, type GameAgents, type Outgoing } from "./wire.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
const agents: GameAgents = {
  white: { id: randomUUID(), name: "Alpha", slug: "alpha", modelProvider: "anthropic", modelName: "claude-sonnet-5" },
  black: { id: randomUUID(), name: "Beta", slug: "beta", modelProvider: "openai", modelName: "gpt-5" },
};
const NO_RATINGS = { white: null, black: null };

function created(): GameState {
  return createGame({
    id: randomUUID(),
    whiteAgentId: agents.white.id,
    blackAgentId: agents.black.id,
    config: DEFAULT_GAME_CONFIG,
    now: T0,
  });
}

function validate(out: Outgoing): void {
  for (const list of [out.toWhite, out.toBlack, out.toPublic]) {
    for (const event of list) WireEventSchema.parse(event);
  }
}

function types(list: WireEvent[]): string[] {
  return list.map((e) => e.type);
}

describe("toWireEvents", () => {
  it("maps the start of a game", () => {
    const { state, events } = startGame(created(), T0);
    const out = toWireEvents(state, agents, events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(types(out.toWhite)).toEqual(["game.start", "game.your_turn"]);
    expect(types(out.toBlack)).toEqual(["game.start"]);
    expect(types(out.toPublic)).toEqual(["game.turn"]);

    const start = out.toWhite[0];
    if (start?.type !== "game.start") throw new Error("expected game.start");
    expect(start).toEqual({
      type: "game.start",
      gameId: state.id,
      color: "white",
      opponent: agents.black,
      timePerMoveMs: 60_000,
      startedAt: new Date(T0).toISOString(),
    });
    const blackStart = out.toBlack[0];
    if (blackStart?.type !== "game.start") throw new Error("expected game.start");
    expect(blackStart.color).toBe("black");
    expect(blackStart.opponent).toEqual(agents.white);

    const turn = out.toWhite[1];
    if (turn?.type !== "game.your_turn") throw new Error("expected game.your_turn");
    expect(turn.ply).toBe(0);
    expect(turn.history).toEqual([]);
    expect(turn.lastMove).toBeNull();
    expect(turn.legalMoves).toHaveLength(20);
    expect(turn.deadlineAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(turn.attemptsLeft).toBe(3);

    expect(out.toPublic[0]).toEqual({
      type: "game.turn",
      gameId: state.id,
      color: "white",
      ply: 0,
      deadlineAt: new Date(T0 + 60_000).toISOString(),
    });
  });

  it("maps a legal move to everyone and the next turn to black", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "e4", comment: "Centre.", now: T0 + 2_000 });
    if (!r.ok) throw new Error(r.code);
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(types(out.toWhite)).toEqual(["game.move"]);
    expect(types(out.toBlack)).toEqual(["game.move", "game.your_turn"]);
    expect(types(out.toPublic)).toEqual(["game.move", "game.turn"]);

    const move = out.toPublic[0];
    if (move?.type !== "game.move") throw new Error("expected game.move");
    expect(move).toEqual({
      type: "game.move",
      gameId: r.state.id,
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: r.state.fen,
      comment: "Centre.",
      thinkTimeMs: 2_000,
    });

    const turn = out.toBlack[1];
    if (turn?.type !== "game.your_turn") throw new Error("expected game.your_turn");
    expect(turn.ply).toBe(1);
    expect(turn.history).toEqual(["e4"]);
    expect(turn.lastMove).toEqual({ san: "e4", uci: "e2e4" });
    expect(turn.fen).toBe(r.state.fen);
    expect(turn.legalMoves.map((m) => m.san)).toContain("e5");
  });

  it("maps an illegal attempt to the public only", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "Nf6", now: T0 + 1 });
    if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    validate(out);
    expect(out.toWhite).toEqual([]);
    expect(out.toBlack).toEqual([]);
    expect(out.toPublic).toEqual([
      {
        type: "game.illegal_attempt",
        gameId: r.state.id,
        color: "white",
        ply: 0,
        submitted: "Nf6",
        reason: "not_legal",
        attemptsLeft: 2,
      },
    ]);
  });

  it("maps the end of a game with per-agent ratings and a public null", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    const ratings = { white: { before: 1500, after: 1650 }, black: { before: 1500, after: 1350 } };
    const out = toWireEvents(r.state, agents, r.events, { pgn: '[Event "x"]\n\n*', ratings });
    validate(out);
    const expectedBase = {
      type: "game.end",
      gameId: r.state.id,
      result: "1-0",
      termination: "resignation",
      pgn: '[Event "x"]\n\n*',
    };
    expect(out.toWhite).toEqual([{ ...expectedBase, rating: ratings.white }]);
    expect(out.toBlack).toEqual([{ ...expectedBase, rating: ratings.black }]);
    expect(out.toPublic).toEqual([{ ...expectedBase, rating: null }]);
  });

  it("falls back to an empty pgn when none is supplied for an ended game", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.white.id, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    const out = toWireEvents(r.state, agents, r.events, { pgn: null, ratings: NO_RATINGS });
    const end = out.toPublic[0];
    if (end?.type !== "game.end") throw new Error("expected game.end");
    expect(end.pgn).toBe("");
  });

  it("ignores events it does not know how to route", () => {
    const state = startGame(created(), T0).state;
    const unknown = { type: "mystery" } as unknown as DomainEvent;
    const out = toWireEvents(state, agents, [unknown], { pgn: null, ratings: NO_RATINGS });
    expect(out).toEqual({ toWhite: [], toBlack: [], toPublic: [] });
  });
});

describe("toSnapshot", () => {
  it("serialises timestamps as ISO strings and history as SAN", () => {
    const started = startGame(created(), T0).state;
    const r = applyMove(started, { agentId: agents.white.id, ply: 0, move: "d4", now: T0 + 1_000 });
    if (!r.ok) throw new Error(r.code);
    const snapshot = toSnapshot(r.state, agents);
    expect(snapshot).toEqual({
      id: r.state.id,
      status: "active",
      white: agents.white,
      black: agents.black,
      config: DEFAULT_GAME_CONFIG,
      fen: r.state.fen,
      ply: 1,
      history: ["d4"],
      turn: "black",
      moveDeadlineAt: new Date(T0 + 1_000 + 60_000).toISOString(),
      result: null,
      termination: null,
      startedAt: new Date(T0).toISOString(),
      finishedAt: null,
    });
  });

  it("adds legal moves and attempts only for the viewer on move", () => {
    const started = startGame(created(), T0).state;
    const forWhite = toSnapshot(started, agents, agents.white.id);
    expect(forWhite.legalMoves).toHaveLength(20);
    expect(forWhite.attemptsLeft).toBe(3);
    const forBlack = toSnapshot(started, agents, agents.black.id);
    expect(forBlack.legalMoves).toBeUndefined();
    expect(forBlack.attemptsLeft).toBeUndefined();
    const forStranger = toSnapshot(started, agents, randomUUID());
    expect(forStranger.legalMoves).toBeUndefined();
  });

  it("never adds legal moves to a finished game", () => {
    const started = startGame(created(), T0).state;
    const r = applyResign(started, agents.black.id, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    const snapshot = toSnapshot(r.state, agents, agents.white.id);
    expect(snapshot.status).toBe("finished");
    expect(snapshot.legalMoves).toBeUndefined();
    expect(snapshot.finishedAt).toBe(new Date(T0 + 5).toISOString());
  });
});
```

- [ ] **Step 6: Run the runtime tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test`
Expected: FAIL, cannot resolve `./wire.js`.

- [ ] **Step 7: Write the wire mapping**

`packages/runtime/src/events/wire.ts`:

```ts
import { agentColor, legalMoves, sideToMove, type DomainEvent, type GameState } from "@aichess/core";
import type { AgentSummary, Color, GameSnapshot, WireEvent } from "@aichess/core/protocol";

export interface GameAgents {
  white: AgentSummary;
  black: AgentSummary;
}

export interface RatingChange {
  before: number;
  after: number;
}

export interface RatingChanges {
  white: RatingChange | null;
  black: RatingChange | null;
}

export interface Outgoing {
  toWhite: WireEvent[];
  toBlack: WireEvent[];
  toPublic: WireEvent[];
}

export interface WireExtras {
  pgn: string | null;
  ratings: RatingChanges;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}

function attemptsLeft(state: GameState): number {
  return Math.max(0, state.config.illegalAttemptsPerTurn - state.illegalAttemptsThisTurn);
}

export function toSnapshot(state: GameState, agents: GameAgents, viewerAgentId?: string): GameSnapshot {
  const base: GameSnapshot = {
    id: state.id,
    status: state.status,
    white: agents.white,
    black: agents.black,
    config: state.config,
    fen: state.fen,
    ply: state.ply,
    history: state.moves.map((m) => m.san),
    turn: sideToMove(state),
    moveDeadlineAt: isoOrNull(state.moveDeadlineAt),
    result: state.result,
    termination: state.termination,
    startedAt: isoOrNull(state.startedAt),
    finishedAt: isoOrNull(state.finishedAt),
  };
  if (viewerAgentId === undefined || state.status !== "active") return base;
  if (agentColor(state, viewerAgentId) !== sideToMove(state)) return base;
  return { ...base, legalMoves: legalMoves(state.fen), attemptsLeft: attemptsLeft(state) };
}

function opponentSummary(agents: GameAgents, color: Color): AgentSummary {
  return color === "white" ? agents.black : agents.white;
}

function yourTurnEvent(state: GameState, event: Extract<DomainEvent, { type: "turn" }>): WireEvent {
  const last = state.moves[state.moves.length - 1];
  return {
    type: "game.your_turn",
    gameId: state.id,
    ply: event.ply,
    fen: state.fen,
    history: state.moves.map((m) => m.san),
    lastMove: last === undefined ? null : { san: last.san, uci: last.uci },
    legalMoves: legalMoves(state.fen),
    deadlineAt: iso(event.deadlineAt),
    attemptsLeft: event.attemptsLeft,
  };
}

export function toWireEvents(
  state: GameState,
  agents: GameAgents,
  events: DomainEvent[],
  extras: WireExtras,
): Outgoing {
  const out: Outgoing = { toWhite: [], toBlack: [], toPublic: [] };
  const toAgent = (color: Color, event: WireEvent): void => {
    (color === "white" ? out.toWhite : out.toBlack).push(event);
  };

  for (const event of events) {
    switch (event.type) {
      case "started": {
        for (const color of ["white", "black"] as const) {
          toAgent(color, {
            type: "game.start",
            gameId: state.id,
            color,
            opponent: opponentSummary(agents, color),
            timePerMoveMs: state.config.timePerMoveMs,
            startedAt: iso(event.startedAt),
          });
        }
        break;
      }
      case "turn": {
        toAgent(event.color, yourTurnEvent(state, event));
        out.toPublic.push({
          type: "game.turn",
          gameId: state.id,
          color: event.color,
          ply: event.ply,
          deadlineAt: iso(event.deadlineAt),
        });
        break;
      }
      case "move": {
        const wire: WireEvent = {
          type: "game.move",
          gameId: state.id,
          ply: event.record.ply,
          color: event.record.color,
          san: event.record.san,
          uci: event.record.uci,
          fen: event.record.fenAfter,
          comment: event.record.comment,
          thinkTimeMs: event.record.thinkTimeMs,
        };
        out.toWhite.push(wire);
        out.toBlack.push(wire);
        out.toPublic.push(wire);
        break;
      }
      case "illegal_attempt": {
        out.toPublic.push({
          type: "game.illegal_attempt",
          gameId: state.id,
          color: event.color,
          ply: event.ply,
          submitted: event.submitted.slice(0, 64),
          reason: event.reason,
          attemptsLeft: event.attemptsLeft,
        });
        break;
      }
      case "ended": {
        const base = {
          type: "game.end" as const,
          gameId: state.id,
          result: event.result,
          termination: event.termination,
          pgn: extras.pgn ?? "",
        };
        out.toWhite.push({ ...base, rating: extras.ratings.white });
        out.toBlack.push({ ...base, rating: extras.ratings.black });
        out.toPublic.push({ ...base, rating: null });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
```

- [ ] **Step 8: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm --filter @aichess/runtime lint && pnpm build && pnpm --filter @aichess/runtime typecheck`
Expected: 9 runtime tests pass, ESLint and `tsc` exit 0. The `default` branch in the switch exists for the "unknown event" test and keeps the mapping total if `core` gains events later; TypeScript may flag it as unreachable only under `--noFallthroughCasesInSwitch`, which does not apply to `default`.

- [ ] **Step 9: Commit**

```bash
git add packages/core packages/runtime pnpm-lock.yaml
git commit -m "feat(runtime): spectator events in protocol and per-recipient wire mapping"
```

---

### Task 4: Game repository on Postgres

**Files:**

- Create: `packages/runtime/src/games/repository.ts`
- Create: `packages/runtime/src/testing.ts` (seed helper; Redis helper is added in Task 5)
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/games/repository.test.ts`

**Interfaces:**

- Consumes: `Database`, `Transaction`, tables `agents`, `games`, `moves`, `moveAttempts`, `users` from `@aichess/db`; `GameState`, `DomainEvent`, `MoveRecord`, `START_FEN` from `@aichess/core`; `GameAgents` from `../events/wire.js`.
- Produces:
  - `type Executor = Database | Transaction`
  - `insertGame(ex: Executor, state: GameState): Promise<void>`
  - `loadGame(ex: Executor, gameId: string): Promise<GameState | null>`
  - `loadGameForUpdate(tx: Transaction, gameId: string): Promise<GameState | null>` (locks the `games` row with `FOR UPDATE`)
  - `persistTransition(tx: Transaction, before: GameState, after: GameState, events: DomainEvent[], options: { pgn?: string | null }): Promise<void>`
  - `loadAgentSummaries(ex: Executor, whiteAgentId: string, blackAgentId: string): Promise<GameAgents | null>`
  - `listActiveDeadlines(ex: Executor): Promise<Array<{ gameId: string; ply: number; moveDeadlineAt: number }>>`
  - From `@aichess/runtime/testing`: `seedTwoAgents(db: Database): Promise<GameAgents>` (creates one owner and two agents with fresh slugs).
- `persistTransition` writes only what changed between `before` and `after`: the `games` row, the new `moves` rows (`after.moves.slice(before.moves.length)`) and one `move_attempts` row per `illegal_attempt` event, attributing it to the agent of that colour.

- [ ] **Step 1: Write the seed helper**

`packages/runtime/src/testing.ts`:

```ts
import { randomUUID } from "node:crypto";
import { agents, users, type Database } from "@aichess/db";
import type { GameAgents } from "./events/wire.js";

export async function seedTwoAgents(db: Database): Promise<GameAgents> {
  const suffix = randomUUID().slice(0, 8);
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${suffix}@example.com`, name: `Owner ${suffix}` })
    .returning();
  if (owner === undefined) throw new Error("owner not inserted");
  const rows = await db
    .insert(agents)
    .values([
      {
        ownerId: owner.id,
        name: `Alpha ${suffix}`,
        slug: `alpha-${suffix}`,
        modelProvider: "anthropic",
        modelName: "claude-sonnet-5",
        apiKeyPrefix: suffix,
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: owner.id,
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
```

- [ ] **Step 2: Write the failing repository tests**

`packages/runtime/src/games/repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { applyMove, createGame, startGame, toPgn, type GameState } from "@aichess/core";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { moveAttempts, moves, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTwoAgents } from "../testing.js";
import type { GameAgents } from "../events/wire.js";
import {
  insertGame,
  listActiveDeadlines,
  loadAgentSummaries,
  loadGame,
  loadGameForUpdate,
  persistTransition,
} from "./repository.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("game repository", () => {
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

  function fresh(): GameState {
    return createGame({
      id: randomUUID(),
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
  }

  it("round-trips a created game", async () => {
    const state = fresh();
    await insertGame(db, state);
    expect(await loadGame(db, state.id)).toEqual(state);
  });

  it("returns null for an unknown game", async () => {
    expect(await loadGame(db, randomUUID())).toBeNull();
  });

  it("persists a start and two moves and reloads the identical state", async () => {
    const created = fresh();
    await insertGame(db, created);
    const started = startGame(created, T0 + 10);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));

    const m1 = applyMove(started.state, {
      agentId: agents.white.id,
      ply: 0,
      move: "e4",
      comment: "Centre.",
      now: T0 + 2_000,
    });
    if (!m1.ok) throw new Error(m1.code);
    await db.transaction((tx) => persistTransition(tx, started.state, m1.state, m1.events, {}));

    const m2 = applyMove(m1.state, { agentId: agents.black.id, ply: 1, move: "c5", now: T0 + 4_500 });
    if (!m2.ok) throw new Error(m2.code);
    await db.transaction((tx) => persistTransition(tx, m1.state, m2.state, m2.events, {}));

    const loaded = await loadGame(db, created.id);
    expect(loaded).toEqual(m2.state);
    expect(loaded?.fenHistory).toHaveLength(3);
    expect(loaded?.moves.map((m) => [m.ply, m.san, m.comment, m.thinkTimeMs])).toEqual([
      [1, "e4", "Centre.", 1_990],
      [2, "c5", null, 2_500],
    ]);
  });

  it("records illegal attempts against the offending agent", async () => {
    const created = fresh();
    await insertGame(db, created);
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));

    const bad = applyMove(started.state, { agentId: agents.white.id, ply: 0, move: "Nf6", now: T0 + 1 });
    if (bad.ok || bad.code !== "illegal_move") throw new Error("expected illegal_move");
    await db.transaction((tx) => persistTransition(tx, started.state, bad.state, bad.events, {}));

    const rows = await db.select().from(moveAttempts).where(eq(moveAttempts.gameId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: agents.white.id, ply: 0, submitted: "Nf6", reason: "not_legal" });
    expect((await loadGame(db, created.id))?.illegalAttemptsThisTurn).toBe(1);
  });

  it("stores the pgn and terminal fields of a finished game", async () => {
    const created = fresh();
    await insertGame(db, created);
    let state = startGame(created, T0).state;
    await db.transaction((tx) => persistTransition(tx, created, state, [], {}));
    for (const [agentId, san] of [
      [agents.white.id, "f3"],
      [agents.black.id, "e5"],
      [agents.white.id, "g4"],
      [agents.black.id, "Qh4"],
    ] as const) {
      const before = state;
      const r = applyMove(before, { agentId, ply: before.ply, move: san, now: T0 + before.ply * 1_000 + 500 });
      if (!r.ok) throw new Error(r.code);
      state = r.state;
      const pgn =
        state.status === "finished" ? toPgn(state, { white: agents.white.name, black: agents.black.name }) : null;
      await db.transaction((tx) => persistTransition(tx, before, state, r.events, { pgn }));
    }
    const loaded = await loadGame(db, created.id);
    expect(loaded).toEqual(state);
    expect(loaded?.status).toBe("finished");
    const [row] = await db.query.games.findMany({ where: (g, { eq: equals }) => equals(g.id, created.id) });
    expect(row?.pgn).toContain("Qh4#");
    expect(row?.result).toBe("0-1");
    expect(row?.termination).toBe("checkmate");
    expect(await db.select().from(moves).where(eq(moves.gameId, created.id))).toHaveLength(4);
  });

  it("loads agent summaries in colour order", async () => {
    expect(await loadAgentSummaries(db, agents.white.id, agents.black.id)).toEqual(agents);
    expect(await loadAgentSummaries(db, agents.black.id, agents.white.id)).toEqual({
      white: agents.black,
      black: agents.white,
    });
    expect(await loadAgentSummaries(db, agents.white.id, randomUUID())).toBeNull();
  });

  it("lists deadlines of active games only", async () => {
    const a = fresh();
    const b = fresh();
    await insertGame(db, a);
    await insertGame(db, b);
    const startedA = startGame(a, T0);
    await db.transaction((tx) => persistTransition(tx, a, startedA.state, startedA.events, {}));
    expect(await listActiveDeadlines(db)).toEqual([{ gameId: a.id, ply: 0, moveDeadlineAt: T0 + 60_000 }]);
  });

  it("serialises concurrent updates through the row lock", async () => {
    const created = fresh();
    await insertGame(db, created);
    const order: string[] = [];
    const first = db.transaction(async (tx) => {
      await loadGameForUpdate(tx, created.id);
      order.push("first-locked");
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push("first-done");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = db.transaction(async (tx) => {
      await loadGameForUpdate(tx, created.id);
      order.push("second-locked");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first-locked", "first-done", "second-locked"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test -- repository`
Expected: FAIL, cannot resolve `./repository.js`.

- [ ] **Step 4: Write the repository**

`packages/runtime/src/games/repository.ts`:

```ts
import { START_FEN, type DomainEvent, type GameState, type MoveRecord } from "@aichess/core";
import type { Color } from "@aichess/core/protocol";
import { agents, games, moveAttempts, moves, type Database, type Transaction } from "@aichess/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { GameAgents } from "../events/wire.js";

export type Executor = Database | Transaction;

type GameRow = typeof games.$inferSelect;
type MoveRow = typeof moves.$inferSelect;

function ms(date: Date | null): number | null {
  return date === null ? null : date.getTime();
}

function date(msValue: number | null): Date | null {
  return msValue === null ? null : new Date(msValue);
}

function rowToState(row: GameRow, moveRows: MoveRow[]): GameState {
  const records: MoveRecord[] = moveRows.map((m) => ({
    ply: m.ply,
    color: m.color,
    san: m.san,
    uci: m.uci,
    fenAfter: m.fenAfter,
    comment: m.comment,
    thinkTimeMs: m.thinkTimeMs,
    illegalAttemptsBefore: m.illegalAttemptsBefore,
  }));
  return {
    id: row.id,
    whiteAgentId: row.whiteAgentId,
    blackAgentId: row.blackAgentId,
    status: row.status,
    config: {
      timePerMoveMs: row.timePerMoveMs,
      moveLimitPlies: row.moveLimitPlies,
      illegalAttemptsPerTurn: row.illegalAttemptsPerTurn,
    },
    fen: row.currentFen,
    fenHistory: [START_FEN, ...records.map((m) => m.fenAfter)],
    ply: row.ply,
    moves: records,
    turnStartedAt: ms(row.turnStartedAt),
    moveDeadlineAt: ms(row.moveDeadlineAt),
    illegalAttemptsThisTurn: row.illegalAttemptsThisTurn,
    result: row.result,
    termination: row.termination,
    createdAt: row.createdAt.getTime(),
    startedAt: ms(row.startedAt),
    finishedAt: ms(row.finishedAt),
  };
}

async function loadMoves(ex: Executor, gameId: string): Promise<MoveRow[]> {
  return ex.select().from(moves).where(eq(moves.gameId, gameId)).orderBy(asc(moves.ply));
}

export async function insertGame(ex: Executor, state: GameState): Promise<void> {
  await ex.insert(games).values({
    id: state.id,
    whiteAgentId: state.whiteAgentId,
    blackAgentId: state.blackAgentId,
    status: state.status,
    result: state.result,
    termination: state.termination,
    timePerMoveMs: state.config.timePerMoveMs,
    moveLimitPlies: state.config.moveLimitPlies,
    illegalAttemptsPerTurn: state.config.illegalAttemptsPerTurn,
    currentFen: state.fen,
    ply: state.ply,
    turnStartedAt: date(state.turnStartedAt),
    moveDeadlineAt: date(state.moveDeadlineAt),
    illegalAttemptsThisTurn: state.illegalAttemptsThisTurn,
    createdAt: new Date(state.createdAt),
    startedAt: date(state.startedAt),
    finishedAt: date(state.finishedAt),
    updatedAt: new Date(state.createdAt),
  });
}

export async function loadGame(ex: Executor, gameId: string): Promise<GameState | null> {
  const [row] = await ex.select().from(games).where(eq(games.id, gameId));
  if (row === undefined) return null;
  return rowToState(row, await loadMoves(ex, gameId));
}

export async function loadGameForUpdate(tx: Transaction, gameId: string): Promise<GameState | null> {
  const [row] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
  if (row === undefined) return null;
  return rowToState(row, await loadMoves(tx, gameId));
}

export interface PersistOptions {
  pgn?: string | null;
}

export async function persistTransition(
  tx: Transaction,
  before: GameState,
  after: GameState,
  events: DomainEvent[],
  options: PersistOptions,
): Promise<void> {
  const now = new Date();
  await tx
    .update(games)
    .set({
      status: after.status,
      result: after.result,
      termination: after.termination,
      currentFen: after.fen,
      ply: after.ply,
      turnStartedAt: date(after.turnStartedAt),
      moveDeadlineAt: date(after.moveDeadlineAt),
      illegalAttemptsThisTurn: after.illegalAttemptsThisTurn,
      startedAt: date(after.startedAt),
      finishedAt: date(after.finishedAt),
      ...(options.pgn === undefined ? {} : { pgn: options.pgn }),
      updatedAt: now,
    })
    .where(eq(games.id, after.id));

  const newMoves = after.moves.slice(before.moves.length);
  if (newMoves.length > 0) {
    await tx.insert(moves).values(
      newMoves.map((m) => ({
        gameId: after.id,
        ply: m.ply,
        color: m.color,
        san: m.san,
        uci: m.uci,
        fenAfter: m.fenAfter,
        comment: m.comment,
        thinkTimeMs: m.thinkTimeMs,
        illegalAttemptsBefore: m.illegalAttemptsBefore,
      })),
    );
  }

  const agentIdFor = (color: Color): string => (color === "white" ? after.whiteAgentId : after.blackAgentId);
  const attempts = events.flatMap((e) =>
    e.type === "illegal_attempt"
      ? [{ gameId: after.id, agentId: agentIdFor(e.color), ply: e.ply, submitted: e.submitted, reason: e.reason }]
      : [],
  );
  if (attempts.length > 0) {
    await tx.insert(moveAttempts).values(attempts);
  }
}

export async function loadAgentSummaries(
  ex: Executor,
  whiteAgentId: string,
  blackAgentId: string,
): Promise<GameAgents | null> {
  const rows = await ex
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
    })
    .from(agents)
    .where(inArray(agents.id, [whiteAgentId, blackAgentId]));
  const white = rows.find((r) => r.id === whiteAgentId);
  const black = rows.find((r) => r.id === blackAgentId);
  if (white === undefined || black === undefined) return null;
  return { white, black };
}

export async function listActiveDeadlines(
  ex: Executor,
): Promise<Array<{ gameId: string; ply: number; moveDeadlineAt: number }>> {
  const rows = await ex
    .select({ gameId: games.id, ply: games.ply, moveDeadlineAt: games.moveDeadlineAt })
    .from(games)
    .where(and(eq(games.status, "active"), isNotNull(games.moveDeadlineAt)));
  return rows.flatMap((r) =>
    r.moveDeadlineAt === null ? [] : [{ gameId: r.gameId, ply: r.ply, moveDeadlineAt: r.moveDeadlineAt.getTime() }],
  );
}
```

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./games/repository.js";
```

- [ ] **Step 5: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm --filter @aichess/runtime lint && pnpm build && pnpm --filter @aichess/runtime typecheck`
Expected: all runtime tests pass (9 wire + 8 repository). If the "identical state" test fails on `createdAt` by a few milliseconds, the insert is not writing `createdAt` from the state; it must, so that a reloaded state equals the in-memory one.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): game repository with row locks and transition persistence"
```

---

### Task 5: Event bus on Redis pub/sub

**Files:**

- Modify: `packages/runtime/src/testing.ts` (add `startTestRedis`)
- Create: `packages/runtime/src/logger.ts`
- Create: `packages/runtime/src/events/bus.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/events/bus.test.ts`

**Interfaces:**

- Consumes: `WireEventSchema`, `WireEvent` from `@aichess/core/protocol`; `Outgoing` from `./wire.js`; `Redis` from `ioredis`.
- Produces:
  - `interface RuntimeLogger { info(meta: Record<string, unknown>, message: string): void; warn(meta, message): void; error(meta, message): void }` (pino-compatible call shape) and `noopLogger`.
  - `agentChannel(agentId: string): string` returning `agent:{agentId}`; `gameChannel(gameId: string): string` returning `game:{gameId}`.
  - `interface GameParties { gameId: string; whiteAgentId: string; blackAgentId: string }`
  - `type EventHandler = (event: WireEvent) => void`
  - `class EventBus` with `static connect(url: string, logger: RuntimeLogger): Promise<EventBus>`, `publish(parties: GameParties, outgoing: Outgoing): Promise<void>`, `subscribeAgent(agentId, handler): Promise<() => Promise<void>>`, `subscribeGame(gameId, handler): Promise<() => Promise<void>>`, `close(): Promise<void>`.
  - `createRedis(url: string): Redis` (ioredis with `maxRetriesPerRequest: null`, the setting BullMQ requires, and `lazyConnect: true`).
  - From `@aichess/runtime/testing`: `startTestRedis(): Promise<{ url: string; stop: () => Promise<void> }>`.
- Messages are JSON `WireEvent`s. Anything on a channel that fails `WireEventSchema` is logged at `warn` and dropped. A handler that throws is logged at `error` and does not affect other handlers.

- [ ] **Step 1: Add the Redis test helper and the logger interface**

Append to `packages/runtime/src/testing.ts`:

```ts
import { RedisContainer } from "@testcontainers/redis";

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

Move the new `import` line to the top of the file with the other imports.

`packages/runtime/src/logger.ts`:

```ts
export interface RuntimeLogger {
  info(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
  error(meta: Record<string, unknown>, message: string): void;
}

export const noopLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
```

- [ ] **Step 2: Write the failing bus tests**

`packages/runtime/src/events/bus.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { WireEvent } from "@aichess/core/protocol";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeLogger } from "../logger.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { EventBus, agentChannel, gameChannel } from "./bus.js";

function ping(at: string): WireEvent {
  return { type: "ping", at };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("EventBus", () => {
  let redis: TestRedis;
  let logger: RuntimeLogger;
  let bus: EventBus;

  beforeAll(async () => {
    redis = await startTestRedis();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bus = await EventBus.connect(redis.url, logger);
  });

  afterAll(async () => {
    await bus.close();
    await redis.stop();
  });

  it("names channels by recipient", () => {
    expect(agentChannel("a1")).toBe("agent:a1");
    expect(gameChannel("g1")).toBe("game:g1");
  });

  it("routes each recipient list to its own channel, in order", async () => {
    const parties = { gameId: randomUUID(), whiteAgentId: randomUUID(), blackAgentId: randomUUID() };
    const white: WireEvent[] = [];
    const black: WireEvent[] = [];
    const pub: WireEvent[] = [];
    const offWhite = await bus.subscribeAgent(parties.whiteAgentId, (e) => white.push(e));
    const offBlack = await bus.subscribeAgent(parties.blackAgentId, (e) => black.push(e));
    const offPublic = await bus.subscribeGame(parties.gameId, (e) => pub.push(e));

    await bus.publish(parties, {
      toWhite: [ping("2026-01-01T00:00:00.000Z"), ping("2026-01-01T00:00:01.000Z")],
      toBlack: [ping("2026-01-01T00:00:02.000Z")],
      toPublic: [ping("2026-01-01T00:00:03.000Z")],
    });

    await waitFor(() => white.length === 2 && black.length === 1 && pub.length === 1);
    expect(white.map((e) => (e.type === "ping" ? e.at : ""))).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z",
    ]);
    expect(black[0]).toEqual(ping("2026-01-01T00:00:02.000Z"));
    expect(pub[0]).toEqual(ping("2026-01-01T00:00:03.000Z"));

    await offWhite();
    await offBlack();
    await offPublic();
  });

  it("stops delivering after unsubscribe and keeps other handlers alive", async () => {
    const gameId = randomUUID();
    const first: WireEvent[] = [];
    const second: WireEvent[] = [];
    const offFirst = await bus.subscribeGame(gameId, (e) => first.push(e));
    const offSecond = await bus.subscribeGame(gameId, (e) => second.push(e));
    const parties = { gameId, whiteAgentId: randomUUID(), blackAgentId: randomUUID() };

    await bus.publish(parties, { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:00.000Z")] });
    await waitFor(() => first.length === 1 && second.length === 1);

    await offFirst();
    await bus.publish(parties, { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:01.000Z")] });
    await waitFor(() => second.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(first).toHaveLength(1);
    await offSecond();
  });

  it("drops malformed messages with a warning", async () => {
    const gameId = randomUUID();
    const received: WireEvent[] = [];
    const off = await bus.subscribeGame(gameId, (e) => received.push(e));
    const raw = new Redis(redis.url);
    await raw.publish(gameChannel(gameId), "{not json");
    await raw.publish(gameChannel(gameId), JSON.stringify({ type: "game.nope" }));
    await raw.publish(gameChannel(gameId), JSON.stringify(ping("2026-01-01T00:00:00.000Z")));
    await waitFor(() => received.length === 1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await raw.quit();
    await off();
  });

  it("isolates a throwing handler", async () => {
    const gameId = randomUUID();
    const received: WireEvent[] = [];
    const offBad = await bus.subscribeGame(gameId, () => {
      throw new Error("boom");
    });
    const offGood = await bus.subscribeGame(gameId, (e) => received.push(e));
    await bus.publish(
      { gameId, whiteAgentId: randomUUID(), blackAgentId: randomUUID() },
      { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:00.000Z")] },
    );
    await waitFor(() => received.length === 1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ channel: gameChannel(gameId) }),
      "event handler failed",
    );
    await offBad();
    await offGood();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test -- bus`
Expected: FAIL, cannot resolve `./bus.js`.

- [ ] **Step 4: Write the bus**

`packages/runtime/src/events/bus.ts`:

```ts
import { WireEventSchema, type WireEvent } from "@aichess/core/protocol";
import { Redis } from "ioredis";
import type { RuntimeLogger } from "../logger.js";
import type { Outgoing } from "./wire.js";

export function agentChannel(agentId: string): string {
  return `agent:${agentId}`;
}

export function gameChannel(gameId: string): string {
  return `game:${gameId}`;
}

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true, enableReadyCheck: true });
}

export interface GameParties {
  gameId: string;
  whiteAgentId: string;
  blackAgentId: string;
}

export type EventHandler = (event: WireEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  private constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly logger: RuntimeLogger,
  ) {
    this.subscriber.on("message", (channel: string, message: string) => this.dispatch(channel, message));
  }

  static async connect(url: string, logger: RuntimeLogger): Promise<EventBus> {
    const publisher = createRedis(url);
    const subscriber = createRedis(url);
    await publisher.connect();
    try {
      await subscriber.connect();
    } catch (error) {
      publisher.disconnect();
      throw error;
    }
    return new EventBus(publisher, subscriber, logger);
  }

  async publish(parties: GameParties, outgoing: Outgoing): Promise<void> {
    const pipeline = this.publisher.pipeline();
    for (const event of outgoing.toWhite) pipeline.publish(agentChannel(parties.whiteAgentId), JSON.stringify(event));
    for (const event of outgoing.toBlack) pipeline.publish(agentChannel(parties.blackAgentId), JSON.stringify(event));
    for (const event of outgoing.toPublic) pipeline.publish(gameChannel(parties.gameId), JSON.stringify(event));
    const results = await pipeline.exec();
    const failure = results?.find(([error]) => error !== null);
    if (failure !== undefined) {
      throw failure[0];
    }
  }

  subscribeAgent(agentId: string, handler: EventHandler): Promise<() => Promise<void>> {
    return this.subscribe(agentChannel(agentId), handler);
  }

  subscribeGame(gameId: string, handler: EventHandler): Promise<() => Promise<void>> {
    return this.subscribe(gameChannel(gameId), handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  private async subscribe(channel: string, handler: EventHandler): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      const current = this.handlers.get(channel);
      if (current === undefined) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  private dispatch(channel: string, message: string): void {
    const set = this.handlers.get(channel);
    if (set === undefined || set.size === 0) return;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message);
    } catch {
      this.logger.warn({ channel }, "dropped non-JSON event");
      return;
    }
    const parsed = WireEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger.warn({ channel, issues: parsed.error.issues }, "dropped invalid event");
      return;
    }
    for (const handler of set) {
      try {
        handler(parsed.data);
      } catch (error) {
        this.logger.error({ channel, error }, "event handler failed");
      }
    }
  }
}
```

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./logger.js";
export * from "./events/bus.js";
```

- [ ] **Step 5: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm --filter @aichess/runtime lint && pnpm build && pnpm --filter @aichess/runtime typecheck`
Expected: all runtime tests pass (the first run pulls `redis:7-alpine`). If ioredis complains that `subscribe` is not allowed on a connection in subscriber mode, the publisher and subscriber connections were swapped.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): Redis event bus with per-recipient channels"
```

---

### Task 6: Deadline jobs on BullMQ

**Files:**

- Create: `packages/runtime/src/jobs/deadlines.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/jobs/deadlines.test.ts`

**Interfaces:**

- Consumes: `NETWORK_GRACE_MS` from `@aichess/core/protocol`; `Queue` from `bullmq`; `Redis` from `ioredis`.
- Produces:
  - `DEADLINES_QUEUE = "deadlines"`, `DEADLINE_JOB_NAME = "expire"`
  - `interface DeadlineJobData { gameId: string; ply: number }`
  - `type DeadlineQueue = Queue<DeadlineJobData>`
  - `deadlineJobId(gameId: string, ply: number): string` returning `deadline-{gameId}-{ply}`
  - `deadlineFireAt(moveDeadlineAt: number): number` returning `moveDeadlineAt + NETWORK_GRACE_MS`
  - `createDeadlineQueue(connection: Redis): DeadlineQueue`
  - `scheduleDeadline(queue: DeadlineQueue, data: DeadlineJobData, moveDeadlineAt: number, now: number): Promise<void>`
- The job id makes scheduling idempotent: adding a job whose id already exists is a no-op in BullMQ. BullMQ rejects custom ids containing `:` because they collide with its key namespace, so the id uses dashes; the spec's `deadline:{gameId}:{ply}` is the same identity with a different separator.
- Job options: `removeOnComplete: 1000`, `removeOnFail: 5000`, `attempts: 3`, exponential backoff from 1000 ms. A processor that finds the deadline not yet reached must throw so the job is retried; Plan 2b's worker installs a backoff strategy that turns that error into a delay until `fireAt`.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/src/jobs/deadlines.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NETWORK_GRACE_MS } from "@aichess/core/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import {
  DEADLINE_JOB_NAME,
  createDeadlineQueue,
  deadlineFireAt,
  deadlineJobId,
  scheduleDeadline,
  type DeadlineQueue,
} from "./deadlines.js";

describe("deadline jobs", () => {
  let redis: TestRedis;
  let queue: DeadlineQueue;

  beforeAll(async () => {
    redis = await startTestRedis();
    const connection = createRedis(redis.url);
    await connection.connect();
    queue = createDeadlineQueue(connection);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.stop();
  });

  it("derives a stable id and fire time", () => {
    expect(deadlineJobId("g1", 4)).toBe("deadline-g1-4");
    expect(deadlineFireAt(1_000)).toBe(1_000 + NETWORK_GRACE_MS);
  });

  it("schedules a delayed job with the grace period", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 0 }, now + 10_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 0));
    expect(job?.name).toBe(DEADLINE_JOB_NAME);
    expect(job?.data).toEqual({ gameId, ply: 0 });
    expect(job?.opts.delay).toBe(10_000 + NETWORK_GRACE_MS);
    expect(await job?.getState()).toBe("delayed");
  });

  it("is idempotent for the same game and ply", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 3 }, now + 5_000, now);
    await scheduleDeadline(queue, { gameId, ply: 3 }, now + 9_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 3));
    expect(job?.opts.delay).toBe(5_000 + NETWORK_GRACE_MS);
    const delayed = await queue.getDelayed();
    expect(delayed.filter((j) => j.data.gameId === gameId)).toHaveLength(1);
  });

  it("never uses a negative delay for a deadline already in the past", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 1 }, now - 60_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 1));
    expect(job?.opts.delay).toBe(0);
    expect(await job?.getState()).toBe("waiting");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test -- deadlines`
Expected: FAIL, cannot resolve `./deadlines.js`.

- [ ] **Step 3: Write the implementation**

`packages/runtime/src/jobs/deadlines.ts`:

```ts
import { NETWORK_GRACE_MS } from "@aichess/core/protocol";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const DEADLINES_QUEUE = "deadlines";
export const DEADLINE_JOB_NAME = "expire";

export interface DeadlineJobData {
  gameId: string;
  ply: number;
}

export type DeadlineQueue = Queue<DeadlineJobData>;

export function deadlineJobId(gameId: string, ply: number): string {
  return `deadline-${gameId}-${ply}`;
}

export function deadlineFireAt(moveDeadlineAt: number): number {
  return moveDeadlineAt + NETWORK_GRACE_MS;
}

export function createDeadlineQueue(connection: Redis): DeadlineQueue {
  return new Queue<DeadlineJobData>(DEADLINES_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  });
}

export async function scheduleDeadline(
  queue: DeadlineQueue,
  data: DeadlineJobData,
  moveDeadlineAt: number,
  now: number,
): Promise<void> {
  const delay = Math.max(0, deadlineFireAt(moveDeadlineAt) - now);
  await queue.add(DEADLINE_JOB_NAME, data, { jobId: deadlineJobId(data.gameId, data.ply), delay });
}
```

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./jobs/deadlines.js";
```

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm --filter @aichess/runtime lint && pnpm build && pnpm --filter @aichess/runtime typecheck`
Expected: all runtime tests pass. If BullMQ throws on the `Queue` constructor about `maxRetriesPerRequest`, the connection was not created with `createRedis`.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): idempotent deadline jobs on BullMQ"
```

---

### Task 7: GameService: create, move, resign, expire, rearm

**Files:**

- Create: `packages/runtime/src/games/service.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/games/service.test.ts`

**Interfaces:**

- Consumes: `applyMove`, `applyResign`, `applyTimeout`, `createGame`, `startGame`, `toPgn`, `GameState`, `DomainEvent` from `@aichess/core`; `GameConfig`, `GameSnapshot`, `IllegalReason`, `LegalMove` from `@aichess/core/protocol`; `Database` from `@aichess/db`; `EventBus`, `GameParties` from `../events/bus.js`; `toSnapshot`, `toWireEvents`, `GameAgents` from `../events/wire.js`; `scheduleDeadline`, `deadlineFireAt`, `DeadlineQueue` from `../jobs/deadlines.js`; `RuntimeLogger`; repository functions from `./repository.js`.
- Produces:
  - `interface GameServiceDeps { db: Database; bus: EventBus; deadlines: DeadlineQueue; config: GameConfig; logger: RuntimeLogger; now?: () => number; newId?: () => string }`
  - `interface CreateGameInput { whiteAgentId: string; blackAgentId: string; config?: Partial<GameConfig> }`
  - `type CreateGameResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "agents_not_found" }`
  - `interface SubmitMoveInput { gameId: string; agentId: string; ply: number; move: string; comment?: string | null }`
  - `type SubmitMoveResult = { ok: true; idempotent: boolean; snapshot: GameSnapshot } | { ok: false; code: "not_found" | "game_not_active" | "not_your_turn" | "stale_ply" } | { ok: false; code: "illegal_move"; reason: IllegalReason; attemptsLeft: number; legalMoves: LegalMove[]; snapshot: GameSnapshot }`
  - `type ResignResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "not_found" | "game_not_active" }`
  - `type ExpireResult = { ok: true; applied: true; snapshot: GameSnapshot } | { ok: true; applied: false; reason: "stale_ply" | "not_active" } | { ok: false; code: "not_found" } | { ok: false; code: "deadline_not_reached"; fireAt: number }`
  - `class GameService` with `createAndStartGame(input): Promise<CreateGameResult>`, `getSnapshot(gameId, viewerAgentId?): Promise<GameSnapshot | null>`, `submitMove(input): Promise<SubmitMoveResult>`, `resign(input: { gameId; agentId }): Promise<ResignResult>`, `expireDeadline(input: { gameId; ply }): Promise<ExpireResult>`, `rearmActiveDeadlines(): Promise<number>`.
- Every mutation runs in one `db.transaction` that locks the game row first. The transaction returns the result plus an optional post-commit closure; the closure publishes wire events and schedules deadline jobs and runs only after the transaction has committed. Core's `not_a_player` is mapped to `not_found` so a stranger learns nothing about the game.
- A publish failure after commit is logged as `game_events_publish_failed` and does not fail the call: the move is durable and a reconnecting client re-syncs from the snapshot. A scheduling failure is logged as `deadline_schedule_failed`; `rearmActiveDeadlines` on boot and Plan 2b's periodic reconciliation sweep cover it.
- Ratings in `game.end` are `null` in this plan. Plan 3 computes them inside the same transaction and passes them to `toWireEvents`.

- [ ] **Step 1: Write the failing service tests**

`packages/runtime/src/games/service.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS, type WireEvent } from "@aichess/core/protocol";
import { games, moveAttempts, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus, createRedis } from "../events/bus.js";
import type { GameAgents } from "../events/wire.js";
import { createDeadlineQueue, deadlineJobId, type DeadlineQueue } from "../jobs/deadlines.js";
import { noopLogger } from "../logger.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { GameService } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("GameService", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let db: Database;
  let bus: EventBus;
  let queue: DeadlineQueue;
  let agents: GameAgents;
  let clock: number;
  let service: GameService;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    db = tdb.db;
    bus = await EventBus.connect(redis.url, noopLogger);
    const connection = createRedis(redis.url);
    await connection.connect();
    queue = createDeadlineQueue(connection);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await bus.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    await queue.obliterate({ force: true });
    agents = await seedTwoAgents(db);
    clock = T0;
    service = new GameService({
      db,
      bus,
      deadlines: queue,
      config: DEFAULT_GAME_CONFIG,
      logger: noopLogger,
      now: () => clock,
    });
  });

  async function newGame(): Promise<string> {
    const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id });
    if (!r.ok) throw new Error(r.code);
    return r.snapshot.id;
  }

  async function play(gameId: string, san: string): Promise<void> {
    const snapshot = await service.getSnapshot(gameId);
    if (snapshot === null) throw new Error("game missing");
    const agentId = snapshot.turn === "white" ? agents.white.id : agents.black.id;
    clock += 1_000;
    const r = await service.submitMove({ gameId, agentId, ply: snapshot.ply, move: san });
    if (!r.ok) throw new Error(`move ${san} rejected: ${r.code}`);
  }

  describe("createAndStartGame", () => {
    it("creates an active game, notifies both agents and schedules the first deadline", async () => {
      const white: WireEvent[] = [];
      const black: WireEvent[] = [];
      const pub: WireEvent[] = [];
      const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
      const offBlack = await bus.subscribeAgent(agents.black.id, (e) => black.push(e));

      const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const offPublic = await bus.subscribeGame(r.snapshot.id, (e) => pub.push(e));

      expect(r.snapshot).toMatchObject({
        status: "active",
        ply: 0,
        turn: "white",
        white: agents.white,
        black: agents.black,
        moveDeadlineAt: new Date(T0 + 60_000).toISOString(),
        startedAt: new Date(T0).toISOString(),
      });
      expect(r.snapshot.legalMoves).toBeUndefined();

      await waitFor(() => white.length === 2 && black.length === 1);
      expect(white.map((e) => e.type)).toEqual(["game.start", "game.your_turn"]);
      expect(black.map((e) => e.type)).toEqual(["game.start"]);

      const job = await queue.getJob(deadlineJobId(r.snapshot.id, 0));
      expect(job?.data).toEqual({ gameId: r.snapshot.id, ply: 0 });
      expect(job?.opts.delay).toBe(60_000 + NETWORK_GRACE_MS);

      const [row] = await db.select().from(games).where(eq(games.id, r.snapshot.id));
      expect(row?.status).toBe("active");

      await offWhite();
      await offBlack();
      await offPublic();
    });

    it("applies a config override", async () => {
      const r = await service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 5_000 },
      });
      if (!r.ok) throw new Error(r.code);
      expect(r.snapshot.config).toEqual({ ...DEFAULT_GAME_CONFIG, timePerMoveMs: 5_000 });
      expect(r.snapshot.moveDeadlineAt).toBe(new Date(T0 + 5_000).toISOString());
    });

    it("fails when an agent does not exist", async () => {
      const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: randomUUID() });
      expect(r).toEqual({ ok: false, code: "agents_not_found" });
    });
  });

  describe("getSnapshot", () => {
    it("returns legal moves only to the agent on move", async () => {
      const gameId = await newGame();
      expect((await service.getSnapshot(gameId, agents.white.id))?.legalMoves).toHaveLength(20);
      expect((await service.getSnapshot(gameId, agents.black.id))?.legalMoves).toBeUndefined();
      expect((await service.getSnapshot(gameId))?.legalMoves).toBeUndefined();
      expect(await service.getSnapshot(randomUUID())).toBeNull();
    });
  });

  describe("submitMove", () => {
    it("plays a whole game to checkmate, publishing every step and storing the pgn", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const black: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      const offBlack = await bus.subscribeAgent(agents.black.id, (e) => black.push(e));

      clock += 1_500;
      const first = await service.submitMove({
        gameId,
        agentId: agents.white.id,
        ply: 0,
        move: "f3",
        comment: "Testing.",
      });
      expect(first).toMatchObject({ ok: true, idempotent: false });
      if (!first.ok) return;
      expect(first.snapshot.ply).toBe(1);
      expect(first.snapshot.turn).toBe("black");
      expect(first.snapshot.moveDeadlineAt).toBe(new Date(T0 + 1_500 + 60_000).toISOString());

      for (const san of ["e5", "g4"]) await play(gameId, san);
      const snapshot = await service.getSnapshot(gameId);
      clock += 1_000;
      const last = await service.submitMove({
        gameId,
        agentId: agents.black.id,
        ply: snapshot?.ply ?? -1,
        move: "Qh4#",
      });
      if (!last.ok) throw new Error(last.code);
      expect(last.snapshot).toMatchObject({
        status: "finished",
        result: "0-1",
        termination: "checkmate",
        moveDeadlineAt: null,
      });

      await waitFor(() => pub.filter((e) => e.type === "game.end").length === 1);
      expect(pub.map((e) => e.type)).toEqual([
        "game.move",
        "game.turn",
        "game.move",
        "game.turn",
        "game.move",
        "game.turn",
        "game.move",
        "game.end",
      ]);
      const end = pub[pub.length - 1];
      if (end?.type !== "game.end") throw new Error("expected game.end");
      expect(end.pgn).toContain("Qh4#");
      expect(end.rating).toBeNull();
      expect(black.filter((e) => e.type === "game.your_turn")).toHaveLength(2);

      const [row] = await db.select().from(games).where(eq(games.id, gameId));
      expect(row?.pgn).toContain('[Result "0-1"]');
      for (const ply of [0, 1, 2, 3]) {
        expect(await queue.getJob(deadlineJobId(gameId, ply))).toBeDefined();
      }

      await offPublic();
      await offBlack();
    });

    it("rejects an illegal move, records the attempt and tells spectators", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));

      const r = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "Nf6" });
      expect(r.ok).toBe(false);
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      expect(r.reason).toBe("not_legal");
      expect(r.attemptsLeft).toBe(2);
      expect(r.legalMoves).toHaveLength(20);
      expect(r.snapshot.attemptsLeft).toBe(2);
      expect(r.snapshot.legalMoves).toHaveLength(20);

      await waitFor(() => pub.length === 1);
      expect(pub[0]).toMatchObject({
        type: "game.illegal_attempt",
        color: "white",
        ply: 0,
        submitted: "Nf6",
        attemptsLeft: 2,
      });
      expect(await db.select().from(moveAttempts).where(eq(moveAttempts.gameId, gameId))).toHaveLength(1);
      await offPublic();
    });

    it("forfeits after three illegal attempts", async () => {
      const gameId = await newGame();
      const white: WireEvent[] = [];
      const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
      for (let i = 0; i < 3; i += 1) {
        const r = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "Ke2" });
        if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
        if (i === 2) {
          expect(r.attemptsLeft).toBe(0);
          expect(r.snapshot).toMatchObject({ status: "finished", result: "0-1", termination: "illegal_moves" });
        }
      }
      await waitFor(() => white.some((e) => e.type === "game.end"));
      await offWhite();
    });

    it("treats a replayed move as idempotent without republishing", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      const first = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" });
      expect(first).toMatchObject({ ok: true, idempotent: false });
      await waitFor(() => pub.length === 2);
      const replay = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e2e4" });
      expect(replay).toMatchObject({ ok: true, idempotent: true });
      if (!replay.ok) return;
      expect(replay.snapshot.ply).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pub).toHaveLength(2);
      await offPublic();
    });

    it("maps guard failures to stable codes", async () => {
      const gameId = await newGame();
      expect(await service.submitMove({ gameId: randomUUID(), agentId: agents.white.id, ply: 0, move: "e4" })).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await service.submitMove({ gameId, agentId: randomUUID(), ply: 0, move: "e4" })).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await service.submitMove({ gameId, agentId: agents.black.id, ply: 0, move: "e5" })).toEqual({
        ok: false,
        code: "not_your_turn",
      });
      expect(await service.submitMove({ gameId, agentId: agents.white.id, ply: 5, move: "e4" })).toEqual({
        ok: false,
        code: "stale_ply",
      });
    });

    it("serialises two concurrent moves for the same turn", async () => {
      const gameId = await newGame();
      const [a, b] = await Promise.all([
        service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" }),
        service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "d4" }),
      ]);
      const codes = [a, b].map((r) => (r.ok ? "ok" : r.code)).sort();
      expect(codes).toEqual(["ok", "stale_ply"]);
      expect((await service.getSnapshot(gameId))?.ply).toBe(1);
    });
  });

  describe("resign", () => {
    it("ends the game for the resigning side", async () => {
      const gameId = await newGame();
      const r = await service.resign({ gameId, agentId: agents.black.id });
      expect(r).toMatchObject({
        ok: true,
        snapshot: { status: "finished", result: "1-0", termination: "resignation" },
      });
      expect(await service.resign({ gameId, agentId: agents.white.id })).toEqual({
        ok: false,
        code: "game_not_active",
      });
    });

    it("hides the game from strangers", async () => {
      const gameId = await newGame();
      expect(await service.resign({ gameId, agentId: randomUUID() })).toEqual({ ok: false, code: "not_found" });
      expect(await service.resign({ gameId: randomUUID(), agentId: agents.white.id })).toEqual({
        ok: false,
        code: "not_found",
      });
    });
  });

  describe("expireDeadline", () => {
    it("refuses to fire early and reports when to retry", async () => {
      const gameId = await newGame();
      clock = T0 + 60_000;
      expect(await service.expireDeadline({ gameId, ply: 0 })).toEqual({
        ok: false,
        code: "deadline_not_reached",
        fireAt: T0 + 60_000 + NETWORK_GRACE_MS,
      });
    });

    it("aborts a game nobody played", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      clock = T0 + 60_000 + NETWORK_GRACE_MS;
      const r = await service.expireDeadline({ gameId, ply: 0 });
      expect(r).toMatchObject({
        ok: true,
        applied: true,
        snapshot: { status: "aborted", result: "*", termination: "aborted" },
      });
      await waitFor(() => pub.length === 1);
      expect(pub[0]).toMatchObject({ type: "game.end", result: "*", termination: "aborted" });
      await offPublic();
    });

    it("makes the side on move lose after both have played", async () => {
      const gameId = await newGame();
      await play(gameId, "e4");
      await play(gameId, "e5");
      const snapshot = await service.getSnapshot(gameId);
      clock = Date.parse(snapshot?.moveDeadlineAt ?? "") + NETWORK_GRACE_MS;
      const r = await service.expireDeadline({ gameId, ply: 2 });
      expect(r).toMatchObject({
        ok: true,
        applied: true,
        snapshot: { status: "finished", result: "0-1", termination: "timeout" },
      });
    });

    it("ignores a job for an old ply or a finished game", async () => {
      const gameId = await newGame();
      await play(gameId, "e4");
      clock = T0 + 10 * 60_000;
      expect(await service.expireDeadline({ gameId, ply: 0 })).toEqual({
        ok: true,
        applied: false,
        reason: "stale_ply",
      });
      await service.resign({ gameId, agentId: agents.white.id });
      expect(await service.expireDeadline({ gameId, ply: 1 })).toEqual({
        ok: true,
        applied: false,
        reason: "not_active",
      });
      expect(await service.expireDeadline({ gameId: randomUUID(), ply: 0 })).toEqual({ ok: false, code: "not_found" });
    });
  });

  describe("rearmActiveDeadlines", () => {
    it("re-schedules a job for every active game", async () => {
      const a = await newGame();
      const b = await newGame();
      await service.resign({ gameId: b, agentId: agents.black.id });
      await queue.obliterate({ force: true });
      expect(await service.rearmActiveDeadlines()).toBe(1);
      expect(await queue.getJob(deadlineJobId(a, 0))).toBeDefined();
      expect(await queue.getJob(deadlineJobId(b, 0))).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aichess/runtime test -- service`
Expected: FAIL, cannot resolve `./service.js`.

- [ ] **Step 3: Write the service**

`packages/runtime/src/games/service.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  applyMove,
  applyResign,
  applyTimeout,
  createGame,
  startGame,
  toPgn,
  type DomainEvent,
  type GameState,
} from "@aichess/core";
import type { GameConfig, GameSnapshot, IllegalReason, LegalMove } from "@aichess/core/protocol";
import type { Database } from "@aichess/db";
import type { EventBus, GameParties } from "../events/bus.js";
import { toSnapshot, toWireEvents, type GameAgents } from "../events/wire.js";
import { deadlineFireAt, scheduleDeadline, type DeadlineQueue } from "../jobs/deadlines.js";
import type { RuntimeLogger } from "../logger.js";
import {
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
    await this.deps.db.transaction(async (tx) => {
      await insertGame(tx, created);
      await persistTransition(tx, created, started.state, started.events, {});
    });
    await this.afterCommit(started.state, agents, started.events, null);
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
        const pgn = this.pgnIfOver(r.state, agents);
        await persistTransition(tx, state, r.state, r.events, pgn === null ? {} : { pgn });
        return {
          result: { ok: true, idempotent: false, snapshot: toSnapshot(r.state, agents, input.agentId) },
          postCommit: () => this.afterCommit(r.state, agents, r.events, pgn),
        };
      }

      if (r.code === "illegal_move") {
        const pgn = this.pgnIfOver(r.state, agents);
        await persistTransition(tx, state, r.state, r.events, pgn === null ? {} : { pgn });
        return {
          result: {
            ok: false,
            code: "illegal_move",
            reason: r.reason,
            attemptsLeft: r.attemptsLeft,
            legalMoves: r.legalMoves,
            snapshot: toSnapshot(r.state, agents, input.agentId),
          },
          postCommit: () => this.afterCommit(r.state, agents, r.events, pgn),
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
      const pgn = this.pgnIfOver(r.state, agents);
      await persistTransition(tx, state, r.state, r.events, pgn === null ? {} : { pgn });
      return {
        result: { ok: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, pgn),
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
      const pgn = this.pgnIfOver(r.state, agents);
      await persistTransition(tx, state, r.state, r.events, pgn === null ? {} : { pgn });
      return {
        result: { ok: true, applied: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, pgn),
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

  private async agentsOf(ex: Executor, state: GameState): Promise<GameAgents> {
    const agents = await loadAgentSummaries(ex, state.whiteAgentId, state.blackAgentId);
    if (agents === null) {
      throw new Error(`agents missing for game ${state.id}`);
    }
    return agents;
  }

  private pgnIfOver(state: GameState, agents: GameAgents): string | null {
    if (!isOver(state)) return null;
    return toPgn(state, {
      white: agents.white.name,
      black: agents.black.name,
      date: new Date(state.startedAt ?? state.createdAt),
    });
  }

  private async afterCommit(
    state: GameState,
    agents: GameAgents,
    events: DomainEvent[],
    pgn: string | null,
  ): Promise<void> {
    const outgoing = toWireEvents(state, agents, events, { pgn, ratings: { white: null, black: null } });
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

Add to `packages/runtime/src/index.ts`:

```ts
export * from "./games/service.js";
```

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `pnpm --filter @aichess/runtime test && pnpm --filter @aichess/runtime lint && pnpm build && pnpm --filter @aichess/runtime typecheck`
Expected: all runtime tests pass (wire 9, repository 8, bus 5, deadlines 4, service 17). If the concurrency test yields `["ok", "ok"]`, the second transaction did not wait on the row lock: check that `loadGameForUpdate` uses `.for("update")` and that both calls run on the same `db` pool.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): GameService with locked transactions, post-commit events and deadlines"
```

---

### Task 8: Documentation and spec alignment

**Files:**

- Create: `packages/runtime/README.md`
- Create: `packages/db/README.md`
- Modify: `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 4, 5, 6)
- Modify: `README.md` (status table)

**Interfaces:**

- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Write the package READMEs**

`packages/db/README.md`:

```markdown
# @aichess/db

Drizzle schema, SQL migrations and Postgres client for aichess.

## Entry points

- `@aichess/db`: tables, relations, `createDb(url)`, `runMigrations(db)`, `Database` and `Transaction` types.
- `@aichess/db/testing`: `startTestDatabase()` and `truncateAll(db)` for integration tests. Requires Docker; never import it from production code.

## Migrations

Migrations are generated from the schema and committed under `drizzle/`.
```

pnpm --filter @aichess/core build # drizzle-kit loads enums from core's dist
pnpm --filter @aichess/db generate # writes drizzle/NNNN_*.sql
DATABASE_URL=postgres://... pnpm --filter @aichess/db migrate

```

Migrations are additive. Dropping a column happens in a release after the one that stops using it.

## Tables

`users`, `agents`, `games`, `moves`, `move_attempts`. Enum types mirror the const arrays in `@aichess/core/protocol` so the database and the protocol cannot drift apart.
```

`packages/runtime/README.md`:

```markdown
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

## Testing

Integration tests start Postgres and Redis with testcontainers:
```

pnpm --filter @aichess/runtime test

```

`@aichess/runtime/testing` exports `seedTwoAgents(db)` and `startTestRedis()` for other packages' tests.
```

- [ ] **Step 2: Align the spec**

In `docs/superpowers/specs/2026-09-03-aichess-platform-design.md`:

Section 4, in the layout block, add after the `db/` line:

```
  runtime/    orchestratore condiviso da api e worker: repository, GameService, bus eventi, job scadenze
```

and replace the sentence "`api` e `worker` dipendono da `core` e `db`." with "`runtime` dipende da `core` e `db`. `api` e `worker` dipendono da `runtime`: l'orchestratore vive li', non nell'api, cosi' scadenze e mosse usano lo stesso codice."

Section 5, `games`: after `move_deadline_at` add `, turn_started_at, illegal_attempts_this_turn, move_limit_plies, illegal_attempts_per_turn`.

Section 6, under "Endpoint pubblici", replace the `GET /v1/games/{id}/stream` line with:

```
- `GET /v1/games/{id}/stream`: SSE per spettatori. Apre con `game.snapshot`, poi
  `game.turn` (colore al tratto e scadenza, senza mosse legali), `game.move`,
  `game.illegal_attempt` e `game.end` senza `rating`.
```

Section 7, replace "`core.applyIllegalAttempt(state, color, submitted, reason)`" in the list with "`core.applyMove` copre anche i tentativi illegali: il ramo `illegal_move` del risultato e' la transizione di tentativo".

- [ ] **Step 3: Update the README status table**

In `README.md`, replace the row

```
| `packages/db`, runtime service | Planned in detail, next to be built |
```

with

```
| `packages/db`, `packages/runtime` | Implemented. Schema and migrations, locked transactions, event bus, deadline jobs, service tested against real Postgres and Redis |
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm format:check && pnpm lint && pnpm test`
Expected: everything green.

```bash
git add packages/db/README.md packages/runtime/README.md docs/superpowers/specs README.md
git commit -m "docs: runtime and db READMEs, spec aligned with runtime package"
```

---

## Plan Self-Review Notes

- Spec coverage for this plan's scope: section 4 flow of a move (lock, apply, persist, commit, then publish and schedule) in Tasks 4 and 7; section 5 tables `users`, `agents`, `games`, `moves`, `move_attempts` in Task 2 (`ratings`, `rating_history` belong to Plan 3, `analyses` and `agent_flags` to Plan 6); section 6 event payloads in Task 3; section 7 orchestrator, deadlines with deterministic job ids, row locks and re-arm on boot in Tasks 6 and 7; section 13 configuration from environment is exercised only by `.env.example` here and enforced by the apps in Plan 2b; section 14 logging of external failures in Tasks 5 and 7; section 15 integration tests with real containers throughout.
- Not in this plan, deliberately: HTTP routes, SSE connections, presence keys, rate limiting, the worker process, and the periodic reconciliation sweep. All of them are Plan 2b.
- Type consistency checks done while writing: `GameAgents` is defined once in `wire.ts` and imported everywhere; `Executor` is exported from `repository.ts` for `service.ts`; `EndResult`'s `deadline_not_reached` from core is surfaced as `ExpireResult`'s `deadline_not_reached` with a computed `fireAt`; the plan's `game.turn` and `game.illegal_attempt` names match between `schemas.ts`, `wire.ts` and the tests.
