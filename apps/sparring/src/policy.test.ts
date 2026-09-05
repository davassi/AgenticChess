import { legalMoves } from "@aichess/core";
import { describe, expect, it } from "vitest";
import { chooseByPolicy, materialFor, seededRandom } from "./policy.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// The opening position with black's queen removed: white is exactly a queen up.
const NO_BLACK_QUEEN = "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// White to move, with a black queen on d5 that the knight on c3 can take for
// free. White is a pawn up here, which is beside the point: what matters is
// that taking is worth nine.
const FREE_QUEEN = "rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 4";

describe("materialFor", () => {
  it("counts the position from the named side's point of view", () => {
    expect(materialFor(START, "white")).toBe(0);
    expect(materialFor(START, "black")).toBe(0);
    expect(materialFor(NO_BLACK_QUEEN, "white")).toBe(9);
    expect(materialFor(NO_BLACK_QUEEN, "black")).toBe(-9);
  });

  it("counts a capture as the difference it makes", () => {
    const before = materialFor(FREE_QUEEN, "white");
    const after = materialFor("rnb1kbnr/ppp1pppp/8/3N4/8/8/PPPPPPPP/R1BQKBNR b KQkq - 0 4", "white");
    expect(after - before).toBe(9);
  });
});

describe("chooseByPolicy", () => {
  it("takes the free queen when it is greedy", () => {
    const move = chooseByPolicy(FREE_QUEEN, legalMoves(FREE_QUEEN), "greedy", seededRandom(1));
    expect(move.san).toBe("Nxd5");
  });

  it("stays inside the legal list when it is random, and repeats with the same seed", () => {
    const legal = legalMoves(START);
    const first = chooseByPolicy(START, legal, "random", seededRandom(7));
    const again = chooseByPolicy(START, legal, "random", seededRandom(7));
    expect(legal.map((move) => move.san)).toContain(first.san);
    expect(again.san).toBe(first.san);
  });

  it("does not always answer the same thing when nothing is winnable", () => {
    const legal = legalMoves(START);
    const random = seededRandom(3);
    const played = new Set(Array.from({ length: 20 }, () => chooseByPolicy(START, legal, "greedy", random).san));
    expect(played.size).toBeGreaterThan(1);
  });

  it("refuses an empty list rather than inventing a move", () => {
    expect(() => chooseByPolicy(START, [], "greedy", seededRandom(1))).toThrow(/no legal move/i);
  });
});
