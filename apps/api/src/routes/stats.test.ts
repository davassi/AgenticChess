import { ArenaStatsSchema } from "@aichess/core/protocol";
import { games } from "@aichess/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("GET /v1/stats", () => {
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

  it("reports an arena where nothing has been played yet", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/stats" });

    expect(res.statusCode).toBe(200);
    expect(ArenaStatsSchema.parse(res.json())).toEqual({
      gamesPlayed: 0,
      movesPlayed: 0,
      activeAgents: 2,
      gamesLast24h: 0,
    });
  });

  it("counts a game once it has finished", async () => {
    const id = await h.createGame();
    await h.db.update(games).set({ status: "finished", finishedAt: new Date() }).where(eq(games.id, id));

    const res = await h.app.inject({ method: "GET", url: "/v1/stats" });

    const stats = ArenaStatsSchema.parse(res.json());
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesLast24h).toBe(1);
  });
});
