import { describe, expect, it } from "vitest";
import { PALETTES, PIECES, avatarMask, paletteFor, rowRuns, shade, spriteMask } from "./pixel";

const palette = PALETTES.gold;

describe("pixel renderer", () => {
  it("wraps a mask in a one-pixel outline", () => {
    const shaded = shade(["#"], palette);
    expect(shaded).toMatchObject({ width: 3, height: 3 });
    expect(shaded.grid[1]?.[1]).toBe(palette.light);
    expect(shaded.grid[0]?.[1]).toBe(palette.outline);
    expect(shaded.grid[0]?.[0]).toBeNull();
  });

  it("lights the top-left edges and shades the bottom-right ones", () => {
    const shaded = shade(["###", "###", "###"], palette);
    expect(shaded.grid[1]?.[1]).toBe(palette.light);
    expect(shaded.grid[3]?.[3]).toBe(palette.shadow);
    expect(shaded.grid[2]?.[2]).toBe(palette.base);
  });

  it("merges neighbouring pixels of one colour into a single run", () => {
    const runs = rowRuns(shade(["###"], palette));
    expect(runs[0]).toEqual([{ x: 1, width: 3, color: palette.outline }]);
  });

  it("pads a ragged mask instead of shifting the artwork", () => {
    const shaded = shade(["##", "#"], palette);
    expect(shaded.width).toBe(4);
    expect(shaded.grid[2]?.[2]).toBe(palette.outline);
  });

  it("resolves icons, pieces and avatars by name, and nothing else", () => {
    expect(spriteMask("knight")).toBe(PIECES.knight);
    expect(avatarMask("knight")).toBe(PIECES.knight);
    expect(spriteMask("moon")).not.toBeNull();
    expect(avatarMask("moon")).toBeNull();
    expect(spriteMask("not-a-sprite")).toBeNull();
  });

  it("resolves palettes by name", () => {
    expect(paletteFor("gold")).toBe(PALETTES.gold);
    expect(paletteFor("chartreuse")).toBeNull();
  });
});
