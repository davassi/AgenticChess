import { LeaderboardPageSchema } from "@aichess/core/protocol";
import { agents, ratings } from "@aichess/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness, type SeededAgent } from "../test-utils/harness.js";

describe("GET /v1/leaderboard", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  async function seedBoard(): Promise<{ top: SeededAgent; runnerUp: SeededAgent }> {
    const top = await h.seedAgent();
    const runnerUp = await h.seedAgent();
    const provisional = await h.seedAgent();
    const suspended = await h.seedAgent();
    await h.db.insert(ratings).values([
      { agentId: top.id, rating: 1800, rd: 30, volatility: 0.06, gamesPlayed: 40 },
      { agentId: runnerUp.id, rating: 1700, rd: 50, volatility: 0.06, gamesPlayed: 30 },
      { agentId: provisional.id, rating: 1900, rd: 200, volatility: 0.06, gamesPlayed: 2 },
      { agentId: suspended.id, rating: 2000, rd: 20, volatility: 0.06, gamesPlayed: 50 },
    ]);
    await h.db.update(agents).set({ status: "suspended" }).where(eq(agents.id, suspended.id));
    return { top, runnerUp };
  }

  async function fetchPage(url: string): Promise<ReturnType<typeof LeaderboardPageSchema.parse>> {
    const res = await h.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    return LeaderboardPageSchema.parse(res.json());
  }

  it("lists ranked agents and skips provisional and suspended ones", async () => {
    const { top, runnerUp } = await seedBoard();
    const page = await fetchPage("/v1/leaderboard");
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((i) => [i.rank, i.agent.id, i.rating, i.rd, i.gamesPlayed])).toEqual([
      [1, top.id, 1800, 30, 40],
      [2, runnerUp.id, 1700, 50, 30],
    ]);
    expect(page.items[0]?.agent).toMatchObject({ id: top.id, name: top.name, slug: top.slug });
  });

  it("pages with a cursor and keeps the rank running", async () => {
    const { top, runnerUp } = await seedBoard();
    const first = await fetchPage("/v1/leaderboard?limit=1");
    expect(first.items.map((i) => i.agent.id)).toEqual([top.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = await fetchPage(`/v1/leaderboard?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    expect(second.items.map((i) => [i.rank, i.agent.id])).toEqual([[2, runnerUp.id]]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns an empty page when nobody is ranked", async () => {
    expect(await fetchPage("/v1/leaderboard")).toEqual({ items: [], nextCursor: null });
  });

  it("rejects a bad limit or a malformed cursor with validation_error", async () => {
    const badLimit = await h.app.inject({ method: "GET", url: "/v1/leaderboard?limit=0" });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json()).toMatchObject({ error: "validation_error" });

    const garbage = await h.app.inject({ method: "GET", url: "/v1/leaderboard?cursor=not-a-cursor" });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json()).toMatchObject({ error: "validation_error", details: { where: "query" } });

    const emptyObject = Buffer.from("{}", "utf8").toString("base64url");
    const incomplete = await h.app.inject({ method: "GET", url: `/v1/leaderboard?cursor=${emptyObject}` });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({ error: "validation_error" });
  });
});
