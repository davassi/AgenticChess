import { describe, expect, it } from "vitest";
import { buildRatingCurve } from "./curve";

const history = [
  { rating: 1560, rd: 290 },
  { rating: 1540, rd: 260 },
  { rating: 1580, rd: 100 },
];

describe("buildRatingCurve", () => {
  it("draws a polyline from left to right, starting at the Glicko-2 default", () => {
    const curve = buildRatingCurve(history);
    if (curve === null) throw new Error("expected a curve");
    const xs = [...curve.line.matchAll(/[ML](-?\d+(?:\.\d+)?),/g)].map((match) => Number(match[1]));
    expect(xs).toHaveLength(4);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(curve.last.rating).toBe(1580);
    expect(curve.last.x).toBe(curve.width - 16);
  });

  it("closes the deviation band on itself", () => {
    const curve = buildRatingCurve(history);
    expect(curve?.band.endsWith("Z")).toBe(true);
    expect(curve?.band).not.toContain("NaN");
  });

  it("marks where the agent stopped being provisional", () => {
    const curve = buildRatingCurve(history);
    expect(curve?.ratedX).not.toBeNull();
    expect(buildRatingCurve([{ rating: 1560, rd: 290 }])?.ratedX).toBeNull();
  });

  it("keeps a flat history visible instead of dividing by zero", () => {
    const curve = buildRatingCurve([
      { rating: 1500, rd: 0 },
      { rating: 1500, rd: 0 },
    ]);
    if (curve === null) throw new Error("expected a curve");
    expect(curve.line).not.toContain("NaN");
    expect(curve.band).not.toContain("NaN");
  });

  it("returns null when the agent has not been rated yet", () => {
    expect(buildRatingCurve([])).toBeNull();
  });

  it("keeps the 1500 line when the range is wide enough to step over it", () => {
    // Beyond 400 points the ticks go every hundred, and starting them at an
    // odd fifty walked straight past the one value the chart emphasises.
    const wide = [
      { gameId: "g1", rating: 1490, rd: 40, at: "2026-09-01T10:00:00.000Z" },
      { gameId: "g2", rating: 1960, rd: 40, at: "2026-09-02T10:00:00.000Z" },
    ];
    const curve = buildRatingCurve(wide);
    expect(curve?.gridLines.some((line) => line.value === 1500 && line.emphasis)).toBe(true);
  });

  it("puts a grid line on 1500 and labels it", () => {
    const curve = buildRatingCurve(history);
    expect(curve?.gridLines.some((line) => line.value === 1500 && line.emphasis)).toBe(true);
  });
});
