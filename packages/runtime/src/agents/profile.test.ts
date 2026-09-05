import { START_FEN } from "@aichess/core";
import { games, moveAttempts, moves, ratingHistory, ratings, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { seedTwoAgents } from "../testing.js";
import { RATING_HISTORY_LIMIT, listAgents, loadAgentProfile } from "./profile.js";

const T0 = Date.UTC(2026, 8, 4, 10, 0, 0);

describe("agent profile", () => {
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
    agents = await seedTwoAgents(db, { owners: "distinct" });
  });

  async function playedGame(result: "1-0" | "0-1" | "1/2-1/2", createdAt: number, rated = true): Promise<string> {
    const [row] = await db
      .insert(games)
      .values({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        status: "finished",
        result,
        rated,
        termination: result === "1/2-1/2" ? "stalemate" : "checkmate",
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
        ply: 2,
        createdAt: new Date(createdAt),
        startedAt: new Date(createdAt),
        finishedAt: new Date(createdAt + 1_000),
      })
      .returning({ id: games.id });
    if (row === undefined) throw new Error("game not inserted");
    return row.id;
  }

  it("returns null for a slug nobody owns", async () => {
    expect(await loadAgentProfile(db, "nobody")).toBeNull();
  });

  it("counts results from the agent's own side of the board", async () => {
    await playedGame("1-0", T0 - 3_000);
    await playedGame("0-1", T0 - 2_000);
    await playedGame("1/2-1/2", T0 - 1_000);

    const white = await loadAgentProfile(db, agents.white.slug);
    expect(white?.stats).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1 });
    const black = await loadAgentProfile(db, agents.black.slug);
    expect(black?.stats).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1 });
    expect(white?.recentGames).toHaveLength(3);
    expect(white?.recentGames[0]?.result).toBe("1/2-1/2");
  });

  it("measures think time and the illegal-attempt rate on the agent's own moves", async () => {
    const gameId = await playedGame("1-0", T0);
    await db.insert(moves).values([
      {
        gameId,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: START_FEN,
        comment: null,
        thinkTimeMs: 6_000,
        illegalAttemptsBefore: 0,
      },
      {
        gameId,
        ply: 2,
        color: "black",
        san: "e5",
        uci: "e7e5",
        fenAfter: START_FEN,
        comment: null,
        thinkTimeMs: 2_000,
        illegalAttemptsBefore: 0,
      },
      {
        gameId,
        ply: 3,
        color: "white",
        san: "Nf3",
        uci: "g1f3",
        fenAfter: START_FEN,
        comment: null,
        thinkTimeMs: 4_000,
        illegalAttemptsBefore: 1,
      },
    ]);
    await db.insert(moveAttempts).values({
      gameId,
      agentId: agents.white.id,
      ply: 3,
      submitted: "Qz9",
      reason: "unparseable",
    });

    const white = await loadAgentProfile(db, agents.white.slug);
    expect(white?.stats.avgThinkTimeMs).toBe(5_000);
    expect(white?.stats.illegalRate).toBeCloseTo(0.5, 5);
    const black = await loadAgentProfile(db, agents.black.slug);
    expect(black?.stats.avgThinkTimeMs).toBe(2_000);
    expect(black?.stats.illegalRate).toBe(0);
  });

  it("ranks a rated agent and leaves a provisional one unranked", async () => {
    const third = await seedTwoAgents(db);
    await db.insert(ratings).values([
      { agentId: agents.white.id, rating: 1700, rd: 60, volatility: 0.06, gamesPlayed: 30 },
      { agentId: third.white.id, rating: 1800, rd: 50, volatility: 0.06, gamesPlayed: 40 },
      { agentId: agents.black.id, rating: 1900, rd: 300, volatility: 0.06, gamesPlayed: 2 },
    ]);

    expect((await loadAgentProfile(db, agents.white.slug))?.rank).toBe(2);
    expect((await loadAgentProfile(db, third.white.slug))?.rank).toBe(1);
    const provisional = await loadAgentProfile(db, agents.black.slug);
    expect(provisional?.rank).toBeNull();
    expect(provisional?.rating.provisional).toBe(true);
  });

  it("returns the rating curve oldest first and defaults an agent with no games", async () => {
    const gameId = await playedGame("1-0", T0);
    await db.insert(ratingHistory).values({
      agentId: agents.white.id,
      gameId,
      ratingBefore: 1500,
      ratingAfter: 1560,
      rdAfter: 290,
    });
    const profile = await loadAgentProfile(db, agents.white.slug);
    expect(profile?.ratingHistory).toMatchObject([{ gameId, rating: 1560, rd: 290 }]);

    const fresh = await loadAgentProfile(db, agents.black.slug);
    expect(fresh?.rating).toMatchObject({ rating: 1500, rd: 350, gamesPlayed: 0, provisional: true });
    expect(fresh?.stats).toMatchObject({ games: 1, avgThinkTimeMs: 0, illegalRate: 0 });
    expect(fresh?.ratingHistory).toEqual([]);
  });

  it("keeps the newest points when the history is longer than the limit", async () => {
    // An ascending LIMIT freezes the curve at the agent's first 200 rated
    // games: everything it has done since would be missing.
    const total = RATING_HISTORY_LIMIT + 5;
    const gameIds: string[] = [];
    for (let index = 0; index < total; index += 1) gameIds.push(await playedGame("1-0", T0 + index * 1_000));
    await db.insert(ratingHistory).values(
      gameIds.map((gameId, index) => ({
        agentId: agents.white.id,
        gameId,
        ratingBefore: 1500 + index,
        ratingAfter: 1501 + index,
        rdAfter: 200,
        createdAt: new Date(T0 + index * 1_000),
      })),
    );

    const profile = await loadAgentProfile(db, agents.white.slug);
    expect(profile?.ratingHistory).toHaveLength(RATING_HISTORY_LIMIT);
    expect(profile?.ratingHistory.at(-1)?.rating).toBe(1500 + total);
    expect(profile?.ratingHistory.at(0)?.rating).toBeLessThan(profile?.ratingHistory.at(-1)?.rating ?? 0);
  });

  it("measures think time and attempts over the same games it counts", async () => {
    // `games` counts finished games only, so an active one must not drag the
    // averages printed beside it.
    const [running] = await db
      .insert(games)
      .values({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        status: "active",
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
        ply: 1,
        createdAt: new Date(T0),
        startedAt: new Date(T0),
      })
      .returning({ id: games.id });
    if (running === undefined) throw new Error("game not inserted");
    const finished = await playedGame("1-0", T0 + 1_000);
    await db.insert(moves).values([
      {
        gameId: finished,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: START_FEN,
        comment: null,
        thinkTimeMs: 4_000,
        illegalAttemptsBefore: 0,
      },
      {
        gameId: running.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fenAfter: START_FEN,
        comment: null,
        thinkTimeMs: 60_000,
        illegalAttemptsBefore: 0,
      },
    ]);
    await db.insert(moveAttempts).values({
      gameId: running.id,
      agentId: agents.white.id,
      ply: 1,
      submitted: "Qz9",
      reason: "unparseable",
    });

    const profile = await loadAgentProfile(db, agents.white.slug);
    expect(profile?.stats).toMatchObject({ games: 1, avgThinkTimeMs: 4_000, illegalRate: 0 });
  });

  it("lists the roster by name with a cursor", async () => {
    const items = await listAgents(db, { limit: 1 });
    expect(items).toHaveLength(1);
    const first = items[0];
    if (first === undefined) throw new Error("empty roster");
    const next = await listAgents(db, { limit: 5, after: { name: first.agent.name, id: first.agent.id } });
    expect(next.map((i) => i.agent.id)).not.toContain(first.agent.id);
    expect(first.rating).toMatchObject({ rating: 1500, provisional: true });
  });

  it("counts only rated games in the profile statistics", async () => {
    await playedGame("1-0", T0);
    await playedGame("1-0", T0 + 1_000, false);

    const profile = await loadAgentProfile(db, agents.white.slug);

    expect(profile?.stats.games).toBe(1);
    expect(profile?.stats.wins).toBe(1);
  });
});
