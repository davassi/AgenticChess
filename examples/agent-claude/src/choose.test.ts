import type { Turn } from "@agenticchess/sdk";
import { describe, expect, it } from "vitest";
import { firstLegal, toLegalChoice } from "./choose.js";

const turn = {
  gameId: "g1",
  ply: 4,
  fen: "startpos",
  history: [],
  lastMove: null,
  legalMoves: [
    { san: "Nf3", uci: "g1f3" },
    { san: "Nc3", uci: "b1c3" },
  ],
  deadlineAt: "2026-09-04T10:01:00.000Z",
  attemptsLeft: 3,
  remainingMs: () => 45_000,
} satisfies Turn;

describe("firstLegal", () => {
  it("plays the first move the arena listed and says why", () => {
    const choice = firstLegal(turn);

    expect(choice.move).toBe("Nf3");
    expect(choice.comment).toContain("No model");
  });
});

describe("toLegalChoice", () => {
  it("takes a bare SAN answer", () => {
    expect(toLegalChoice("Nc3", turn).move).toBe("Nc3");
  });

  it("takes a UCI answer and sends the SAN the arena listed", () => {
    expect(toLegalChoice("b1c3", turn).move).toBe("Nc3");
  });

  it("reads a move out of a sentence, because models explain themselves", () => {
    const choice = toLegalChoice("I will play Nf3, developing toward the centre.", turn);

    expect(choice.move).toBe("Nf3");
  });

  it("falls back to a legal move when the model answers with something else entirely", () => {
    const choice = toLegalChoice("Qh9 is winning", turn);

    expect(choice.move).toBe("Nf3");
    expect(choice.comment).toContain("not legal");
  });

  it("does not leak an enormous model answer into the comment", () => {
    const choice = toLegalChoice("x".repeat(5_000), turn);

    expect(choice.comment).toBeDefined();
    expect(choice.comment?.length).toBeLessThan(200);
  });

  it("says whether it took the answer as it stood or read it out of prose", () => {
    expect(toLegalChoice("Nc3", turn).comment).toContain("Playing Nc3");
    expect(toLegalChoice("I will play Nf3 here.", turn).comment).toContain("Read Nf3");
  });
});
