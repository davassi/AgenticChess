import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { arenaStats } from "./arena-stats.js";
import { agents, games, moves, users } from "./schema/index.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const HOUR_MS = 60 * 60 * 1_000;
const NOW = new Date("2026-09-07T12:00:00.000Z");

const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR_MS);

/**
 * One arena with something of everything in it: a game that counts, one that is
 * too old to count as recent, one sitting exactly on the boundary, an aborted
 * one, a game still being played, and an agent nobody should count.
 */
async function seedArena(tdb: TestDatabase): Promise<void> {
  const [owner] = await tdb.db.insert(users).values({ email: "owner@example.com", name: "Owner" }).returning();
  if (owner === undefined) throw new Error("test owner was not inserted");

  const roster = await tdb.db
    .insert(agents)
    .values([
      {
        ownerId: owner.id,
        name: "Alpha",
        slug: "alpha",
        modelProvider: "anthropic",
        modelName: "claude-opus-5",
        apiKeyPrefix: "aaaaaaaa",
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: owner.id,
        name: "Beta",
        slug: "beta",
        modelProvider: "anthropic",
        modelName: "claude-haiku-4-5",
        apiKeyPrefix: "bbbbbbbb",
        apiKeyHash: "1".repeat(64),
      },
      {
        ownerId: owner.id,
        name: "Ghost",
        slug: "ghost",
        modelProvider: "ollama",
        modelName: "gemma3:270m",
        apiKeyPrefix: "cccccccc",
        apiKeyHash: "2".repeat(64),
        status: "suspended" as const,
      },
    ])
    .returning();
  const [alpha, beta] = roster;
  if (alpha === undefined || beta === undefined) throw new Error("test agents were not inserted");

  const table = {
    whiteAgentId: alpha.id,
    blackAgentId: beta.id,
    timePerMoveMs: 60_000,
    moveLimitPlies: 300,
    illegalAttemptsPerTurn: 3,
    currentFen: START_FEN,
  };

  const played = await tdb.db
    .insert(games)
    .values([
      { ...table, status: "finished" as const, result: "1-0" as const, finishedAt: hoursAgo(2) },
      { ...table, status: "finished" as const, result: "0-1" as const, finishedAt: hoursAgo(26) },
      { ...table, status: "finished" as const, result: "1/2-1/2" as const, finishedAt: hoursAgo(24) },
      { ...table, status: "aborted" as const, finishedAt: hoursAgo(1) },
      { ...table, status: "active" as const },
    ])
    .returning();
  const [recent, old, boundary, , running] = played;
  if (recent === undefined || old === undefined || boundary === undefined || running === undefined) {
    throw new Error("test games were not inserted");
  }

  const ply = (gameId: string, count: number): (typeof moves.$inferInsert)[] =>
    Array.from({ length: count }, (_unused, index) => ({
      gameId,
      ply: index + 1,
      color: index % 2 === 0 ? ("white" as const) : ("black" as const),
      san: "e4",
      uci: "e2e4",
      fenAfter: START_FEN,
      thinkTimeMs: 1_200,
    }));

  await tdb.db
    .insert(moves)
    .values([...ply(recent.id, 3), ...ply(old.id, 2), ...ply(boundary.id, 1), ...ply(running.id, 4)]);
}

describe("arenaStats", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("counts the finished games and leaves the aborted and the unfinished out", async () => {
    await seedArena(tdb);

    const stats = await arenaStats(tdb.db, NOW);

    expect(stats.gamesPlayed).toBe(3);
  });

  it("counts every move played, including those of a game still running", async () => {
    await seedArena(tdb);

    const stats = await arenaStats(tdb.db, NOW);

    expect(stats.movesPlayed).toBe(10);
  });

  it("counts the active agents and leaves the suspended out", async () => {
    await seedArena(tdb);

    const stats = await arenaStats(tdb.db, NOW);

    expect(stats.activeAgents).toBe(2);
  });

  it("counts the games finished within the last day, the boundary day included", async () => {
    await seedArena(tdb);

    const stats = await arenaStats(tdb.db, NOW);

    expect(stats.gamesLast24h).toBe(2);
  });

  it("reports zeros for an arena where nothing has happened yet", async () => {
    const stats = await arenaStats(tdb.db, NOW);

    expect(stats).toEqual({ gamesPlayed: 0, movesPlayed: 0, activeAgents: 0, gamesLast24h: 0 });
  });
});
