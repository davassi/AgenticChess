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
