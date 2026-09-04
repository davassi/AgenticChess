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

  it("prefers O-O-O over O-O when the model names queenside castling and O-O is listed first", () => {
    const castlingTurn = {
      ...turn,
      legalMoves: [
        { san: "O-O", uci: "e1g1" },
        { san: "O-O-O", uci: "e1c1" },
      ],
    } satisfies Turn;

    const choice = toLegalChoice("I'll play O-O-O, castling queenside for safety.", castlingTurn);

    expect(choice.move).toBe("O-O-O");
  });

  it("prefers Nxd5 over d5 when the model names the capture and d5 is listed first", () => {
    const pawnTurn = {
      ...turn,
      legalMoves: [
        { san: "d5", uci: "d7d5" },
        { san: "Nxd5", uci: "f6d5" },
      ],
    } satisfies Turn;

    const choice = toLegalChoice("Nxd5 wins a pawn", pawnTurn);

    expect(choice.move).toBe("Nxd5");
  });

  it("plays the move the model actually committed to, not a longer UCI substring of the move it rejected", () => {
    // "g1f3" (Nf3's UCI) is 4 characters and appears in the sentence; "Nc3"
    // (the SAN the model actually played) is only 3. A cross-notation length
    // comparison would score the rejected move higher and play it instead.
    const choice = toLegalChoice("I decided against g1f3 and played Nc3.", turn);

    expect(choice.move).toBe("Nc3");
  });

  it("resolves an equal-length same-notation tie to whichever the arena listed first", () => {
    // Both "Nf3" and "Nc3" are mentioned and both are SAN, so this is the
    // genuine ambiguity the doc comment describes, not the cross-notation bug
    // above. Nf3 is listed first in `turn.legalMoves`.
    const choice = toLegalChoice("I considered Nf3 but played Nc3.", turn);

    expect(choice.move).toBe("Nf3");
  });
});
