import { describe, expect, it } from "vitest";
import { GLICKO2_DEFAULTS, applyGameRatings, initialRating, isProvisional, scoreFor, updateRating } from "./glicko2.js";

describe("updateRating", () => {
  it("reproduces the worked example from Glickman's paper", () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const next = updateRating(
      player,
      [
        { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it("only inflates RD when no games were played", () => {
    const player = { rating: 1500, rd: 50, volatility: 0.06 };
    const next = updateRating(player, []);
    expect(next.rating).toBe(1500);
    expect(next.volatility).toBe(0.06);
    expect(next.rd).toBeGreaterThan(50);
  });

  it("raises the rating after a win and lowers it after a loss against an equal", () => {
    const a = initialRating();
    const b = initialRating();
    const win = updateRating(a, [{ opponent: b, score: 1 }]);
    const loss = updateRating(a, [{ opponent: b, score: 0 }]);
    expect(win.rating).toBeGreaterThan(1500);
    expect(loss.rating).toBeLessThan(1500);
    expect(win.rd).toBeLessThan(350);
  });

  it("does not mutate its inputs", () => {
    const a = { rating: 1500, rd: 350, volatility: 0.06 };
    updateRating(a, [{ opponent: { ...a }, score: 0.5 }]);
    expect(a).toEqual({ rating: 1500, rd: 350, volatility: 0.06 });
  });
});

describe("applyGameRatings", () => {
  it("updates both sides from the pre-game values", () => {
    const white = { rating: 1600, rd: 80, volatility: 0.06 };
    const black = { rating: 1500, rd: 120, volatility: 0.06 };
    const out = applyGameRatings(white, black, "0-1");
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.white.rating).toBeLessThan(1600);
    expect(out.black.rating).toBeGreaterThan(1500);
    expect(out.white).toEqual(updateRating(white, [{ opponent: black, score: 0 }]));
    expect(out.black).toEqual(updateRating(black, [{ opponent: white, score: 1 }]));
  });

  it("returns null for an aborted game", () => {
    expect(applyGameRatings(initialRating(), initialRating(), "*")).toBeNull();
  });
});

describe("scoreFor", () => {
  it("maps results to scores per colour", () => {
    expect(scoreFor("1-0", "white")).toBe(1);
    expect(scoreFor("1-0", "black")).toBe(0);
    expect(scoreFor("0-1", "white")).toBe(0);
    expect(scoreFor("0-1", "black")).toBe(1);
    expect(scoreFor("1/2-1/2", "white")).toBe(0.5);
    expect(scoreFor("*", "white")).toBeNull();
  });
});

describe("initialRating and isProvisional", () => {
  it("starts at the spec defaults and is provisional", () => {
    const r = initialRating();
    expect(r).toEqual({
      rating: GLICKO2_DEFAULTS.rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
    });
    expect(isProvisional(r)).toBe(true);
  });

  it("stops being provisional at RD 110", () => {
    expect(isProvisional({ rd: 110.01 })).toBe(true);
    expect(isProvisional({ rd: 110 })).toBe(false);
  });
});
