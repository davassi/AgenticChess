import { START_FEN } from "@aichess/core";
import { games, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findAgentIdBySlug } from "../agents/repository.js";
import type { GameAgents } from "../events/wire.js";
import { seedTwoAgents } from "../testing.js";
import { listGames } from "./listing.js";

const T0 = Date.UTC(2026, 8, 4, 10, 0, 0);

describe("game listing", () => {
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

  async function insertGame(overrides: Partial<typeof games.$inferInsert> = {}): Promise<string> {
    const [row] = await db
      .insert(games)
      .values({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        status: "finished",
        result: "1-0",
        termination: "checkmate",
        timePerMoveMs: 60_000,
        moveLimitPlies: 300,
        illegalAttemptsPerTurn: 3,
        currentFen: START_FEN,
        ply: 42,
        createdAt: new Date(T0),
        startedAt: new Date(T0),
        finishedAt: new Date(T0 + 60_000),
        ...overrides,
      })
      .returning({ id: games.id });
    if (row === undefined) throw new Error("game not inserted");
    return row.id;
  }

  it("returns newest first with both agents and the side to move", async () => {
    await insertGame({ createdAt: new Date(T0 - 60_000) });
    const newer = await insertGame({ status: "active", result: null, termination: null, ply: 3 });
    const items = await listGames(db, { limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(newer);
    expect(items[0]?.white.slug).toBe(agents.white.slug);
    expect(items[0]?.black.slug).toBe(agents.black.slug);
    expect(items[0]?.turn).toBe("white");
    expect(items[0]?.createdAt).toBe(new Date(T0).toISOString());
    expect(items[1]?.finishedAt).toBe(new Date(T0 + 60_000).toISOString());
  });

  it("filters by status, termination and agent", async () => {
    const active = await insertGame({ status: "active", result: null, termination: null });
    await insertGame({ termination: "timeout" });
    const other = await seedTwoAgents(db);
    await insertGame({ whiteAgentId: other.white.id, blackAgentId: other.black.id });

    expect((await listGames(db, { limit: 10, status: "active" })).map((g) => g.id)).toEqual([active]);
    expect(await listGames(db, { limit: 10, termination: "timeout" })).toHaveLength(1);
    expect(await listGames(db, { limit: 10, agentId: other.white.id })).toHaveLength(1);
  });

  it("filters by outcome from the named agent's point of view", async () => {
    await insertGame({ result: "1-0" });
    await insertGame({ result: "0-1" });
    await insertGame({ result: "1/2-1/2", termination: "stalemate" });

    const wins = await listGames(db, { limit: 10, agentId: agents.white.id, outcome: "win" });
    const losses = await listGames(db, { limit: 10, agentId: agents.white.id, outcome: "loss" });
    const draws = await listGames(db, { limit: 10, agentId: agents.white.id, outcome: "draw" });
    expect(wins.map((g) => g.result)).toEqual(["1-0"]);
    expect(losses.map((g) => g.result)).toEqual(["0-1"]);
    expect(draws.map((g) => g.result)).toEqual(["1/2-1/2"]);
  });

  it("pages with a keyset cursor and never repeats a row", async () => {
    const ids = [
      await insertGame({ createdAt: new Date(T0 - 2_000) }),
      await insertGame({ createdAt: new Date(T0 - 1_000) }),
      await insertGame({ createdAt: new Date(T0) }),
    ].reverse();
    const first = await listGames(db, { limit: 2 });
    const last = first[first.length - 1];
    if (last === undefined) throw new Error("empty first page");
    const second = await listGames(db, {
      limit: 2,
      after: { createdAt: Date.parse(last.createdAt), id: last.id },
    });
    expect([...first, ...second].map((g) => g.id)).toEqual(ids);
  });

  it("resolves an agent id from a slug", async () => {
    expect(await findAgentIdBySlug(db, agents.white.slug)).toBe(agents.white.id);
    expect(await findAgentIdBySlug(db, "nobody")).toBeNull();
  });
});
