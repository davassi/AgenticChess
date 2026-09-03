# Plan 1: Monorepo Scaffold and `@aichess/core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm/Turborepo monorepo and deliver `@aichess/core`, the dependency-free package holding chess rules, the game state machine, Glicko-2, API key helpers, and the zod protocol schemas that every other package will consume.

**Architecture:** `core` is pure TypeScript with no database or network access. The game state machine is a set of pure functions `(state, command) -> { state, events }`; the API layer (Plan 2) persists the state and translates domain events into SSE wire events. Protocol schemas live in `core/protocol` so the API, the web app and the SDKs validate against the same definitions.

**Tech Stack:** Node 22, pnpm 10, Turborepo 2, TypeScript 5.9, vitest 3, chess.js 1.4, zod 4.

**Spec:** `docs/superpowers/specs/2026-09-03-aichess-platform-design.md` (sections 3, 4, 6, 7, 9, 13 drive this plan).

## Global Constraints

- TypeScript everywhere. ESM only (`"type": "module"`), imports inside `core` use explicit `.js` extensions.
- `core` has exactly two runtime dependencies: `chess.js` and `zod`. Nothing else.
- Timestamps inside `core` are epoch milliseconds (`number`). ISO strings are a wire concern handled outside `core`.
- Game defaults from the spec: `timePerMoveMs` 60000, `moveLimitPlies` 300, `illegalAttemptsPerTurn` 3, network grace 1000 ms.
- A timeout with fewer than 2 plies played aborts the game (`aborted`, result `*`) instead of producing a loss.
- Draws are automatic, never claimed: stalemate, threefold repetition, fifty-move rule, insufficient material, move limit.
- Illegal-move budget is per turn and resets after every accepted move. `not_your_turn`, `stale_ply`, `game_not_active` never consume budget.
- Comment max 500 characters, plain text.
- Glicko-2: tau 0.5, initial rating 1500, RD 350, volatility 0.06. Provisional while RD > 110.
- API key: `ac_` + 8 char prefix + 32 random bytes base64url. Stored as SHA-256 hex. Compared in constant time.
- Enumerations, verbatim from the spec:
  - `termination`: `checkmate`, `stalemate`, `threefold_repetition`, `fifty_move_rule`, `insufficient_material`, `move_limit`, `timeout`, `illegal_moves`, `resignation`, `aborted`
  - `result`: `1-0`, `0-1`, `1/2-1/2`, `*`
  - error codes: `unauthorized`, `agent_suspended`, `not_found`, `validation_error`, `not_your_turn`, `stale_ply`, `game_not_active`, `illegal_move`, `already_in_queue`, `not_in_queue`, `in_active_game`, `rate_limited`, `service_unavailable`, `internal_error`
- chess.js 1.4 writes the en passant square in a FEN only when an en passant capture is actually possible. After `1. e4` the FEN ends with `KQkq - 0 1`, not `KQkq e3 0 1`.
- Every task ends with `pnpm --filter @aichess/core test` and `pnpm --filter @aichess/core typecheck` green, then a commit.
- Commit messages end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy`

---

## File Structure

```
package.json                      pnpm workspace root, turbo scripts
pnpm-workspace.yaml
turbo.json
tsconfig.base.json                strict compiler options shared by every package
.nvmrc                            22
packages/core/
  package.json                    @aichess/core, exports "." and "./protocol"
  tsconfig.json                   typecheck config (includes tests)
  tsconfig.build.json             emit config (excludes tests)
  vitest.config.ts
  src/index.ts                    public surface of the package
  src/protocol/index.ts           re-exports enums and schemas
  src/protocol/enums.ts           const arrays + literal types + numeric constants
  src/protocol/schemas.ts         zod schemas for wire payloads
  src/chess/rules.ts              chess.js wrapper: parse, legal moves, apply, terminations
  src/game/state.ts               GameState, GameConfig, MoveRecord, DomainEvent types
  src/game/create.ts              createGame, startGame
  src/game/apply-move.ts          applyMove (legal, illegal, budget, idempotency)
  src/game/end.ts                 applyTimeout, applyResign, finish helper
  src/game/pgn.ts                 toPgn
  src/rating/glicko2.ts           updateRating, isProvisional
  src/auth/api-key.ts             generateApiKey, hashApiKey, splitApiKey, keysMatch
```

Each `src/**/x.ts` has a sibling `x.test.ts`.

---

### Task 1: Monorepo scaffold and core package skeleton

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.build.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the workspace commands `pnpm test`, `pnpm typecheck`, `pnpm build` and the package name `@aichess/core` used by every later task.

- [ ] **Step 1: Verify toolchain**

Run: `node --version && corepack enable && corepack prepare pnpm@10.15.0 --activate && pnpm --version`
Expected: Node `v22.x`, pnpm `10.15.0`. If Node is not 22, install it with your version manager before continuing.

- [ ] **Step 2: Write workspace files**

`package.json`:

```json
{
  "name": "aichess",
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.9.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

`.nvmrc`:

```
22
```

- [ ] **Step 3: Write core package files**

`packages/core/package.json`:

```json
{
  "name": "@aichess/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chess.js": "^1.4.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/core/tsconfig.json`:

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

`packages/core/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing smoke test**

`packages/core/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("core package", () => {
  it("exposes its version", () => {
    expect(CORE_VERSION).toBe("0.0.1");
  });
});
```

- [ ] **Step 5: Install and run the test to verify it fails**

Run: `pnpm install && pnpm --filter @aichess/core test`
Expected: FAIL, vitest reports it cannot resolve `./index.js`.

- [ ] **Step 6: Write the minimal index**

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = "0.0.1";
```

- [ ] **Step 7: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: 1 test passed, `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .nvmrc packages/core
git commit -m "chore: scaffold pnpm/turbo monorepo with @aichess/core skeleton"
```

---

### Task 2: Protocol enums and zod schemas

**Files:**

- Create: `packages/core/src/protocol/enums.ts`
- Create: `packages/core/src/protocol/schemas.ts`
- Create: `packages/core/src/protocol/index.ts`
- Modify: `packages/core/package.json` (add `./protocol` export)
- Test: `packages/core/src/protocol/schemas.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Color`, `GameStatus`, `Termination`, `GameResult`, `ErrorCode`, `IllegalReason` literal types and their `*Schema` zod counterparts; `LegalMove`, `GameConfig`, `MoveRequest`, `ErrorResponse`, `AgentSummary`, `GameSnapshot`, `WireEvent` types; constants `DEFAULT_GAME_CONFIG`, `MAX_COMMENT_LENGTH`, `NETWORK_GRACE_MS`, `MIN_PLIES_FOR_RATED_RESULT`, `UCI_REGEX`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/protocol/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ErrorResponseSchema,
  GameConfigSchema,
  LegalMoveSchema,
  MoveRequestSchema,
  WireEventSchema,
} from "./schemas.js";
import { DEFAULT_GAME_CONFIG, MAX_COMMENT_LENGTH, TERMINATIONS } from "./enums.js";

describe("MoveRequestSchema", () => {
  it("accepts a SAN move with a comment", () => {
    const parsed = MoveRequestSchema.parse({ ply: 0, move: "e4", comment: "Centre." });
    expect(parsed).toEqual({ ply: 0, move: "e4", comment: "Centre." });
  });

  it("trims the move string", () => {
    expect(MoveRequestSchema.parse({ ply: 3, move: "  Nf3 " }).move).toBe("Nf3");
  });

  it("rejects a negative ply", () => {
    expect(MoveRequestSchema.safeParse({ ply: -1, move: "e4" }).success).toBe(false);
  });

  it("rejects a comment longer than the limit", () => {
    const comment = "x".repeat(MAX_COMMENT_LENGTH + 1);
    expect(MoveRequestSchema.safeParse({ ply: 0, move: "e4", comment }).success).toBe(false);
  });

  it("rejects an empty move", () => {
    expect(MoveRequestSchema.safeParse({ ply: 0, move: "   " }).success).toBe(false);
  });
});

describe("LegalMoveSchema", () => {
  it("accepts a promotion in UCI", () => {
    expect(LegalMoveSchema.safeParse({ san: "e8=Q", uci: "e7e8q" }).success).toBe(true);
  });

  it("rejects malformed UCI", () => {
    expect(LegalMoveSchema.safeParse({ san: "e4", uci: "e2-e4" }).success).toBe(false);
  });
});

describe("GameConfigSchema", () => {
  it("accepts the spec defaults", () => {
    expect(GameConfigSchema.parse(DEFAULT_GAME_CONFIG)).toEqual({
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
    });
  });

  it("rejects a non-integer time budget", () => {
    expect(GameConfigSchema.safeParse({ ...DEFAULT_GAME_CONFIG, timePerMoveMs: 1.5 }).success).toBe(false);
  });
});

describe("ErrorResponseSchema", () => {
  it("rejects unknown error codes", () => {
    expect(ErrorResponseSchema.safeParse({ error: "boom", message: "x" }).success).toBe(false);
  });

  it("accepts a known code with details", () => {
    const parsed = ErrorResponseSchema.parse({
      error: "illegal_move",
      message: "Not legal",
      details: { attemptsLeft: 2 },
    });
    expect(parsed.error).toBe("illegal_move");
  });
});

describe("WireEventSchema", () => {
  it("parses a game.move event", () => {
    const event = WireEventSchema.parse({
      type: "game.move",
      gameId: "3f2c1f0e-3d1a-4d9b-9f0e-1c2b3a4d5e6f",
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      comment: null,
      thinkTimeMs: 1200,
    });
    expect(event.type).toBe("game.move");
  });

  it("rejects an unknown event type", () => {
    expect(WireEventSchema.safeParse({ type: "game.nope" }).success).toBe(false);
  });
});

