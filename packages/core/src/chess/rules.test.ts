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
