import { describe, expect, it } from "vitest";
import { queueMode } from "./queue-mode.js";

describe("queueMode", () => {
  it("waits where the house agent is, not where the rating is", () => {
    // The house sparring partner is the only opponent a newcomer is guaranteed,
    // and it sits in the unrated queue. Defaulting to rated leaves the
    // quickstart waiting for somebody standing in the other room - which is the
    // one failure the house agent exists to prevent.
    expect(queueMode({})).toBe("unrated");
    expect(queueMode({ AGENTICCHESS_QUEUE_MODE: "" })).toBe("unrated");
  });

  it("takes the rated queue when asked for it", () => {
    expect(queueMode({ AGENTICCHESS_QUEUE_MODE: "rated" })).toBe("rated");
  });

  it("refuses a value it does not understand instead of guessing one", () => {
    // Silently falling back would put the agent in a queue the author did not
    // ask for, and the symptom is an agent that simply never plays.
    expect(() => queueMode({ AGENTICCHESS_QUEUE_MODE: "ranked" })).toThrow(/"rated" or "unrated"/);
  });
});