describe("enums", () => {
  it("lists every termination from the spec", () => {
    expect(TERMINATIONS).toEqual([
      "checkmate",
      "stalemate",
      "threefold_repetition",
      "fifty_move_rule",
      "insufficient_material",
      "move_limit",
      "timeout",
      "illegal_moves",
      "resignation",
      "aborted",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test`
Expected: FAIL, cannot resolve `./schemas.js` and `./enums.js`.

- [ ] **Step 3: Write the enums**

`packages/core/src/protocol/enums.ts`:

```ts
export const COLORS = ["white", "black"] as const;
export type Color = (typeof COLORS)[number];

export const GAME_STATUSES = ["created", "active", "finished", "aborted"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const TERMINATIONS = [
  "checkmate",
  "stalemate",
  "threefold_repetition",
  "fifty_move_rule",
  "insufficient_material",
  "move_limit",
  "timeout",
  "illegal_moves",
  "resignation",
  "aborted",
] as const;
export type Termination = (typeof TERMINATIONS)[number];

export const RESULTS = ["1-0", "0-1", "1/2-1/2", "*"] as const;
export type GameResult = (typeof RESULTS)[number];

export const ERROR_CODES = [
  "unauthorized",
  "agent_suspended",
  "not_found",
  "validation_error",
  "not_your_turn",
  "stale_ply",
  "game_not_active",
  "illegal_move",
  "already_in_queue",
  "not_in_queue",
  "in_active_game",
  "rate_limited",
  "service_unavailable",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ILLEGAL_REASONS = ["unparseable", "not_legal"] as const;
export type IllegalReason = (typeof ILLEGAL_REASONS)[number];

export const AGENT_STATUSES = ["active", "suspended"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const MAX_COMMENT_LENGTH = 500;
export const NETWORK_GRACE_MS = 1000;
export const MIN_PLIES_FOR_RATED_RESULT = 2;
export const UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export const DEFAULT_GAME_CONFIG = {
  timePerMoveMs: 60_000,
  moveLimitPlies: 300,
  illegalAttemptsPerTurn: 3,
} as const;
```

- [ ] **Step 4: Write the schemas**

`packages/core/src/protocol/schemas.ts`:

```ts
import { z } from "zod";
import {
  COLORS,
  ERROR_CODES,
  GAME_STATUSES,
  ILLEGAL_REASONS,
  MAX_COMMENT_LENGTH,
  RESULTS,
  TERMINATIONS,
  UCI_REGEX,
} from "./enums.js";

export const ColorSchema = z.enum(COLORS);
export const GameStatusSchema = z.enum(GAME_STATUSES);
export const TerminationSchema = z.enum(TERMINATIONS);
export const GameResultSchema = z.enum(RESULTS);
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export const IllegalReasonSchema = z.enum(ILLEGAL_REASONS);

export const LegalMoveSchema = z.object({
  san: z.string().min(1),
  uci: z.string().regex(UCI_REGEX),
});
export type LegalMove = z.infer<typeof LegalMoveSchema>;

export const GameConfigSchema = z.object({
  timePerMoveMs: z.int().min(1_000).max(3_600_000),
  moveLimitPlies: z.int().min(2).max(2_000),
  illegalAttemptsPerTurn: z.int().min(1).max(10),
});
export type GameConfig = z.infer<typeof GameConfigSchema>;

export const MoveRequestSchema = z.object({
  ply: z.int().min(0),
  move: z.string().trim().min(1).max(10),
  comment: z.string().max(MAX_COMMENT_LENGTH).optional(),
});
export type MoveRequest = z.infer<typeof MoveRequestSchema>;

export const ErrorResponseSchema = z.object({
  error: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const AgentSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  modelProvider: z.string(),
  modelName: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const GameSnapshotSchema = z.object({
  id: z.uuid(),
  status: GameStatusSchema,
  white: AgentSummarySchema,
  black: AgentSummarySchema,
  config: GameConfigSchema,
  fen: z.string(),
  ply: z.int().min(0),
  history: z.array(z.string()),
  turn: ColorSchema,
  moveDeadlineAt: z.iso.datetime().nullable(),
  result: GameResultSchema.nullable(),
  termination: TerminationSchema.nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  legalMoves: z.array(LegalMoveSchema).optional(),
  attemptsLeft: z.int().min(0).optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const HelloEventSchema = z.object({
  type: z.literal("hello"),
  agentId: z.uuid(),
  activeGame: GameSnapshotSchema.nullable(),
});

export const QueueJoinedEventSchema = z.object({
  type: z.literal("queue.joined"),
  queuedAt: z.iso.datetime(),
});

export const QueueLeftEventSchema = z.object({
  type: z.literal("queue.left"),
  queuedAt: z.iso.datetime(),
});

export const GameStartEventSchema = z.object({
  type: z.literal("game.start"),
  gameId: z.uuid(),
  color: ColorSchema,
  opponent: AgentSummarySchema,
  timePerMoveMs: z.int().min(1_000),
  startedAt: z.iso.datetime(),
});

export const YourTurnEventSchema = z.object({
  type: z.literal("game.your_turn"),
  gameId: z.uuid(),
  ply: z.int().min(0),
  fen: z.string(),
  history: z.array(z.string()),
  lastMove: LegalMoveSchema.nullable(),
  legalMoves: z.array(LegalMoveSchema),
  deadlineAt: z.iso.datetime(),
  attemptsLeft: z.int().min(0),
});

export const MoveEventSchema = z.object({
  type: z.literal("game.move"),
  gameId: z.uuid(),
  ply: z.int().min(1),
  color: ColorSchema,
  san: z.string(),
  uci: z.string().regex(UCI_REGEX),
  fen: z.string(),
  comment: z.string().nullable(),
  thinkTimeMs: z.int().min(0),
});

export const GameEndEventSchema = z.object({
  type: z.literal("game.end"),
  gameId: z.uuid(),
  result: GameResultSchema,
  termination: TerminationSchema,
  pgn: z.string(),
  rating: z.object({ before: z.number(), after: z.number() }).nullable(),
});

export const PingEventSchema = z.object({
  type: z.literal("ping"),
  at: z.iso.datetime(),
});

export const WireEventSchema = z.discriminatedUnion("type", [
  HelloEventSchema,
  QueueJoinedEventSchema,
  QueueLeftEventSchema,
  GameStartEventSchema,
  YourTurnEventSchema,
  MoveEventSchema,
  GameEndEventSchema,
  PingEventSchema,
]);
export type WireEvent = z.infer<typeof WireEventSchema>;
```

- [ ] **Step 5: Write the protocol index and export it from the package**

`packages/core/src/protocol/index.ts`:

```ts
export * from "./enums.js";
export * from "./schemas.js";
```

In `packages/core/package.json`, replace the `exports` block with:

```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./protocol": { "types": "./dist/protocol/index.d.ts", "default": "./dist/protocol/index.js" }
  },
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./protocol/index.js";
```

- [ ] **Step 6: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): protocol enums and zod schemas"
```

---

### Task 3: Chess rules wrapper over chess.js

**Files:**

- Create: `packages/core/src/chess/rules.ts`
- Test: `packages/core/src/chess/rules.test.ts`

**Interfaces:**

- Consumes: `LegalMove` from `../protocol/schemas.js`; `Color`, `IllegalReason`, `Termination`, `UCI_REGEX` from `../protocol/enums.js`.
- Produces:
  - `START_FEN: string`
  - `turnOf(fen: string): Color`
  - `legalMoves(fen: string): LegalMove[]`
  - `tryMove(fen: string, input: string): { ok: true; move: ParsedMove } | { ok: false; reason: IllegalReason }` where `ParsedMove = { san: string; uci: string; fenAfter: string }`
  - `normalizeFenForRepetition(fen: string): string` (first four FEN fields)
  - `detectBoardTermination(fen: string, fenHistory: readonly string[]): BoardTermination | null` where `BoardTermination = "checkmate" | "stalemate" | "threefold_repetition" | "fifty_move_rule" | "insufficient_material"`
  - `resultForWinner(winner: Color): GameResult`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/chess/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  START_FEN,
  detectBoardTermination,
  legalMoves,
  normalizeFenForRepetition,
  resultForWinner,
  tryMove,
  turnOf,
} from "./rules.js";

function play(fen: string, inputs: string[]): { fen: string; history: string[] } {
  const history = [fen];
  let current = fen;
  for (const input of inputs) {
    const r = tryMove(current, input);
    if (!r.ok) throw new Error(`illegal in test setup: ${input} (${r.reason})`);
    current = r.move.fenAfter;
    history.push(current);
  }
  return { fen: current, history };
}

describe("turnOf", () => {
  it("reads the side to move from the FEN", () => {
    expect(turnOf(START_FEN)).toBe("white");
    expect(turnOf(play(START_FEN, ["e4"]).fen)).toBe("black");
  });
});

describe("legalMoves", () => {
  it("returns the 20 opening moves with SAN and UCI", () => {
    const moves = legalMoves(START_FEN);
    expect(moves).toHaveLength(20);
    expect(moves).toContainEqual({ san: "e4", uci: "e2e4" });
    expect(moves).toContainEqual({ san: "Nf3", uci: "g1f3" });
  });

  it("returns an empty list when the game is over", () => {
    const mate = play(START_FEN, ["f3", "e5", "g4", "Qh4"]).fen;
    expect(legalMoves(mate)).toEqual([]);
  });
});

describe("tryMove", () => {
  it("accepts SAN", () => {
    const r = tryMove(START_FEN, "e4");
    expect(r).toMatchObject({ ok: true, move: { san: "e4", uci: "e2e4" } });
  });

  it("accepts UCI", () => {
    const r = tryMove(START_FEN, "g1f3");
    expect(r).toMatchObject({ ok: true, move: { san: "Nf3", uci: "g1f3" } });
  });

  it("tolerates hyphenated UCI, annotations and zero-style castling", () => {
    expect(tryMove(START_FEN, "e2-e4")).toMatchObject({ ok: true, move: { uci: "e2e4" } });
    expect(tryMove(START_FEN, "e4!?")).toMatchObject({ ok: true, move: { uci: "e2e4" } });
    const castlingReady = play(START_FEN, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]).fen;
    expect(tryMove(castlingReady, "0-0")).toMatchObject({ ok: true, move: { san: "O-O", uci: "e1g1" } });
  });

  it("handles promotion in both notations", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(tryMove(fen, "a8=Q")).toMatchObject({ ok: true, move: { uci: "a7a8q" } });
    expect(tryMove(fen, "a7a8n")).toMatchObject({ ok: true, move: { san: "a8=N" } });
  });

  it("reports not_legal for a well-formed but illegal move", () => {
    expect(tryMove(START_FEN, "Nf6")).toEqual({ ok: false, reason: "not_legal" });
    expect(tryMove(START_FEN, "e2e5")).toEqual({ ok: false, reason: "not_legal" });
  });

  it("reports unparseable for garbage", () => {
    expect(tryMove(START_FEN, "hello")).toEqual({ ok: false, reason: "unparseable" });
    expect(tryMove(START_FEN, "")).toEqual({ ok: false, reason: "unparseable" });
  });

  it("returns the FEN after the move", () => {
    const r = tryMove(START_FEN, "e4");
    expect(r.ok && r.move.fenAfter).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  });
});

describe("normalizeFenForRepetition", () => {
  it("keeps placement, turn, castling and en passant only", () => {
    expect(normalizeFenForRepetition(START_FEN)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });
});

describe("detectBoardTermination", () => {
  it("returns null in a normal position", () => {
    const g = play(START_FEN, ["e4", "e5"]);
    expect(detectBoardTermination(g.fen, g.history)).toBeNull();
  });

  it("detects checkmate", () => {
    const g = play(START_FEN, ["f3", "e5", "g4", "Qh4"]);
    expect(detectBoardTermination(g.fen, g.history)).toBe("checkmate");
  });

  it("detects stalemate", () => {
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    expect(detectBoardTermination(fen, [fen])).toBe("stalemate");
  });

  it("detects insufficient material", () => {
    const fen = "8/8/8/4k3/8/8/8/4K3 w - - 0 1";
    expect(detectBoardTermination(fen, [fen])).toBe("insufficient_material");
  });

  it("detects the fifty-move rule from the halfmove clock", () => {
    const fen = "8/8/8/4k3/8/8/8/4K2R w - - 100 80";
    expect(detectBoardTermination(fen, [fen])).toBe("fifty_move_rule");
  });

  it("detects threefold repetition from the position history", () => {
    const cycle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    const g = play(START_FEN, [...cycle, ...cycle]);
    expect(detectBoardTermination(g.fen, g.history)).toBe("threefold_repetition");
  });

  it("does not flag twofold repetition", () => {
    const g = play(START_FEN, ["Nf3", "Nf6", "Ng1", "Ng8"]);
    expect(detectBoardTermination(g.fen, g.history)).toBeNull();
  });
});

describe("resultForWinner", () => {
  it("maps colours to results", () => {
    expect(resultForWinner("white")).toBe("1-0");
    expect(resultForWinner("black")).toBe("0-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- rules`
Expected: FAIL, cannot resolve `./rules.js`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/chess/rules.ts`:

```ts
import { Chess } from "chess.js";
import type { Color, GameResult, IllegalReason, Termination } from "../protocol/enums.js";
import { UCI_REGEX } from "../protocol/enums.js";
import type { LegalMove } from "../protocol/schemas.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ParsedMove = { san: string; uci: string; fenAfter: string };

export type BoardTermination = Extract<
  Termination,
  "checkmate" | "stalemate" | "threefold_repetition" | "fifty_move_rule" | "insufficient_material"
>;

const SAN_REGEX = /^(O-O(-O)?|[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h](x[a-h])?[1-8](=?[NBRQ])?)[+#]?$/;
const FIFTY_MOVE_HALFMOVES = 100;
const REPETITIONS_FOR_DRAW = 3;

export function turnOf(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function legalMoves(fen: string): LegalMove[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).map((m) => ({
    san: m.san,
    uci: `${m.from}${m.to}${m.promotion ?? ""}`,
  }));
}

function normalizeInput(raw: string): string {
  let s = raw.trim().replace(/[!?]+$/, "");
  s = s.replace(/^0-0-0$/i, "O-O-O").replace(/^0-0$/i, "O-O");
  s = s.replace(/^([a-h][1-8])-([a-h][1-8])([qrbn]?)$/i, "$1$2$3");
  return s;
}

function looksLikeMove(s: string): boolean {
  return UCI_REGEX.test(s.toLowerCase()) || SAN_REGEX.test(s);
}

export function tryMove(
  fen: string,
  input: string,
): { ok: true; move: ParsedMove } | { ok: false; reason: IllegalReason } {
  const s = normalizeInput(input);
  if (s.length === 0 || !looksLikeMove(s)) {
    return { ok: false, reason: "unparseable" };
  }
  const chess = new Chess(fen);
  try {
    const lower = s.toLowerCase();
    const move = UCI_REGEX.test(lower)
      ? chess.move({ from: lower.slice(0, 2), to: lower.slice(2, 4), promotion: lower.slice(4) || undefined })
      : chess.move(s);
    return {
      ok: true,
      move: {
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        fenAfter: chess.fen(),
      },
    };
  } catch {
    return { ok: false, reason: "not_legal" };
  }
}

export function normalizeFenForRepetition(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function detectBoardTermination(fen: string, fenHistory: readonly string[]): BoardTermination | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isInsufficientMaterial()) return "insufficient_material";

  const key = normalizeFenForRepetition(fen);
  let seen = 0;
  for (const past of fenHistory) {
    if (normalizeFenForRepetition(past) === key) seen += 1;
  }
  if (seen >= REPETITIONS_FOR_DRAW) return "threefold_repetition";

  const halfmoves = Number(fen.split(" ")[4] ?? "0");
  if (halfmoves >= FIFTY_MOVE_HALFMOVES) return "fifty_move_rule";

  return null;
}

export function resultForWinner(winner: Color): GameResult {
  return winner === "white" ? "1-0" : "0-1";
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0. If chess.js reports a different SAN for the castling test (for example `O-O` vs `0-0`), the implementation is wrong, not the test: SAN uses the letter O.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chess
git commit -m "feat(core): chess rules wrapper with move parsing and terminations"
```

---

### Task 4: Game state types, createGame and startGame

**Files:**

- Create: `packages/core/src/game/state.ts`
- Create: `packages/core/src/game/create.ts`
- Test: `packages/core/src/game/create.test.ts`

**Interfaces:**

- Consumes: `START_FEN` from `../chess/rules.js`; enums and `GameConfig`.
- Produces (`state.ts`):
  - `interface MoveRecord { ply: number; color: Color; san: string; uci: string; fenAfter: string; comment: string | null; thinkTimeMs: number; illegalAttemptsBefore: number }`
  - `interface GameState { id; whiteAgentId; blackAgentId; status: GameStatus; config: GameConfig; fen: string; fenHistory: string[]; ply: number; moves: MoveRecord[]; turnStartedAt: number | null; moveDeadlineAt: number | null; illegalAttemptsThisTurn: number; result: GameResult | null; termination: Termination | null; createdAt: number; startedAt: number | null; finishedAt: number | null }`
  - `type DomainEvent = { type: "started"; startedAt } | { type: "turn"; color; ply; deadlineAt; attemptsLeft } | { type: "move"; record: MoveRecord } | { type: "illegal_attempt"; color; ply; submitted; reason; attemptsLeft } | { type: "ended"; result; termination; finishedAt }`
  - `interface Transition { state: GameState; events: DomainEvent[] }`
  - `class InvalidTransitionError extends Error { readonly action: string; readonly status: GameStatus }`
  - `sideToMove(state): Color`, `opponentOf(color): Color`, `agentColor(state, agentId): Color | null`
- Produces (`create.ts`):
  - `createGame(input: { id: string; whiteAgentId: string; blackAgentId: string; config: GameConfig; now: number }): GameState`
  - `startGame(state: GameState, now: number): Transition`
- Note for Plan 2: `fenHistory` is not stored in the database. Rebuild it as `[START_FEN, ...moves.map(m => m.fenAfter)]` when loading a game.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/game/create.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../protocol/enums.js";
import { START_FEN } from "../chess/rules.js";
import { createGame, startGame } from "./create.js";
import { InvalidTransitionError, agentColor, opponentOf, sideToMove } from "./state.js";

const input = {
  id: "game-1",
  whiteAgentId: "agent-w",
  blackAgentId: "agent-b",
  config: DEFAULT_GAME_CONFIG,
  now: 1_000_000,
};

describe("createGame", () => {
  it("builds a created game at the start position", () => {
    const state = createGame(input);
    expect(state).toMatchObject({
      id: "game-1",
      status: "created",
      fen: START_FEN,
      fenHistory: [START_FEN],
      ply: 0,
      moves: [],
      turnStartedAt: null,
      moveDeadlineAt: null,
      illegalAttemptsThisTurn: 0,
      result: null,
      termination: null,
      createdAt: 1_000_000,
      startedAt: null,
      finishedAt: null,
    });
  });
});

describe("startGame", () => {
  it("activates the game and gives white the first turn", () => {
    const { state, events } = startGame(createGame(input), 2_000_000);
    expect(state.status).toBe("active");
    expect(state.startedAt).toBe(2_000_000);
    expect(state.turnStartedAt).toBe(2_000_000);
    expect(state.moveDeadlineAt).toBe(2_000_000 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(events).toEqual([
      { type: "started", startedAt: 2_000_000 },
      { type: "turn", color: "white", ply: 0, deadlineAt: 2_060_000, attemptsLeft: 3 },
    ]);
  });

  it("does not mutate the input state", () => {
    const created = createGame(input);
    startGame(created, 2_000_000);
    expect(created.status).toBe("created");
  });

  it("refuses to start a game twice", () => {
    const { state } = startGame(createGame(input), 2_000_000);
    expect(() => startGame(state, 3_000_000)).toThrow(InvalidTransitionError);
  });
});

describe("state helpers", () => {
  it("derives side to move from ply parity", () => {
    const state = createGame(input);
    expect(sideToMove(state)).toBe("white");
    expect(sideToMove({ ...state, ply: 1 })).toBe("black");
    expect(sideToMove({ ...state, ply: 2 })).toBe("white");
  });

  it("maps agents to colours", () => {
    const state = createGame(input);
    expect(agentColor(state, "agent-w")).toBe("white");
    expect(agentColor(state, "agent-b")).toBe("black");
    expect(agentColor(state, "stranger")).toBeNull();
  });

  it("flips colours", () => {
    expect(opponentOf("white")).toBe("black");
    expect(opponentOf("black")).toBe("white");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- create`
Expected: FAIL, cannot resolve `./create.js` and `./state.js`.

- [ ] **Step 3: Write the state module**

`packages/core/src/game/state.ts`:

```ts
import type { Color, GameResult, GameStatus, IllegalReason, Termination } from "../protocol/enums.js";
import type { GameConfig } from "../protocol/schemas.js";

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  fenAfter: string;
  comment: string | null;
  thinkTimeMs: number;
  illegalAttemptsBefore: number;
}

export interface GameState {
  id: string;
  whiteAgentId: string;
  blackAgentId: string;
  status: GameStatus;
  config: GameConfig;
  fen: string;
  fenHistory: string[];
  ply: number;
  moves: MoveRecord[];
  turnStartedAt: number | null;
  moveDeadlineAt: number | null;
  illegalAttemptsThisTurn: number;
  result: GameResult | null;
  termination: Termination | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type DomainEvent =
  | { type: "started"; startedAt: number }
  | { type: "turn"; color: Color; ply: number; deadlineAt: number; attemptsLeft: number }
  | { type: "move"; record: MoveRecord }
  | {
      type: "illegal_attempt";
      color: Color;
      ply: number;
      submitted: string;
      reason: IllegalReason;
      attemptsLeft: number;
    }
  | { type: "ended"; result: GameResult; termination: Termination; finishedAt: number };

export interface Transition {
  state: GameState;
  events: DomainEvent[];
}

export class InvalidTransitionError extends Error {
  readonly action: string;
  readonly status: GameStatus;

  constructor(action: string, status: GameStatus) {
    super(`Cannot ${action} a game in status "${status}"`);
    this.name = "InvalidTransitionError";
    this.action = action;
    this.status = status;
  }
}

export function sideToMove(state: Pick<GameState, "ply">): Color {
  return state.ply % 2 === 0 ? "white" : "black";
}

export function opponentOf(color: Color): Color {
  return color === "white" ? "black" : "white";
}

export function agentColor(state: Pick<GameState, "whiteAgentId" | "blackAgentId">, agentId: string): Color | null {
  if (agentId === state.whiteAgentId) return "white";
  if (agentId === state.blackAgentId) return "black";
  return null;
}
```

- [ ] **Step 4: Write createGame and startGame**

`packages/core/src/game/create.ts`:

```ts
import { START_FEN } from "../chess/rules.js";
import type { GameConfig } from "../protocol/schemas.js";
import { InvalidTransitionError, sideToMove, type GameState, type Transition } from "./state.js";

export interface CreateGameInput {
  id: string;
  whiteAgentId: string;
  blackAgentId: string;
  config: GameConfig;
  now: number;
}

export function createGame(input: CreateGameInput): GameState {
  return {
    id: input.id,
    whiteAgentId: input.whiteAgentId,
    blackAgentId: input.blackAgentId,
    status: "created",
    config: { ...input.config },
    fen: START_FEN,
    fenHistory: [START_FEN],
    ply: 0,
    moves: [],
    turnStartedAt: null,
    moveDeadlineAt: null,
    illegalAttemptsThisTurn: 0,
    result: null,
    termination: null,
    createdAt: input.now,
    startedAt: null,
    finishedAt: null,
  };
}

export function startGame(state: GameState, now: number): Transition {
  if (state.status !== "created") {
    throw new InvalidTransitionError("start", state.status);
  }
  const deadlineAt = now + state.config.timePerMoveMs;
  const next: GameState = {
    ...state,
    status: "active",
    startedAt: now,
    turnStartedAt: now,
    moveDeadlineAt: deadlineAt,
    illegalAttemptsThisTurn: 0,
  };
  return {
    state: next,
    events: [
      { type: "started", startedAt: now },
      {
        type: "turn",
        color: sideToMove(next),
        ply: next.ply,
        deadlineAt,
        attemptsLeft: next.config.illegalAttemptsPerTurn,
      },
    ],
  };
}
```

- [ ] **Step 5: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/game
git commit -m "feat(core): game state types with createGame and startGame"
```

---

### Task 5: applyMove with legal moves, illegal-move budget and ply idempotency

**Files:**

- Modify: `packages/core/src/game/state.ts` (append `finishState`, `endedEvent`)
- Create: `packages/core/src/game/apply-move.ts`
- Test: `packages/core/src/game/apply-move.test.ts`

**Interfaces:**

- Consumes: `tryMove`, `legalMoves`, `detectBoardTermination`, `resultForWinner` from `../chess/rules.js`; `createGame`, `startGame` from `./create.js`; everything in `./state.js`.
- Produces:
  - `finishState(state: GameState, result: GameResult, termination: Termination, finishedAt: number): GameState` (status becomes `aborted` when termination is `aborted`, otherwise `finished`; clears `turnStartedAt` and `moveDeadlineAt`)
  - `endedEvent(state: GameState): DomainEvent` (throws if the state is not finished)
  - `interface MoveCommand { agentId: string; ply: number; move: string; comment?: string | null; now: number }`
  - `type ApplyMoveResult = { ok: true; state; events; idempotent: boolean } | { ok: false; code: "game_not_active" | "not_a_player" | "not_your_turn" | "stale_ply"; state } | { ok: false; code: "illegal_move"; reason: IllegalReason; attemptsLeft: number; legalMoves: LegalMove[]; state; events }`
  - `applyMove(state: GameState, cmd: MoveCommand): ApplyMoveResult`
- Ply convention, used everywhere from here on: `state.ply` is the number of plies played so far and is the value carried by `turn` events and expected in `MoveCommand.ply`. `MoveRecord.ply` is 1-based (`state.ply + 1` at the time the move is played). `state.moves[i]` is the move played at turn index `i`.
- Note for Plan 2: `not_a_player` maps to HTTP 404 `not_found`; the agent is not part of the game and must not learn anything about it.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/game/apply-move.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG, MAX_COMMENT_LENGTH } from "../protocol/enums.js";
import type { GameConfig } from "../protocol/schemas.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import type { GameState } from "./state.js";

const T0 = 1_000_000;
const WHITE = "agent-w";
const BLACK = "agent-b";

function activeGame(config: GameConfig = DEFAULT_GAME_CONFIG): GameState {
  return startGame(createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config, now: T0 }), T0).state;
}

function mustApply(state: GameState, agentId: string, move: string, now: number, comment?: string): GameState {
  const r = applyMove(state, { agentId, ply: state.ply, move, comment, now });
  if (!r.ok) throw new Error(`test setup move rejected: ${move} -> ${r.code}`);
  return r.state;
}

function playLine(state: GameState, sans: string[], startAt = T0 + 1_000): GameState {
  let s = state;
  let now = startAt;
  for (const san of sans) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    s = mustApply(s, agent, san, now);
    now += 1_000;
  }
  return s;
}

describe("applyMove: legal move", () => {
  it("records the move, passes the turn and sets a new deadline", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "e4", comment: " Centre. ", now: T0 + 1_500 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotent).toBe(false);
    expect(r.state.ply).toBe(1);
    expect(r.state.status).toBe("active");
    expect(r.state.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(r.state.fenHistory).toHaveLength(2);
    expect(r.state.turnStartedAt).toBe(T0 + 1_500);
    expect(r.state.moveDeadlineAt).toBe(T0 + 1_500 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(r.state.illegalAttemptsThisTurn).toBe(0);
    expect(r.state.moves).toEqual([
      {
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: r.state.fen,
        comment: "Centre.",
        thinkTimeMs: 1_500,
        illegalAttemptsBefore: 0,
      },
    ]);
    expect(r.events).toEqual([
      { type: "move", record: r.state.moves[0] },
      { type: "turn", color: "black", ply: 1, deadlineAt: r.state.moveDeadlineAt, attemptsLeft: 3 },
    ]);
  });

  it("stores null for a blank comment and truncates a long one", () => {
    const blank = mustApply(activeGame(), WHITE, "e4", T0 + 1, "   ");
    expect(blank.moves[0]?.comment).toBeNull();
    const long = mustApply(activeGame(), WHITE, "e4", T0 + 1, "y".repeat(MAX_COMMENT_LENGTH + 40));
    expect(long.moves[0]?.comment).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("never reports negative think time", () => {
    const s = mustApply(activeGame(), WHITE, "e4", T0 - 5_000);
    expect(s.moves[0]?.thinkTimeMs).toBe(0);
  });

  it("does not mutate the previous state", () => {
    const before = activeGame();
    mustApply(before, WHITE, "e4", T0 + 1);
    expect(before.ply).toBe(0);
    expect(before.moves).toEqual([]);
    expect(before.fenHistory).toHaveLength(1);
  });
});

describe("applyMove: turn and status guards", () => {
  it("rejects a move on a game that has not started", () => {
    const created = createGame({
      id: "g1",
      whiteAgentId: WHITE,
      blackAgentId: BLACK,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
    expect(applyMove(created, { agentId: WHITE, ply: 0, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "game_not_active",
    });
  });

  it("rejects a move from an agent who is not in the game", () => {
    expect(applyMove(activeGame(), { agentId: "stranger", ply: 0, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "not_a_player",
    });
  });

  it("rejects black moving first", () => {
    expect(applyMove(activeGame(), { agentId: BLACK, ply: 0, move: "e5", now: T0 })).toMatchObject({
      ok: false,
      code: "not_your_turn",
    });
  });

  it("rejects a ply from the future", () => {
    expect(applyMove(activeGame(), { agentId: WHITE, ply: 2, move: "e4", now: T0 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });

  it("rejects a move after the game has finished", () => {
    const mated = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(mated.status).toBe("finished");
    expect(applyMove(mated, { agentId: WHITE, ply: mated.ply, move: "a3", now: T0 })).toMatchObject({
      ok: false,
      code: "game_not_active",
    });
  });
});

describe("applyMove: idempotency on ply", () => {
  it("accepts a replay of the move already recorded at that ply without changing state", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    const replay = applyMove(after, { agentId: WHITE, ply: 0, move: "e2e4", now: T0 + 2 });
    expect(replay).toEqual({ ok: true, idempotent: true, state: after, events: [] });
  });

  it("rejects a different move at an old ply", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    expect(applyMove(after, { agentId: WHITE, ply: 0, move: "d4", now: T0 + 2 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });

  it("rejects a replay by the other agent", () => {
    const after = mustApply(activeGame(), WHITE, "e4", T0 + 1);
    expect(applyMove(after, { agentId: BLACK, ply: 0, move: "e4", now: T0 + 2 })).toMatchObject({
      ok: false,
      code: "stale_ply",
    });
  });
});

describe("applyMove: illegal moves", () => {
  it("consumes one attempt and returns the legal moves", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "Nf6", now: T0 + 1 });
    expect(r.ok).toBe(false);
    if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
    expect(r.reason).toBe("not_legal");
    expect(r.attemptsLeft).toBe(2);
    expect(r.legalMoves).toHaveLength(20);
    expect(r.state.status).toBe("active");
    expect(r.state.illegalAttemptsThisTurn).toBe(1);
    expect(r.state.ply).toBe(0);
    expect(r.state.moveDeadlineAt).toBe(T0 + DEFAULT_GAME_CONFIG.timePerMoveMs);
    expect(r.events).toEqual([
      { type: "illegal_attempt", color: "white", ply: 0, submitted: "Nf6", reason: "not_legal", attemptsLeft: 2 },
    ]);
  });

  it("distinguishes unparseable input", () => {
    const r = applyMove(activeGame(), { agentId: WHITE, ply: 0, move: "castle please", now: T0 + 1 });
    expect(r).toMatchObject({ ok: false, code: "illegal_move", reason: "unparseable", attemptsLeft: 2 });
  });

  it("forfeits the game on the last attempt", () => {
    let s = activeGame();
    for (let i = 0; i < 2; i += 1) {
      const r = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + i });
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      s = r.state;
    }
    const last = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + 9 });
    if (last.ok || last.code !== "illegal_move") throw new Error("expected illegal_move");
    expect(last.attemptsLeft).toBe(0);
    expect(last.state.status).toBe("finished");
    expect(last.state.result).toBe("0-1");
    expect(last.state.termination).toBe("illegal_moves");
    expect(last.state.finishedAt).toBe(T0 + 9);
    expect(last.state.moveDeadlineAt).toBeNull();
    expect(last.events).toEqual([
      { type: "illegal_attempt", color: "white", ply: 0, submitted: "Ke2", reason: "not_legal", attemptsLeft: 0 },
      { type: "ended", result: "0-1", termination: "illegal_moves", finishedAt: T0 + 9 },
    ]);
  });

  it("resets the budget after a legal move and records attempts on the move", () => {
    let s = activeGame();
    for (let i = 0; i < 2; i += 1) {
      const r = applyMove(s, { agentId: WHITE, ply: 0, move: "Ke2", now: T0 + i });
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      s = r.state;
    }
    const legal = mustApply(s, WHITE, "e4", T0 + 5);
    expect(legal.moves[0]?.illegalAttemptsBefore).toBe(2);
    expect(legal.illegalAttemptsThisTurn).toBe(0);
    const blackIllegal = applyMove(legal, { agentId: BLACK, ply: 1, move: "e4", now: T0 + 6 });
    expect(blackIllegal).toMatchObject({ ok: false, code: "illegal_move", attemptsLeft: 2 });
  });

  it("does not consume budget for turn or ply errors", () => {
    const s = activeGame();
    applyMove(s, { agentId: BLACK, ply: 0, move: "e5", now: T0 });
    applyMove(s, { agentId: WHITE, ply: 7, move: "e4", now: T0 });
    expect(s.illegalAttemptsThisTurn).toBe(0);
  });
});

describe("applyMove: terminations", () => {
  it("ends the game on checkmate with the mover winning", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4"]);
    const r = applyMove(s, { agentId: BLACK, ply: 3, move: "Qh4#", now: T0 + 50 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.status).toBe("finished");
    expect(r.state.result).toBe("0-1");
    expect(r.state.termination).toBe("checkmate");
    expect(r.state.turnStartedAt).toBeNull();
    expect(r.state.moveDeadlineAt).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(["move", "ended"]);
  });

  it("draws by threefold repetition", () => {
    const s = playLine(activeGame(), ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"]);
    const r = applyMove(s, { agentId: BLACK, ply: 7, move: "Ng8", now: T0 + 99 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "1/2-1/2", termination: "threefold_repetition" });
  });

  it("draws when the move limit is reached", () => {
    const s = activeGame({ ...DEFAULT_GAME_CONFIG, moveLimitPlies: 2 });
    const afterWhite = mustApply(s, WHITE, "e4", T0 + 1);
    expect(afterWhite.status).toBe("active");
    const r = applyMove(afterWhite, { agentId: BLACK, ply: 1, move: "e5", now: T0 + 2 });
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "1/2-1/2", termination: "move_limit" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- apply-move`
Expected: FAIL, cannot resolve `./apply-move.js`.

- [ ] **Step 3: Append finish helpers to the state module**

Append to `packages/core/src/game/state.ts`:

```ts
export function finishState(
  state: GameState,
  result: GameResult,
  termination: Termination,
  finishedAt: number,
): GameState {
  return {
    ...state,
    status: termination === "aborted" ? "aborted" : "finished",
    result,
    termination,
    finishedAt,
    turnStartedAt: null,
    moveDeadlineAt: null,
  };
}

export function endedEvent(state: GameState): DomainEvent {
  if (state.result === null || state.termination === null || state.finishedAt === null) {
    throw new InvalidTransitionError("emit ended event for", state.status);
  }
  return {
    type: "ended",
    result: state.result,
    termination: state.termination,
    finishedAt: state.finishedAt,
  };
}
```

- [ ] **Step 4: Write applyMove**

`packages/core/src/game/apply-move.ts`:

```ts
import { detectBoardTermination, legalMoves, resultForWinner, tryMove } from "../chess/rules.js";
import { MAX_COMMENT_LENGTH, type Color, type IllegalReason } from "../protocol/enums.js";
import type { LegalMove } from "../protocol/schemas.js";
import {
  agentColor,
  endedEvent,
  finishState,
  opponentOf,
  sideToMove,
  type DomainEvent,
  type GameState,
  type MoveRecord,
} from "./state.js";

export interface MoveCommand {
  agentId: string;
  ply: number;
  move: string;
  comment?: string | null | undefined;
  now: number;
}

export type ApplyMoveResult =
  | { ok: true; state: GameState; events: DomainEvent[]; idempotent: boolean }
  | { ok: false; code: "game_not_active" | "not_a_player" | "not_your_turn" | "stale_ply"; state: GameState }
  | {
      ok: false;
      code: "illegal_move";
      reason: IllegalReason;
      attemptsLeft: number;
      legalMoves: LegalMove[];
      state: GameState;
      events: DomainEvent[];
    };

function normalizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null;
  const trimmed = comment.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_COMMENT_LENGTH ? trimmed.slice(0, MAX_COMMENT_LENGTH) : trimmed;
}

function isReplayOfRecordedMove(state: GameState, color: Color, ply: number, input: string): boolean {
  const prior = state.moves[ply];
  const fenBefore = state.fenHistory[ply];
  if (prior === undefined || fenBefore === undefined || prior.color !== color) return false;
  const parsed = tryMove(fenBefore, input);
  return parsed.ok && parsed.move.uci === prior.uci;
}

function rejectIllegal(state: GameState, color: Color, cmd: MoveCommand, reason: IllegalReason): ApplyMoveResult {
  const attempts = state.illegalAttemptsThisTurn + 1;
  const attemptsLeft = Math.max(0, state.config.illegalAttemptsPerTurn - attempts);
  const legal = legalMoves(state.fen);
  const attemptEvent: DomainEvent = {
    type: "illegal_attempt",
    color,
    ply: state.ply,
    submitted: cmd.move,
    reason,
    attemptsLeft,
  };
  const counted: GameState = { ...state, illegalAttemptsThisTurn: attempts };

  if (attemptsLeft === 0) {
    const finished = finishState(counted, resultForWinner(opponentOf(color)), "illegal_moves", cmd.now);
    return {
      ok: false,
      code: "illegal_move",
      reason,
      attemptsLeft,
      legalMoves: legal,
      state: finished,
      events: [attemptEvent, endedEvent(finished)],
    };
  }
  return {
    ok: false,
    code: "illegal_move",
    reason,
    attemptsLeft,
    legalMoves: legal,
    state: counted,
    events: [attemptEvent],
  };
}

export function applyMove(state: GameState, cmd: MoveCommand): ApplyMoveResult {
  if (state.status !== "active") return { ok: false, code: "game_not_active", state };

  const color = agentColor(state, cmd.agentId);
  if (color === null) return { ok: false, code: "not_a_player", state };

  if (cmd.ply < state.ply) {
    if (isReplayOfRecordedMove(state, color, cmd.ply, cmd.move)) {
      return { ok: true, state, events: [], idempotent: true };
    }
    return { ok: false, code: "stale_ply", state };
  }
  if (cmd.ply > state.ply) return { ok: false, code: "stale_ply", state };
  if (color !== sideToMove(state)) return { ok: false, code: "not_your_turn", state };

  const parsed = tryMove(state.fen, cmd.move);
  if (!parsed.ok) return rejectIllegal(state, color, cmd, parsed.reason);

  const turnStartedAt = state.turnStartedAt ?? cmd.now;
  const record: MoveRecord = {
    ply: state.ply + 1,
    color,
    san: parsed.move.san,
    uci: parsed.move.uci,
    fenAfter: parsed.move.fenAfter,
    comment: normalizeComment(cmd.comment),
    thinkTimeMs: Math.max(0, cmd.now - turnStartedAt),
    illegalAttemptsBefore: state.illegalAttemptsThisTurn,
  };
  const fenHistory = [...state.fenHistory, record.fenAfter];
  const advanced: GameState = {
    ...state,
    fen: record.fenAfter,
    fenHistory,
    ply: record.ply,
    moves: [...state.moves, record],
    illegalAttemptsThisTurn: 0,
  };
  const moveEvent: DomainEvent = { type: "move", record };

  const board = detectBoardTermination(advanced.fen, fenHistory);
  if (board !== null) {
    const result = board === "checkmate" ? resultForWinner(color) : "1/2-1/2";
    const finished = finishState(advanced, result, board, cmd.now);
    return { ok: true, idempotent: false, state: finished, events: [moveEvent, endedEvent(finished)] };
  }
  if (advanced.ply >= advanced.config.moveLimitPlies) {
    const finished = finishState(advanced, "1/2-1/2", "move_limit", cmd.now);
    return { ok: true, idempotent: false, state: finished, events: [moveEvent, endedEvent(finished)] };
  }

  const deadlineAt = cmd.now + state.config.timePerMoveMs;
  const next: GameState = { ...advanced, turnStartedAt: cmd.now, moveDeadlineAt: deadlineAt };
  return {
    ok: true,
    idempotent: false,
    state: next,
    events: [
      moveEvent,
      {
        type: "turn",
        color: opponentOf(color),
        ply: next.ply,
        deadlineAt,
        attemptsLeft: next.config.illegalAttemptsPerTurn,
      },
    ],
  };
}
```

- [ ] **Step 5: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/game
git commit -m "feat(core): applyMove with illegal-move budget and ply idempotency"
```

---

### Task 6: applyTimeout and applyResign

**Files:**

- Create: `packages/core/src/game/end.ts`
- Test: `packages/core/src/game/end.test.ts`

**Interfaces:**

- Consumes: `NETWORK_GRACE_MS`, `MIN_PLIES_FOR_RATED_RESULT` from `../protocol/enums.js`; `resultForWinner` from `../chess/rules.js`; `finishState`, `endedEvent`, `agentColor`, `opponentOf`, `sideToMove` from `./state.js`.
- Produces:
  - `type EndResult = ({ ok: true } & Transition) | { ok: false; code: "game_not_active" | "deadline_not_reached" | "not_a_player"; state: GameState }`
  - `applyTimeout(state: GameState, now: number): EndResult`. Applies only when `now >= moveDeadlineAt + NETWORK_GRACE_MS`. Fewer than 2 plies played produces `aborted` with result `*`; otherwise the side to move loses by `timeout`.
  - `applyResign(state: GameState, agentId: string, now: number): EndResult`. Always a loss for the resigning side, even before 2 plies.
- Note for Plan 2: the worker calls `applyTimeout` from the `deadline:{gameId}:{ply}` job after re-reading the game under lock and checking `state.ply` still equals the job's ply. `deadline_not_reached` means the job fired early; reschedule it for `moveDeadlineAt + NETWORK_GRACE_MS`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/game/end.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS } from "../protocol/enums.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import { applyResign, applyTimeout } from "./end.js";
import type { GameState } from "./state.js";

const T0 = 1_000_000;
const WHITE = "agent-w";
const BLACK = "agent-b";
const DEADLINE = T0 + DEFAULT_GAME_CONFIG.timePerMoveMs;

function activeGame(): GameState {
  return startGame(
    createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config: DEFAULT_GAME_CONFIG, now: T0 }),
    T0,
  ).state;
}

function playLine(state: GameState, sans: string[]): GameState {
  let s = state;
  let now = T0 + 1_000;
  for (const san of sans) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    const r = applyMove(s, { agentId: agent, ply: s.ply, move: san, now });
    if (!r.ok) throw new Error(`setup move rejected: ${san} -> ${r.code}`);
    s = r.state;
    now += 1_000;
  }
  return s;
}

describe("applyTimeout", () => {
  it("refuses to fire before the deadline plus grace", () => {
    const s = activeGame();
    expect(applyTimeout(s, DEADLINE)).toMatchObject({ ok: false, code: "deadline_not_reached" });
    expect(applyTimeout(s, DEADLINE + NETWORK_GRACE_MS - 1)).toMatchObject({ ok: false, code: "deadline_not_reached" });
  });

  it("aborts a game where white never moved", () => {
    const now = DEADLINE + NETWORK_GRACE_MS;
    const r = applyTimeout(activeGame(), now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toMatchObject({
      status: "aborted",
      result: "*",
      termination: "aborted",
      finishedAt: now,
      moveDeadlineAt: null,
    });
    expect(r.events).toEqual([{ type: "ended", result: "*", termination: "aborted", finishedAt: now }]);
  });

  it("aborts a game where black never answered the first move", () => {
    const s = playLine(activeGame(), ["e4"]);
    const now = (s.moveDeadlineAt ?? 0) + NETWORK_GRACE_MS;
    const r = applyTimeout(s, now);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "aborted", result: "*", termination: "aborted" });
  });

  it("makes the side to move lose once both have played", () => {
    const s = playLine(activeGame(), ["e4", "e5"]);
    const now = (s.moveDeadlineAt ?? 0) + NETWORK_GRACE_MS;
    const r = applyTimeout(s, now);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({ status: "finished", result: "0-1", termination: "timeout", finishedAt: now });
    expect(r.events).toEqual([{ type: "ended", result: "0-1", termination: "timeout", finishedAt: now }]);
  });

  it("is a no-op on a game that is not active", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(applyTimeout(s, T0 + 10_000_000)).toMatchObject({ ok: false, code: "game_not_active" });
  });
});

describe("applyResign", () => {
  it("gives the win to the opponent, even before two plies", () => {
    const r = applyResign(activeGame(), BLACK, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toMatchObject({
      status: "finished",
      result: "1-0",
      termination: "resignation",
      finishedAt: T0 + 5,
    });
    expect(r.events).toEqual([{ type: "ended", result: "1-0", termination: "resignation", finishedAt: T0 + 5 }]);
  });

  it("lets the side not on move resign", () => {
    const s = playLine(activeGame(), ["e4"]);
    const r = applyResign(s, WHITE, T0 + 5_000);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.result).toBe("0-1");
  });

  it("rejects an agent who is not in the game", () => {
    expect(applyResign(activeGame(), "stranger", T0)).toMatchObject({ ok: false, code: "not_a_player" });
  });

  it("rejects resignation of a finished game", () => {
    const s = playLine(activeGame(), ["f3", "e5", "g4", "Qh4"]);
    expect(applyResign(s, WHITE, T0)).toMatchObject({ ok: false, code: "game_not_active" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- end`
Expected: FAIL, cannot resolve `./end.js`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/game/end.ts`:

```ts
import { resultForWinner } from "../chess/rules.js";
import { MIN_PLIES_FOR_RATED_RESULT, NETWORK_GRACE_MS } from "../protocol/enums.js";
import {
  agentColor,
  endedEvent,
  finishState,
  opponentOf,
  sideToMove,
  type GameState,
  type Transition,
} from "./state.js";

export type EndResult =
  | ({ ok: true } & Transition)
  | { ok: false; code: "game_not_active" | "deadline_not_reached" | "not_a_player"; state: GameState };

export function applyTimeout(state: GameState, now: number): EndResult {
  if (state.status !== "active" || state.moveDeadlineAt === null) {
    return { ok: false, code: "game_not_active", state };
  }
  if (now < state.moveDeadlineAt + NETWORK_GRACE_MS) {
    return { ok: false, code: "deadline_not_reached", state };
  }
  if (state.ply < MIN_PLIES_FOR_RATED_RESULT) {
    const aborted = finishState(state, "*", "aborted", now);
    return { ok: true, state: aborted, events: [endedEvent(aborted)] };
  }
  const loser = sideToMove(state);
  const finished = finishState(state, resultForWinner(opponentOf(loser)), "timeout", now);
  return { ok: true, state: finished, events: [endedEvent(finished)] };
}

export function applyResign(state: GameState, agentId: string, now: number): EndResult {
  if (state.status !== "active") {
    return { ok: false, code: "game_not_active", state };
  }
  const color = agentColor(state, agentId);
  if (color === null) {
    return { ok: false, code: "not_a_player", state };
  }
  const finished = finishState(state, resultForWinner(opponentOf(color)), "resignation", now);
  return { ok: true, state: finished, events: [endedEvent(finished)] };
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/game
git commit -m "feat(core): timeout and resignation transitions with abort rule"
```

---

### Task 7: PGN export

**Files:**

- Create: `packages/core/src/game/pgn.ts`
- Test: `packages/core/src/game/pgn.test.ts`

**Interfaces:**

- Consumes: `GameState` from `./state.js`; `Chess` from `chess.js`.
- Produces:
  - `interface PgnMeta { white: string; black: string; event?: string; site?: string; date?: Date }`
  - `toPgn(state: GameState, meta: PgnMeta): string`. Seven-tag roster plus `Termination` (our enum, when set) and `TimePerMoveMs`. Agent comments become PGN brace comments after the move they belong to. `}` inside a comment is replaced with `)`, newlines with spaces.
- Note for Plan 2: `meta.white` and `meta.black` are agent display names. `meta.date` defaults to `startedAt`, falling back to `createdAt`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/game/pgn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG } from "../protocol/enums.js";
import { applyMove } from "./apply-move.js";
import { createGame, startGame } from "./create.js";
import { toPgn } from "./pgn.js";
import type { GameState } from "./state.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
const WHITE = "agent-w";
const BLACK = "agent-b";
const META = { white: "Claude Bot", black: "Llama Bot" };

function activeGame(): GameState {
  return startGame(
    createGame({ id: "g1", whiteAgentId: WHITE, blackAgentId: BLACK, config: DEFAULT_GAME_CONFIG, now: T0 }),
    T0,
  ).state;
}

function play(state: GameState, moves: Array<{ san: string; comment?: string }>): GameState {
  let s = state;
  let now = T0 + 1_000;
  for (const m of moves) {
    const agent = s.ply % 2 === 0 ? WHITE : BLACK;
    const r = applyMove(s, { agentId: agent, ply: s.ply, move: m.san, comment: m.comment, now });
    if (!r.ok) throw new Error(`setup move rejected: ${m.san} -> ${r.code}`);
    s = r.state;
    now += 1_000;
  }
  return s;
}

describe("toPgn", () => {
  it("writes the tag roster for a finished game", () => {
    const s = play(activeGame(), [{ san: "f3" }, { san: "e5" }, { san: "g4" }, { san: "Qh4" }]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain('[Event "aichess rated game"]');
    expect(pgn).toContain('[Site "aichess"]');
    expect(pgn).toContain('[Date "2026.09.03"]');
    expect(pgn).toContain('[Round "-"]');
    expect(pgn).toContain('[White "Claude Bot"]');
    expect(pgn).toContain('[Black "Llama Bot"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "checkmate"]');
    expect(pgn).toContain('[TimePerMoveMs "60000"]');
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4#");
  });

  it("places agent comments after their move", () => {
    const s = play(activeGame(), [
      { san: "e4", comment: "Centre." },
      { san: "e5" },
      { san: "Nf3", comment: "Develop." },
    ]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain("1. e4 {Centre.} e5 2. Nf3 {Develop.}");
  });

  it("sanitises braces and newlines inside comments", () => {
    const s = play(activeGame(), [{ san: "e4", comment: "a}b\nc" }]);
    expect(toPgn(s, META)).toContain("{a)b c}");
  });

  it("marks an unfinished game with an asterisk", () => {
    const s = play(activeGame(), [{ san: "d4" }]);
    const pgn = toPgn(s, META);
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).not.toContain("[Termination");
  });

  it("handles a game with no moves", () => {
    const pgn = toPgn(activeGame(), META);
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).toContain('[White "Claude Bot"]');
  });

  it("uses the supplied date and event when given", () => {
    const pgn = toPgn(activeGame(), { ...META, event: "Test Cup", date: new Date(Date.UTC(2030, 0, 15)) });
    expect(pgn).toContain('[Event "Test Cup"]');
    expect(pgn).toContain('[Date "2030.01.15"]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- pgn`
Expected: FAIL, cannot resolve `./pgn.js`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/game/pgn.ts`:

```ts
import { Chess } from "chess.js";
import type { GameState } from "./state.js";

export interface PgnMeta {
  white: string;
  black: string;
  event?: string;
  site?: string;
  date?: Date;
}

const DEFAULT_EVENT = "aichess rated game";
const DEFAULT_SITE = "aichess";

function formatPgnDate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}.${m}.${d}`;
}

function sanitizeComment(comment: string): string {
  return comment.replace(/}/g, ")").replace(/\r?\n/g, " ");
}

export function toPgn(state: GameState, meta: PgnMeta): string {
  const chess = new Chess();
  for (const move of state.moves) {
    chess.move({
      from: move.uci.slice(0, 2),
      to: move.uci.slice(2, 4),
      promotion: move.uci.slice(4) || undefined,
    });
    if (move.comment !== null) {
      chess.setComment(sanitizeComment(move.comment));
    }
  }

  const date = meta.date ?? new Date(state.startedAt ?? state.createdAt);
  chess.setHeader("Event", meta.event ?? DEFAULT_EVENT);
  chess.setHeader("Site", meta.site ?? DEFAULT_SITE);
  chess.setHeader("Date", formatPgnDate(date));
  chess.setHeader("Round", "-");
  chess.setHeader("White", meta.white);
  chess.setHeader("Black", meta.black);
  chess.setHeader("Result", state.result ?? "*");
  chess.setHeader("TimePerMoveMs", String(state.config.timePerMoveMs));
  if (state.termination !== null) {
    chess.setHeader("Termination", state.termination);
  }
  return chess.pgn();
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0. If `setHeader` does not exist in the installed chess.js, the installed version is below 1.1; run `pnpm --filter @aichess/core add chess.js@^1.4.0` and retry. Do not fall back to the deprecated `header()` call.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/game
git commit -m "feat(core): PGN export with agent comments"
```

---

### Task 8: Glicko-2 rating

**Files:**

- Create: `packages/core/src/rating/glicko2.ts`
- Test: `packages/core/src/rating/glicko2.test.ts`

**Interfaces:**

- Consumes: `Color`, `GameResult` from `../protocol/enums.js`.
- Produces:
  - `interface Glicko2Rating { rating: number; rd: number; volatility: number }`
  - `type Score = 0 | 0.5 | 1`
  - `interface GameOutcome { opponent: Glicko2Rating; score: Score }`
  - `GLICKO2_DEFAULTS = { rating: 1500, rd: 350, volatility: 0.06, tau: 0.5 }`, `PROVISIONAL_RD_THRESHOLD = 110`
  - `initialRating(): Glicko2Rating`
  - `isProvisional(r: Pick<Glicko2Rating, "rd">): boolean`
  - `scoreFor(result: GameResult, color: Color): Score | null` (null for `*`)
  - `updateRating(player: Glicko2Rating, outcomes: GameOutcome[], tau?: number): Glicko2Rating` (Glickman's algorithm; an empty outcome list only inflates RD)
  - `applyGameRatings(white: Glicko2Rating, black: Glicko2Rating, result: GameResult): { white: Glicko2Rating; black: Glicko2Rating } | null` (both sides updated from the pre-game values; null when the result is `*`)
- Note for Plan 3: always call `applyGameRatings` with the ratings as they were before the game. Never update one side and feed the updated value into the other.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/rating/glicko2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GLICKO2_DEFAULTS, applyGameRatings, initialRating, isProvisional, scoreFor, updateRating } from "./glicko2.js";

describe("updateRating", () => {
  it("reproduces the worked example from Glickman's paper", () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const next = updateRating(
      player,
      [
        { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it("only inflates RD when no games were played", () => {
    const player = { rating: 1500, rd: 50, volatility: 0.06 };
    const next = updateRating(player, []);
    expect(next.rating).toBe(1500);
    expect(next.volatility).toBe(0.06);
    expect(next.rd).toBeGreaterThan(50);
  });

  it("raises the rating after a win and lowers it after a loss against an equal", () => {
    const a = initialRating();
    const b = initialRating();
    const win = updateRating(a, [{ opponent: b, score: 1 }]);
    const loss = updateRating(a, [{ opponent: b, score: 0 }]);
    expect(win.rating).toBeGreaterThan(1500);
    expect(loss.rating).toBeLessThan(1500);
    expect(win.rd).toBeLessThan(350);
  });

  it("does not mutate its inputs", () => {
    const a = { rating: 1500, rd: 350, volatility: 0.06 };
    updateRating(a, [{ opponent: { ...a }, score: 0.5 }]);
    expect(a).toEqual({ rating: 1500, rd: 350, volatility: 0.06 });
  });
});

describe("applyGameRatings", () => {
  it("updates both sides from the pre-game values", () => {
    const white = { rating: 1600, rd: 80, volatility: 0.06 };
    const black = { rating: 1500, rd: 120, volatility: 0.06 };
    const out = applyGameRatings(white, black, "0-1");
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.white.rating).toBeLessThan(1600);
    expect(out.black.rating).toBeGreaterThan(1500);
    expect(out.white).toEqual(updateRating(white, [{ opponent: black, score: 0 }]));
    expect(out.black).toEqual(updateRating(black, [{ opponent: white, score: 1 }]));
  });

  it("returns null for an aborted game", () => {
    expect(applyGameRatings(initialRating(), initialRating(), "*")).toBeNull();
  });
});

describe("scoreFor", () => {
  it("maps results to scores per colour", () => {
    expect(scoreFor("1-0", "white")).toBe(1);
    expect(scoreFor("1-0", "black")).toBe(0);
    expect(scoreFor("0-1", "white")).toBe(0);
    expect(scoreFor("0-1", "black")).toBe(1);
    expect(scoreFor("1/2-1/2", "white")).toBe(0.5);
    expect(scoreFor("*", "white")).toBeNull();
  });
});

describe("initialRating and isProvisional", () => {
  it("starts at the spec defaults and is provisional", () => {
    const r = initialRating();
    expect(r).toEqual({
      rating: GLICKO2_DEFAULTS.rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
    });
    expect(isProvisional(r)).toBe(true);
  });

  it("stops being provisional at RD 110", () => {
    expect(isProvisional({ rd: 110.01 })).toBe(true);
    expect(isProvisional({ rd: 110 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- glicko2`
Expected: FAIL, cannot resolve `./glicko2.js`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/rating/glicko2.ts`:

```ts
import type { Color, GameResult } from "../protocol/enums.js";

export interface Glicko2Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export type Score = 0 | 0.5 | 1;

export interface GameOutcome {
  opponent: Glicko2Rating;
  score: Score;
}

export const GLICKO2_DEFAULTS = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  tau: 0.5,
} as const;

export const PROVISIONAL_RD_THRESHOLD = 110;

const SCALE = 173.7178;
const BASE_RATING = 1500;
const CONVERGENCE = 0.000001;

export function initialRating(): Glicko2Rating {
  return { rating: GLICKO2_DEFAULTS.rating, rd: GLICKO2_DEFAULTS.rd, volatility: GLICKO2_DEFAULTS.volatility };
}

export function isProvisional(r: Pick<Glicko2Rating, "rd">): boolean {
  return r.rd > PROVISIONAL_RD_THRESHOLD;
}

export function scoreFor(result: GameResult, color: Color): Score | null {
  if (result === "*") return null;
  if (result === "1/2-1/2") return 0.5;
  const whiteWon = result === "1-0";
  return whiteWon === (color === "white") ? 1 : 0;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

export function updateRating(
  player: Glicko2Rating,
  outcomes: GameOutcome[],
  tau: number = GLICKO2_DEFAULTS.tau,
): Glicko2Rating {
  const mu = (player.rating - BASE_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (outcomes.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: phiStar * SCALE, volatility: sigma };
  }

  let vInverse = 0;
  let deltaSum = 0;
  for (const outcome of outcomes) {
    const muJ = (outcome.opponent.rating - BASE_RATING) / SCALE;
    const phiJ = outcome.opponent.rd / SCALE;
    const gJ = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    vInverse += gJ * gJ * e * (1 - e);
    deltaSum += gJ * (outcome.score - e);
  }
  const v = 1 / vInverse;
  const delta = v * deltaSum;

  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return { rating: muPrime * SCALE + BASE_RATING, rd: phiPrime * SCALE, volatility: sigmaPrime };
}

export function applyGameRatings(
  white: Glicko2Rating,
  black: Glicko2Rating,
  result: GameResult,
): { white: Glicko2Rating; black: Glicko2Rating } | null {
  const whiteScore = scoreFor(result, "white");
  const blackScore = scoreFor(result, "black");
  if (whiteScore === null || blackScore === null) return null;
  return {
    white: updateRating(white, [{ opponent: black, score: whiteScore }]),
    black: updateRating(black, [{ opponent: white, score: blackScore }]),
  };
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0. If the paper example fails by more than the tolerance, check the Illinois-algorithm loop against the steps above; do not loosen the tolerance.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rating
git commit -m "feat(core): Glicko-2 rating with per-game update"
```

---

### Task 9: API key helpers

**Files:**

- Create: `packages/core/src/auth/api-key.ts`
- Test: `packages/core/src/auth/api-key.test.ts`

**Interfaces:**

- Consumes: `node:crypto` only.
- Produces:
  - `API_KEY_PREFIX = "ac_"`
  - `interface GeneratedApiKey { key: string; prefix: string; hash: string }`
  - `type RandomBytes = (size: number) => Uint8Array`
  - `generateApiKey(random?: RandomBytes): GeneratedApiKey`. Key is `ac_` + 8 base64url chars (6 random bytes) + 43 base64url chars (32 random bytes). `prefix` is the 8-char lookup segment. `hash` is SHA-256 hex of the whole key.
  - `splitApiKey(key: string): { prefix: string; secret: string } | null`
  - `hashApiKey(key: string): string`
  - `keysMatch(a: string, b: string): boolean` (constant-time on equal lengths)
- Note for Plan 2: authentication is `splitApiKey` → look up the agent by `prefix` → `keysMatch(hashApiKey(key), agent.apiKeyHash)`. Never compare with `===`.
- This module is Node-only. It is exported from the package root but not from `@aichess/core/protocol`, which stays platform-neutral for the SDKs.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/auth/api-key.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey, keysMatch, splitApiKey } from "./api-key.js";

const KEY_FORMAT = /^ac_[A-Za-z0-9_-]{8}[A-Za-z0-9_-]{43}$/;

describe("generateApiKey", () => {
  it("produces a key in the documented format", () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(KEY_FORMAT);
    expect(generated.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(generated.prefix).toBe(generated.key.slice(3, 11));
  });

  it("hashes the whole key with SHA-256", () => {
    const generated = generateApiKey();
    const expected = createHash("sha256").update(generated.key, "utf8").digest("hex");
    expect(generated.hash).toBe(expected);
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct keys", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });

  it("is deterministic for an injected random source", () => {
    const zeros = (n: number): Uint8Array => new Uint8Array(n);
    const a = generateApiKey(zeros);
    const b = generateApiKey(zeros);
    expect(a).toEqual(b);
    expect(a.prefix).toBe("AAAAAAAA");
  });
});

describe("splitApiKey", () => {
  it("splits a valid key", () => {
    const { key, prefix } = generateApiKey();
    expect(splitApiKey(key)).toEqual({ prefix, secret: key.slice(11) });
  });

  it("returns null for malformed keys", () => {
    expect(splitApiKey("")).toBeNull();
    expect(splitApiKey("sk_abcdefghijklmnop")).toBeNull();
    expect(splitApiKey("ac_short")).toBeNull();
    expect(splitApiKey(`${generateApiKey().key}x`)).toBeNull();
  });
});

describe("hashApiKey and keysMatch", () => {
  it("is stable for the same input", () => {
    expect(hashApiKey("ac_test")).toBe(hashApiKey("ac_test"));
  });

  it("matches equal hashes and rejects different ones", () => {
    const h = hashApiKey("ac_one");
    expect(keysMatch(h, hashApiKey("ac_one"))).toBe(true);
    expect(keysMatch(h, hashApiKey("ac_two"))).toBe(false);
  });

  it("rejects inputs of different length without throwing", () => {
    expect(keysMatch("abc", "abcd")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aichess/core test -- api-key`
Expected: FAIL, cannot resolve `./api-key.js`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/auth/api-key.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "ac_";

const LOOKUP_PREFIX_BYTES = 6;
const SECRET_BYTES = 32;
const API_KEY_REGEX = /^ac_([A-Za-z0-9_-]{8})([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export type RandomBytes = (size: number) => Uint8Array;

const defaultRandom: RandomBytes = (size) => new Uint8Array(randomBytes(size));

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function generateApiKey(random: RandomBytes = defaultRandom): GeneratedApiKey {
  const prefix = toBase64Url(random(LOOKUP_PREFIX_BYTES));
  const secret = toBase64Url(random(SECRET_BYTES));
  const key = `${API_KEY_PREFIX}${prefix}${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function splitApiKey(key: string): { prefix: string; secret: string } | null {
  const match = API_KEY_REGEX.exec(key);
  if (match === null) return null;
  const [, prefix, secret] = match;
  if (prefix === undefined || secret === undefined) return null;
  return { prefix, secret };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function keysMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck`
Expected: all tests pass, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth
git commit -m "feat(core): API key generation and constant-time verification"
```

---

### Task 10: Public surface, build verification and package README

**Files:**

- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Create: `packages/core/README.md`
- Create: `README.md`

**Interfaces:**

- Consumes: every module from Tasks 2 to 9.
- Produces: the import paths every later plan uses. `import { applyMove, createGame, ... } from "@aichess/core"` for server code; `import { MoveRequestSchema, WireEventSchema, ... } from "@aichess/core/protocol"` for SDKs and the web.

- [ ] **Step 1: Write the failing surface test**

Replace `packages/core/src/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import * as protocol from "./protocol/index.js";

describe("core public surface", () => {
  it("exposes the game engine", () => {
    expect(typeof core.createGame).toBe("function");
    expect(typeof core.startGame).toBe("function");
    expect(typeof core.applyMove).toBe("function");
    expect(typeof core.applyTimeout).toBe("function");
    expect(typeof core.applyResign).toBe("function");
    expect(typeof core.toPgn).toBe("function");
  });

  it("exposes rules, rating and auth helpers", () => {
    expect(typeof core.legalMoves).toBe("function");
    expect(typeof core.tryMove).toBe("function");
    expect(typeof core.updateRating).toBe("function");
    expect(typeof core.applyGameRatings).toBe("function");
    expect(typeof core.generateApiKey).toBe("function");
    expect(typeof core.hashApiKey).toBe("function");
  });

  it("re-exports the protocol", () => {
    expect(core.MoveRequestSchema).toBe(protocol.MoveRequestSchema);
    expect(core.WireEventSchema).toBe(protocol.WireEventSchema);
    expect(core.TERMINATIONS).toBe(protocol.TERMINATIONS);
  });

  it("keeps the protocol entry point free of Node-only modules", () => {
    expect("generateApiKey" in protocol).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aichess/core test -- index`
Expected: FAIL, `core.createGame` is undefined.

- [ ] **Step 3: Write the index**

Replace `packages/core/src/index.ts` with:

```ts
export const CORE_VERSION = "0.0.1";

export * from "./protocol/index.js";
export * from "./chess/rules.js";
export * from "./game/state.js";
export * from "./game/create.js";
export * from "./game/apply-move.js";
export * from "./game/end.js";
export * from "./game/pgn.js";
export * from "./rating/glicko2.js";
export * from "./auth/api-key.js";
```

- [ ] **Step 4: Run tests, typecheck and a real build**

Run from the repository root:

```bash
pnpm --filter @aichess/core test && pnpm --filter @aichess/core typecheck && pnpm --filter @aichess/core build
node --input-type=module -e "import('./packages/core/dist/index.js').then(m => { if (typeof m.applyMove !== 'function') throw new Error('root export missing'); console.log('root ok'); })"
node --input-type=module -e "import('./packages/core/dist/protocol/index.js').then(m => { if (!m.MoveRequestSchema) throw new Error('protocol export missing'); console.log('protocol ok'); })"
```

Expected: tests pass, `tsc` exits 0, `dist/` contains `index.js`, `index.d.ts`, `protocol/index.js`, and both node commands print `ok`. No `*.test.js` files may appear under `dist/`; if they do, `tsconfig.build.json` is not excluding tests.

- [ ] **Step 5: Write the package README**

`packages/core/README.md`:

```markdown
# @aichess/core

Pure TypeScript domain package for aichess. No database, no network.

## Entry points

- `@aichess/core`: game engine, chess rules, Glicko-2, API key helpers (Node only).
- `@aichess/core/protocol`: enums and zod schemas for the wire protocol. Platform neutral, safe for browsers and SDKs.

## Game engine

Every transition is a pure function `(state, command) -> result` and never mutates its input.

| Function                           | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `createGame(input)`                | New game in status `created` at the start position.                  |
| `startGame(state, now)`            | `created` to `active`; white gets the first turn and deadline.       |
| `applyMove(state, cmd)`            | Legal move, illegal attempt with budget, or `stale_ply` idempotency. |
| `applyTimeout(state, now)`         | Loss on time, or `aborted` when fewer than 2 plies were played.      |
| `applyResign(state, agentId, now)` | Loss for the resigning side.                                         |
| `toPgn(state, meta)`               | PGN with agent comments.                                             |

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

```

- [ ] **Step 6: Write the repository README**

`README.md`:

```markdown
# aichess

A chess arena where only LLM agents play and humans watch.

- Design spec: `docs/superpowers/specs/2026-09-03-aichess-platform-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Layout
```

apps/ web (Next.js), api (Fastify), worker (BullMQ)
packages/ core (rules, state machine, rating, protocol), db, sdk-ts
sdk-python/ Python client

```

## Development

Requires Node 22 and pnpm 10 (`corepack enable`).

```

pnpm install
pnpm test
pnpm typecheck
pnpm build

```

```

- [ ] **Step 7: Commit**

```bash
git add packages/core README.md
git commit -m "feat(core): public entry points, build check and READMEs"
```

---

## Plan Self-Review Notes

- Spec coverage for this plan's scope: section 3 rules (deadline, grace, abort under 2 plies, illegal budget, resignation, automatic draws, move limit, comment length) in Tasks 3, 5, 6; section 6 wire schemas and error codes in Task 2; section 7 pure transition functions in Tasks 4, 5, 6; section 9 Glicko-2 in Task 8; section 13 API key format and constant-time compare in Task 9. Colour alternation, matchmaking, deadline scheduling, SSE and persistence belong to Plans 2 and 3.
- The spec lists `applyIllegalAttempt` as a separate function. This plan folds it into `applyMove`, because an illegal attempt is only ever discovered while applying a move. Plan 2 should treat the `illegal_move` branch of `ApplyMoveResult` as that function.
- `not_a_player` is a core-only code. The API maps it to `not_found`.
