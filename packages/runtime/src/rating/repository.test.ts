import { GLICKO2_DEFAULTS } from "@aichess/core";
import { agents as agentsTable, ratings, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { seedTwoAgents } from "../testing.js";
import { defaultRatingRecord, listLeaderboard, loadRating, lockRatings, toRatingSummary } from "./repository.js";

describe("rating repository", () => {
  let tdb: TestDatabase;
  let db: Database;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    agents = await seedTwoAgents(db);
  });

  it("reads the Glicko-2 defaults for an agent without a row", async () => {
    const record = await loadRating(db, agents.white.id);
    expect(record).toEqual(defaultRatingRecord(agents.white.id));
    expect(record).toMatchObject({
      rating: GLICKO2_DEFAULTS.rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
      gamesPlayed: 0,
      lastGameAt: null,
    });
    expect(toRatingSummary(record)).toEqual({ rating: 1500, rd: 350, gamesPlayed: 0, provisional: true });
    expect(toRatingSummary({ ...record, rd: 110 })).toMatchObject({ provisional: false });
  });

  it("creates missing rows on lock and returns stored values afterwards", async () => {
    const first = await db.transaction((tx) => lockRatings(tx, [agents.black.id, agents.white.id]));
    expect([...first.keys()].sort()).toEqual([agents.white.id, agents.black.id].sort());
    expect(first.get(agents.white.id)).toEqual(defaultRatingRecord(agents.white.id));

    await db
      .update(ratings)
      .set({ rating: 1650.5, rd: 90, gamesPlayed: 7 })
      .where(eq(ratings.agentId, agents.white.id));
    const second = await db.transaction((tx) => lockRatings(tx, [agents.white.id, agents.black.id]));
    expect(second.get(agents.white.id)).toMatchObject({ rating: 1650.5, rd: 90, gamesPlayed: 7 });
    expect(second.get(agents.black.id)).toEqual(defaultRatingRecord(agents.black.id));
    expect(await db.select().from(ratings)).toHaveLength(2);

    expect(await loadRating(db, agents.white.id)).toMatchObject({ rating: 1650.5, gamesPlayed: 7 });
  });

  it("lists ranked agents by rating then RD, skipping provisional and suspended ones, with keyset paging", async () => {
    const more = await seedTwoAgents(db, { owners: "distinct" });
    await db.insert(ratings).values([
      { agentId: agents.white.id, rating: 1700, rd: 50, volatility: 0.06, gamesPlayed: 30 },
      { agentId: agents.black.id, rating: 1700, rd: 40, volatility: 0.06, gamesPlayed: 25 },
      { agentId: more.white.id, rating: 1650, rd: 200, volatility: 0.06, gamesPlayed: 2 },
      { agentId: more.black.id, rating: 1800, rd: 30, volatility: 0.06, gamesPlayed: 40 },
    ]);
    await db.update(agentsTable).set({ status: "suspended" }).where(eq(agentsTable.id, more.black.id));

    const all = await listLeaderboard(db, { limit: 10 });
    expect(all.map((r) => [r.agent.id, r.rating, r.rd, r.gamesPlayed])).toEqual([
      [agents.black.id, 1700, 40, 25],
      [agents.white.id, 1700, 50, 30],
    ]);
    expect(all[0]?.agent).toEqual(agents.black);

    const first = await listLeaderboard(db, { limit: 1 });
    expect(first.map((r) => r.agent.id)).toEqual([agents.black.id]);
    const last = first[0];
    if (last === undefined) throw new Error("expected one row");
    const second = await listLeaderboard(db, {
      limit: 1,
      after: { rating: last.rating, rd: last.rd, agentId: last.agent.id },
    });
    expect(second.map((r) => r.agent.id)).toEqual([agents.white.id]);
    expect(await listLeaderboard(db, { limit: 1, after: { rating: 1700, rd: 50, agentId: agents.white.id } })).toEqual(
      [],
    );
  });
});
