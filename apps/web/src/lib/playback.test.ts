import { describe, expect, it } from "vitest";
import { LAG_VISIBLE, MAX_LAG, liveInterval, nextPly, parseSpeed, reviewInterval, SPEEDS } from "./playback";

describe("live pacing", () => {
  it("slows to a readable pace when the cursor is at the live edge", () => {
    expect(liveInterval(0, 1)).toBe(2500);
    expect(liveInterval(1, 1)).toBe(2500);
  });

  it("shortens the delay the further behind the cursor falls", () => {
    expect(liveInterval(2, 1)).toBe(1667);
    expect(liveInterval(3, 1)).toBe(1250);
    expect(liveInterval(4, 1)).toBe(1000);
    expect(liveInterval(5, 1)).toBe(833);
    expect(liveInterval(9, 1)).toBe(500);
  });

  it("never goes below the floor, however far behind it is", () => {
    expect(liveInterval(12, 1)).toBe(400);
    expect(liveInterval(200, 1)).toBe(400);
  });

  // The property the design rests on: with moves arriving every 1500 ms the
  // cursor stops falling behind between two and three plies back, so catching
  // up needs no threshold rule.
  it("has a fixed point near two plies at the agents' real move rate", () => {
    expect(liveInterval(2, 1)).toBeGreaterThan(1500);
    expect(liveInterval(3, 1)).toBeLessThan(1500);
  });

  it("scales with the chosen speed", () => {
    expect(liveInterval(2, 2)).toBe(833);
    expect(liveInterval(2, 0.5)).toBe(3333);
  });

  it("has no delay at all when the viewer asked for instant", () => {
    expect(liveInterval(5, "instant")).toBe(0);
  });
});

describe("review pacing", () => {
  it("steps a replay at one second, scaled by speed", () => {
    expect(reviewInterval(1)).toBe(1000);
    expect(reviewInterval(2)).toBe(500);
    expect(reviewInterval(0.5)).toBe(2000);
  });

  // Pressing play must produce a replay, not a jump to the end.
  it("keeps a replay watchable even at instant", () => {
    expect(reviewInterval("instant")).toBe(400);
  });
});

describe("where the cursor goes next", () => {
  it("walks one ply at a time", () => {
    expect(nextPly(0, 10, true, 1)).toBe(1);
    expect(nextPly(4, 10, false, 1)).toBe(5);
  });

  it("stops at the end of the list", () => {
    expect(nextPly(10, 10, true, 1)).toBe(10);
    expect(nextPly(11, 10, false, 1)).toBe(10);
  });

  // The backgrounded tab: the browser throttled the timers and the viewer is
  // back to arrears they never chose to watch.
  it("jumps instead of fast-forwarding past the arrears limit", () => {
    expect(nextPly(0, MAX_LAG + 1, true, 1)).toBe(MAX_LAG + 1);
    expect(nextPly(0, MAX_LAG, true, 1)).toBe(1);
  });

  it("never jumps a replay the viewer started, however long the game", () => {
    expect(nextPly(0, 300, false, 1)).toBe(1);
  });

  it("goes straight to the live edge at instant", () => {
    expect(nextPly(0, 30, true, "instant")).toBe(30);
  });
});

describe("speed parsing", () => {
  it("round-trips every offered speed through its option value", () => {
    for (const speed of SPEEDS) expect(parseSpeed(String(speed))).toBe(speed);
  });

  it("falls back to normal speed on anything else", () => {
    expect(parseSpeed("7")).toBe(1);
    expect(parseSpeed("")).toBe(1);
  });
});

describe("constants", () => {
  it("hides the lag indicator until it is worth reading", () => {
    expect(LAG_VISIBLE).toBeGreaterThanOrEqual(2);
  });
});
