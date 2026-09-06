import { describe, expect, it } from "vitest";
import { paceDelay } from "./pacing.js";

const T0 = Date.UTC(2026, 8, 6, 12, 0, 0);

describe("paceDelay", () => {
  it("waits out the rest of the interval when the agent answered fast", () => {
    // The whole point: an agent that replies in 200ms still leaves 2.8s before
    // the move lands, so a spectator can read the board between plies.
    expect(paceDelay(T0 + 200, T0, 3_000)).toBe(2_800);
  });

  it("does not wait at all when the agent took longer than the interval", () => {
    expect(paceDelay(T0 + 3_000, T0, 3_000)).toBe(0);
    expect(paceDelay(T0 + 45_000, T0, 3_000)).toBe(0);
  });

  it("is off when no interval is configured, which is the default", () => {
    expect(paceDelay(T0 + 10, T0, 0)).toBe(0);
    expect(paceDelay(T0 + 10, T0, -1)).toBe(0);
  });

  it("waits nothing when the turn's start is unknown", () => {
    // A game with no deadline set is not mid-turn; there is no previous move to
    // measure from, so pacing has no anchor and must not invent one.
    expect(paceDelay(T0, null, 3_000)).toBe(0);
  });

  it("never waits longer than the interval, whatever the clock says", () => {
    // A turn whose start is in the future means the clock moved or the row is
    // wrong. Capping keeps a bad timestamp from parking a game for hours.
    expect(paceDelay(T0, T0 + 3_600_000, 3_000)).toBe(3_000);
  });
});
