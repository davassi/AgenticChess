import type { LegalMove } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { readMoveFromAnswer } from "./read-move.js";

const legal: LegalMove[] = [
  { san: "Nf3", uci: "g1f3" },
  { san: "Nc3", uci: "b1c3" },
];

describe("readMoveFromAnswer", () => {
  it("takes an exact answer as it stands, in either notation", () => {
    expect(readMoveFromAnswer("Nc3", legal)?.san).toBe("Nc3");
    expect(readMoveFromAnswer("b1c3", legal)?.san).toBe("Nc3");
  });

  it("reads a move out of a sentence, because models explain themselves", () => {
    expect(readMoveFromAnswer("I will play Nf3, developing toward the centre.", legal)?.san).toBe("Nf3");
  });

  it("prefers O-O-O over O-O when the model names queenside castling and O-O is listed first", () => {
    const castling: LegalMove[] = [
      { san: "O-O", uci: "e1g1" },
      { san: "O-O-O", uci: "e1c1" },
    ];
    expect(readMoveFromAnswer("I'll play O-O-O, castling queenside for safety.", castling)?.san).toBe("O-O-O");
  });

  it("prefers Nxd5 over d5 when the model names the capture and d5 is listed first", () => {
    const pawns: LegalMove[] = [
      { san: "d5", uci: "d7d5" },
      { san: "Nxd5", uci: "f6d5" },
    ];
    expect(readMoveFromAnswer("Nxd5 wins a pawn", pawns)?.san).toBe("Nxd5");
  });

  it("reads the move the model committed to, not a longer UCI substring of the move it rejected", () => {
    // "g1f3" (Nf3's UCI) is 4 characters and appears in the sentence; "Nc3"
    // (the SAN the model actually played) is only 3. A cross-notation length
    // comparison would score the rejected move higher and read it instead.
    expect(readMoveFromAnswer("I decided against g1f3 and played Nc3.", legal)?.san).toBe("Nc3");
  });

  it("resolves an equal-length same-notation tie to whichever the arena listed first", () => {
    // Both are SAN and both are mentioned, so this is the genuine ambiguity the
    // doc comment describes rather than the cross-notation bug above.
    expect(readMoveFromAnswer("I considered Nf3 but played Nc3.", legal)?.san).toBe("Nf3");
  });

  it("returns null when the answer names no legal move", () => {
    expect(readMoveFromAnswer("Qh9 is winning", legal)).toBeNull();
    expect(readMoveFromAnswer("   ", legal)).toBeNull();
    expect(readMoveFromAnswer("Nf3", [])).toBeNull();
  });
});
