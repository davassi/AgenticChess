import { describe, expect, it } from "vitest";
import { applyUci, positionFromFen, positionsFrom, squareOffsets, startingPosition } from "./position";

describe("position model", () => {
  it("starts from thirty-two pieces, each identified by its home square", () => {
    const start = startingPosition();
    expect(start.size).toBe(32);
    expect(start.get("e1")).toEqual({ id: "e1", kind: "w-king", square: "e1" });
    expect(start.get("d8")?.kind).toBe("b-queen");
  });

  it("reads a board out of a FEN and ignores the rest of it", () => {
    const fromFen = positionFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(fromFen.size).toBe(32);
    expect(fromFen.get("a1")?.kind).toBe("w-rook");
    expect(fromFen.get("h8")?.kind).toBe("b-rook");
    expect(positionFromFen("8/8/8/8/8/8/8/8 w - - 0 1").size).toBe(0);
  });

  it("keeps a piece's identity when it moves, so the board can animate it", () => {
    const after = applyUci(startingPosition(), "e2e4");
    expect(after.get("e2")).toBeUndefined();
    expect(after.get("e4")).toEqual({ id: "e2", kind: "w-pawn", square: "e4" });
    expect(after.size).toBe(32);
  });

  it("removes a captured piece", () => {
    const position = positionsFrom(["e2e4", "d7d5", "e4d5"]).at(-1);
    expect(position?.size).toBe(31);
    expect(position?.get("d5")?.id).toBe("e2");
  });

  it("moves the rook when the king castles, on both sides", () => {
    const short = positionsFrom(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"]).at(-1);
    expect(short?.get("g1")?.kind).toBe("w-king");
    expect(short?.get("f1")).toEqual({ id: "h1", kind: "w-rook", square: "f1" });
    expect(short?.get("h1")).toBeUndefined();

    const long = positionsFrom(["d2d4", "d7d5", "b1c3", "b8c6", "c1f4", "c8f5", "d1d2", "d8d7", "e1c1"]).at(-1);
    expect(long?.get("c1")?.kind).toBe("w-king");
    expect(long?.get("d1")).toEqual({ id: "a1", kind: "w-rook", square: "d1" });
  });

  it("takes the passed pawn on an en passant capture", () => {
    const position = positionsFrom(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]).at(-1);
    expect(position?.get("d6")?.kind).toBe("w-pawn");
    expect(position?.get("d5")).toBeUndefined();
    expect(position?.size).toBe(31);
  });

  it("promotes a pawn without losing its identity", () => {
    const position = applyUci(positionFromFen("8/4P3/8/8/8/8/8/8 w - - 0 1"), "e7e8q");
    expect(position.get("e8")).toEqual({ id: "e7", kind: "w-queen", square: "e8" });
  });

  it("ignores a move from an empty square instead of inventing a piece", () => {
    const start = startingPosition();
    expect(applyUci(start, "e4e5")).toBe(start);
  });

  it("returns one position per ply, starting from the initial board", () => {
    const positions = positionsFrom(["e2e4", "e7e5"]);
    expect(positions).toHaveLength(3);
    expect(positions[0]?.get("e2")?.kind).toBe("w-pawn");
    expect(positions[2]?.get("e5")?.kind).toBe("b-pawn");
  });

  it("places a8 at the top left and h1 at the bottom right", () => {
    expect(squareOffsets("a8")).toEqual({ x: 0, y: 0 });
    expect(squareOffsets("h1")).toEqual({ x: 7, y: 7 });
    expect(squareOffsets("e4")).toEqual({ x: 4, y: 4 });
  });
});

describe("identity across a redraw from FEN", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

  it("keeps every untouched piece's identity", () => {
    const before = positionFromFen(START);
    const after = positionFromFen(AFTER_E4, before);
    expect(after.get("a1")?.id).toBe("a1");
    expect(after.get("e8")?.id).toBe("e8");
  });

  it("hands a vacated square's identity to the piece that arrived", () => {
    const before = positionFromFen(START);
    const after = positionFromFen(AFTER_E4, before);
    expect(after.get("e4")).toEqual({ id: "e2", kind: "w-pawn", square: "e4" });
    expect(after.get("e2")).toBeUndefined();
  });

  it("keeps the mover's identity through a capture", () => {
    const before = positionFromFen("8/8/8/3p4/4P3/8/8/8 w - - 0 1");
    const after = positionFromFen("8/8/8/3P4/8/8/8/8 b - - 0 1", before);
    expect(after.get("d5")).toEqual({ id: "e4", kind: "w-pawn", square: "d5" });
    expect(after.size).toBe(1);
  });

  it("moves the rook with the king through a castle", () => {
    const before = positionFromFen("8/8/8/8/8/8/8/R3K3 w Q - 0 1");
    const after = positionFromFen("8/8/8/8/8/8/8/2KR4 b - - 0 1", before);
    expect(after.get("c1")?.id).toBe("e1");
    expect(after.get("d1")?.id).toBe("a1");
  });

  // Two pieces of one kind, one of them gone: nothing in a FEN says which.
  // The result must still be all-distinct keys, or React renders duplicates.
  it("never hands out the same identity twice, however ambiguous the diff", () => {
    const before = positionFromFen("8/8/8/8/1N3N2/8/8/8 w - - 0 1");
    const after = positionFromFen("8/8/8/8/8/2N5/8/8 b - - 0 1", before);
    const ids = [...after.values()].map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unchanged when no previous position is given", () => {
    const fresh = positionFromFen(AFTER_E4);
    expect(fresh.get("e4")).toEqual({ id: "e4", kind: "w-pawn", square: "e4" });
  });
});
