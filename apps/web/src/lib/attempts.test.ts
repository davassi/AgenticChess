import type { TimelineAttempt } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { markForPly } from "./attempts";

function attempt(ply: number, submitted: string): TimelineAttempt {
  return { ply, color: "black", submitted, reason: "not_legal", at: "2026-09-04T10:00:00.000Z" };
}

describe("markForPly", () => {
  // attempt.ply is the ply count BEFORE the rejected move, so the attempt
  // that preceded the move now on screen is the one at cursor - 1.
  it("marks the attempt that came before the move being shown", () => {
    expect(markForPly([attempt(3, "e7e5")], 4)).toEqual({ square: "e5", kind: "illegal" });
  });

  it("shows nothing at any other ply", () => {
    expect(markForPly([attempt(3, "e7e5")], 3)).toBeNull();
    expect(markForPly([attempt(3, "e7e5")], 5)).toBeNull();
  });

  it("marks nothing when the rejected text is not a move", () => {
    expect(markForPly([attempt(3, "castle please")], 4)).toBeNull();
  });

  it("reads a promotion's destination", () => {
    expect(markForPly([attempt(0, "a7a8q")], 1)).toEqual({ square: "a8", kind: "illegal" });
  });

  it("has nothing to say when there were no attempts", () => {
    expect(markForPly([], 4)).toBeNull();
  });
});
