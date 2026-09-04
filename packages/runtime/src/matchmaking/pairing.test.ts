import { describe, expect, it } from "vitest";
import { DEFAULT_PAIRING_WINDOW, chooseColors, pairCandidates, windowFor, type Candidate } from "./pairing.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

function candidate(overrides: Partial<Candidate> & { agentId: string }): Candidate {
  return {
    ownerId: `owner-${overrides.agentId}`,
    rating: 1500,
    queuedAt: T0,
    lastColor: null,
    ...overrides,
  };
}

function ids(pairs: ReturnType<typeof pairCandidates>): Array<[string, string]> {
  return pairs.map((p) => [p.white.agentId, p.black.agentId]);
}

describe("windowFor", () => {
  it("starts at the initial width and grows by one step every stepMs, capped at max", () => {
    expect(windowFor(0)).toBe(150);
    expect(windowFor(9_999)).toBe(150);
    expect(windowFor(10_000)).toBe(250);
    expect(windowFor(35_000)).toBe(450);
    expect(windowFor(120_000)).toBe(1_000);
    expect(windowFor(-5)).toBe(150);
    expect(windowFor(20_000, { initial: 50, growth: 10, stepMs: 5_000, max: 75 })).toBe(75);
    expect(DEFAULT_PAIRING_WINDOW).toEqual({ initial: 150, growth: 100, stepMs: 10_000, max: 1_000 });
  });
});

describe("chooseColors", () => {
  it("gives white to the seeker when neither has played", () => {
    const pair = chooseColors(candidate({ agentId: "a" }), candidate({ agentId: "b" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["a", "b"]);
  });

  it("alternates the seeker's colour with its previous game", () => {
    const pair = chooseColors(candidate({ agentId: "a", lastColor: "white" }), candidate({ agentId: "b" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["b", "a"]);
  });

  it("honours the other agent's alternation when the seeker has no history", () => {
    const pair = chooseColors(candidate({ agentId: "a" }), candidate({ agentId: "b", lastColor: "black" }));
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["b", "a"]);
  });

  it("lets the seeker win a conflict", () => {
    const pair = chooseColors(
      candidate({ agentId: "a", lastColor: "black" }),
      candidate({ agentId: "b", lastColor: "black" }),
    );
    expect([pair.white.agentId, pair.black.agentId]).toEqual(["a", "b"]);
  });
});

describe("pairCandidates", () => {
  it("returns nothing for an empty or single-entry queue", () => {
    expect(pairCandidates([], T0)).toEqual([]);
    expect(pairCandidates([candidate({ agentId: "a" })], T0)).toEqual([]);
  });

  it("pairs two agents inside the initial window", () => {
    const pairs = pairCandidates([candidate({ agentId: "a" }), candidate({ agentId: "b", rating: 1640 })], T0);
    expect(ids(pairs)).toEqual([["a", "b"]]);
  });

  it("does not pair agents outside the window, and widens the window with the wait", () => {
    const queue = [candidate({ agentId: "a" }), candidate({ agentId: "b", rating: 1900 })];
    expect(pairCandidates(queue, T0)).toEqual([]);
    expect(pairCandidates(queue, T0 + 20_000)).toEqual([]);
    expect(ids(pairCandidates(queue, T0 + 30_000))).toEqual([["a", "b"]]);
  });

  it("never pairs two agents of the same owner", () => {
    const queue = [
      candidate({ agentId: "a", ownerId: "same" }),
      candidate({ agentId: "b", ownerId: "same" }),
      candidate({ agentId: "c", ownerId: "other", queuedAt: T0 + 1 }),
    ];
    expect(ids(pairCandidates(queue, T0))).toEqual([["a", "c"]]);
  });

  it("serves the longest wait first and picks the closest rating", () => {
    const queue = [
      candidate({ agentId: "late", rating: 1500, queuedAt: T0 + 5_000 }),
      candidate({ agentId: "early", rating: 1500, queuedAt: T0 }),
      candidate({ agentId: "near", rating: 1520, queuedAt: T0 + 6_000 }),
      candidate({ agentId: "far", rating: 1600, queuedAt: T0 + 7_000 }),
    ];
    expect(ids(pairCandidates(queue, T0 + 10_000))).toEqual([
      ["early", "late"],
      ["near", "far"],
    ]);
  });

  it("uses the seeker's window, so a long wait reaches a fresh entry", () => {
    const queue = [
      candidate({ agentId: "patient", rating: 1500, queuedAt: T0 }),
      candidate({ agentId: "fresh", rating: 1800, queuedAt: T0 + 40_000 }),
    ];
    expect(ids(pairCandidates(queue, T0 + 40_000))).toEqual([["patient", "fresh"]]);
  });

  it("pairs each agent at most once per round", () => {
    const queue = ["a", "b", "c"].map((agentId, i) => candidate({ agentId, queuedAt: T0 + i }));
    const pairs = pairCandidates(queue, T0);
    expect(pairs).toHaveLength(1);
    expect(ids(pairs)).toEqual([["a", "b"]]);
  });
});
