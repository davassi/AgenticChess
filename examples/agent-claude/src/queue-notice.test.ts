import { ArenaError } from "@agenticchess/sdk";
import { describe, expect, it } from "vitest";
import { isInActiveGame, queueNotice } from "./queue-notice.js";

const standing = { queuedAt: "2026-09-06T10:00:00.000Z", mode: "unrated" as const, opponents: 0 };

describe("queueNotice", () => {
  it("speaks up when no agent in the queue can be this one's opponent", () => {
    const notice = queueNotice({ type: "queue.joined", ...standing });
    expect(notice).toContain("unrated");
    expect(notice).toMatch(/no( |-)?/i);
  });

  it("says nothing when somebody there can be faced", () => {
    expect(queueNotice({ type: "queue.joined", ...standing, opponents: 1 })).toBeNull();
  });

  it("reads the same standing out of hello, which is what a reconnect gets", () => {
    // A restart never sees queue.joined again: it rejoins an existing
    // membership and learns where it stands from hello alone.
    const agentId = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
    expect(queueNotice({ type: "hello", agentId, activeGame: null, queue: standing })).not.toBeNull();
    expect(queueNotice({ type: "hello", agentId, activeGame: null, queue: null })).toBeNull();
  });

  it("has nothing to say about an event that is not about the queue", () => {
    expect(queueNotice({ type: "ping", at: standing.queuedAt })).toBeNull();
  });
});

describe("isInActiveGame", () => {
  it("recognises the refusal the arena sends to an agent that is already playing", () => {
    // This is the one a restarting agent hits: joinQueue throws, and treating
    // it as fatal kills the process before it can resume the game it is in.
    expect(isInActiveGame(new ArenaError("in_active_game", 409, "Agent is playing a game"))).toBe(true);
  });

  it("does not swallow anything else", () => {
    expect(isInActiveGame(new ArenaError("rate_limited", 429, "Too many requests"))).toBe(false);
    expect(isInActiveGame(new Error("network down"))).toBe(false);
    expect(isInActiveGame(null)).toBe(false);
  });
});
