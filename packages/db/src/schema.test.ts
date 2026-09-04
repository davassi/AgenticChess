import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { agents, games, moves, ratingHistory, ratings, users } from "./schema/index.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const UNIQUE_VIOLATION = "23505";

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === UNIQUE_VIOLATION;
  });
}

describe("database schema", () => {
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

  it("applies migrations idempotently", async () => {
    await expect(runMigrations(tdb.db)).resolves.toBeUndefined();
  });

  it("stores a user, two agents and a game with defaults", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    expect(owner.role).toBe("user");

    const inserted = await tdb.db
      .insert(agents)
      .values([
        {
          ownerId: owner.id,
          name: "Alpha",
          slug: "alpha",
          modelProvider: "anthropic",
          modelName: "claude-sonnet-5",
          apiKeyPrefix: "AAAAAAAA",
          apiKeyHash: "0".repeat(64),
        },
        {
          ownerId: owner.id,
          name: "Beta",
          slug: "beta",
          modelProvider: "openai",
          modelName: "gpt-5",
          apiKeyPrefix: "BBBBBBBB",
          apiKeyHash: "1".repeat(64),
        },
      ])
      .returning();
    const [alpha, beta] = inserted;
    if (alpha === undefined || beta === undefined) throw new Error("agents not inserted");
    expect(alpha.status).toBe("active");

    const [game] = await tdb.db
      .insert(games)
      .values({
        whiteAgentId: alpha.id,
        blackAgentId: beta.id,
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
      })
      .returning();
    if (game === undefined) throw new Error("game not inserted");
    expect(game.status).toBe("created");
    expect(game.ply).toBe(0);
    expect(game.result).toBeNull();
    expect(game.moveDeadlineAt).toBeNull();

    const loaded = await tdb.db.query.games.findFirst({
      where: eq(games.id, game.id),
      with: { white: true, black: true },
    });
    expect(loaded?.white.slug).toBe("alpha");
    expect(loaded?.black.slug).toBe("beta");
  });

  it("rejects a duplicate agent slug", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    const base = {
      ownerId: owner.id,
      name: "Alpha",
      slug: "alpha",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-5",
      apiKeyPrefix: "AAAAAAAA",
      apiKeyHash: "0".repeat(64),
    };
    await tdb.db.insert(agents).values(base);
    await expectUniqueViolation(tdb.db.insert(agents).values({ ...base, apiKeyPrefix: "CCCCCCCC" }));
  });

  it("rejects two moves at the same ply of one game", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    const [a, b] = await tdb.db
      .insert(agents)
      .values([
        {
          ownerId: owner.id,
          name: "A",
          slug: "a",
          modelProvider: "x",
          modelName: "y",
          apiKeyPrefix: "AAAAAAAA",
          apiKeyHash: "0".repeat(64),
        },
        {
          ownerId: owner.id,
          name: "B",
          slug: "b",
          modelProvider: "x",
          modelName: "y",
          apiKeyPrefix: "BBBBBBBB",
          apiKeyHash: "1".repeat(64),
        },
      ])
      .returning();
    if (a === undefined || b === undefined) throw new Error("agents not inserted");
    const [game] = await tdb.db
      .insert(games)
      .values({
        whiteAgentId: a.id,
        blackAgentId: b.id,
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
      })
      .returning();
    if (game === undefined) throw new Error("game not inserted");
    const move = {
      gameId: game.id,
      ply: 1,
      color: "white" as const,
      san: "e4",
      uci: "e2e4",
      fenAfter: START_FEN,
      thinkTimeMs: 10,
    };
    await tdb.db.insert(moves).values(move);
    await expectUniqueViolation(tdb.db.insert(moves).values(move));
  });

  it("stores a rating row with defaults and refuses two history rows for one agent and game", async () => {
    const [owner] = await tdb.db.insert(users).values({ email: "o@example.com", name: "Owner" }).returning();
    if (owner === undefined) throw new Error("insert returned nothing");
    const [a, b] = await tdb.db
      .insert(agents)
      .values([
        {
          ownerId: owner.id,
          name: "A",
          slug: "a",
          modelProvider: "x",
          modelName: "y",
          apiKeyPrefix: "AAAAAAAA",
          apiKeyHash: "0".repeat(64),
        },
        {
          ownerId: owner.id,
          name: "B",
          slug: "b",
          modelProvider: "x",
          modelName: "y",
          apiKeyPrefix: "BBBBBBBB",
          apiKeyHash: "1".repeat(64),
        },
      ])
      .returning();
    if (a === undefined || b === undefined) throw new Error("agents not inserted");
    const [game] = await tdb.db
      .insert(games)
      .values({
        whiteAgentId: a.id,
        blackAgentId: b.id,
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
      })
      .returning();
    if (game === undefined) throw new Error("game not inserted");

    await tdb.db.insert(ratings).values({ agentId: a.id, rating: 1500, rd: 350, volatility: 0.06 });
    const [row] = await tdb.db.select().from(ratings).where(eq(ratings.agentId, a.id));
    expect(row).toMatchObject({ rating: 1500, rd: 350, volatility: 0.06, gamesPlayed: 0, lastGameAt: null });

    const history = { agentId: a.id, gameId: game.id, ratingBefore: 1500, ratingAfter: 1512.3, rdAfter: 290.1 };
    await tdb.db.insert(ratingHistory).values(history);
    await expectUniqueViolation(tdb.db.insert(ratingHistory).values(history));
    await tdb.db.insert(ratingHistory).values({ ...history, agentId: b.id });
    expect(await tdb.db.select().from(ratingHistory)).toHaveLength(2);
  });
});
