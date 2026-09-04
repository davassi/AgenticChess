import { describe, expect, it } from "vitest";
import { toTurn } from "./turn.js";

const event = {
  type: "game.your_turn",
  gameId: "11111111-1111-4111-8111-111111111111",
  ply: 4,
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  history: ["e4", "c5"],
  lastMove: { san: "c5", uci: "c7c5" },
  legalMoves: [{ san: "Nf3", uci: "g1f3" }],
  deadlineAt: "2026-09-04T10:01:00.000Z",
  attemptsLeft: 3,
} as const;

describe("toTurn", () => {
  it("reports the milliseconds left before the arena calls it a timeout", () => {
    const turn = toTurn(event, () => Date.parse("2026-09-04T10:00:15.000Z"));

    expect(turn.remainingMs()).toBe(45_000);
  });

  it("never reports a negative budget, so a late callback reads zero", () => {
    const turn = toTurn(event, () => Date.parse("2026-09-04T10:05:00.000Z"));

    expect(turn.remainingMs()).toBe(0);
  });

  it("carries the fields an agent needs to choose", () => {
    const turn = toTurn(event, () => 0);

    expect(turn.ply).toBe(4);
    expect(turn.legalMoves[0]?.san).toBe("Nf3");
    expect(turn.attemptsLeft).toBe(3);
    expect(turn.history).toEqual(["e4", "c5"]);
  });
});
