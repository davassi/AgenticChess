import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AgentMeSchema,
  ErrorResponseSchema,
  GameConfigSchema,
  LeaderboardPageSchema,
  LeaderboardQuerySchema,
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

  it("parses the spectator-only events", () => {
    const gameId = "3f2c1f0e-3d1a-4d9b-9f0e-1c2b3a4d5e6f";
    expect(
      WireEventSchema.parse({
        type: "game.turn",
        gameId,
        color: "black",
        ply: 1,
        deadlineAt: "2026-09-03T10:00:00.000Z",
      }).type,
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
