import type { Turn } from "@agenticchess/sdk";
import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";

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
    expect(prompt).toContain("Recent moves: none");
    expect(prompt).toContain(turn([]).fen);
  });

  it("keeps the history short, because the position is already in the FEN", () => {
    const long = Array.from({ length: 40 }, (_unused, index) => `m${String(index)}`);
    const prompt = buildPrompt(turn(long));
    expect(prompt).not.toContain("m0 ");
    expect(prompt).toContain("m39");
  });
});
