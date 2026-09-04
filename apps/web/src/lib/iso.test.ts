import { describe, expect, it } from "vitest";
import { START_POSITION, TILE_H, TILE_W, project, squareToCell } from "./iso";

describe("isometric geometry", () => {
  it("maps squares to board cells with a8 at the far corner", () => {
    expect(squareToCell("a8")).toEqual({ col: 0, row: 0 });
    expect(squareToCell("h1")).toEqual({ col: 7, row: 7 });
    expect(squareToCell("e4")).toEqual({ col: 4, row: 4 });
  });

  it("projects a cell so columns go right and rows go left, both downwards", () => {
    const origin = { x: 100, y: 20 };
    const a = project(origin, 0, 0);
    const right = project(origin, 1, 0);
    const left = project(origin, 0, 1);
    expect(a).toEqual(origin);
    expect(right).toEqual({ x: origin.x + TILE_W / 2, y: origin.y + TILE_H / 2 });
    expect(left).toEqual({ x: origin.x - TILE_W / 2, y: origin.y + TILE_H / 2 });
  });

  it("starts from a full board of thirty-two pieces", () => {
    expect(Object.keys(START_POSITION)).toHaveLength(32);
    expect(START_POSITION.e1).toBe("w-king");
    expect(START_POSITION.e8).toBe("b-king");
  });
});
