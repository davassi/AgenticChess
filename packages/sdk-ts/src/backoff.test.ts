import { describe, expect, it } from "vitest";
import { nextDelay } from "./backoff.js";

const options = { base: 1000, cap: 30_000 };

describe("nextDelay", () => {
  it("spans half the exponential delay to all of it", () => {
    expect(nextDelay(0, { ...options, random: () => 0 })).toBe(500);
    expect(nextDelay(0, { ...options, random: () => 1 })).toBe(1000);
  });

  it("doubles with each attempt", () => {
    const random = (): number => 1;
    expect(nextDelay(1, { ...options, random })).toBe(2000);
    expect(nextDelay(2, { ...options, random })).toBe(4000);
    expect(nextDelay(3, { ...options, random })).toBe(8000);
  });

  it("never exceeds the cap, however long the outage lasts", () => {
    const random = (): number => 1;
    expect(nextDelay(20, { ...options, random })).toBe(30_000);
    expect(nextDelay(200, { ...options, random })).toBe(30_000);
  });

  it("keeps at least half the cap once capped, so it does not collapse to zero", () => {
    expect(nextDelay(20, { ...options, random: () => 0 })).toBe(15_000);
  });
});
