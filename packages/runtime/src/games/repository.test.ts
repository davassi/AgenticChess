import { randomUUID } from "node:crypto";
import { applyMove, applyResign, createGame, startGame, toPgn, type GameState } from "@aichess/core";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { games, moveAttempts, moves, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { seedTwoAgents } from "../testing.js";
import {
  insertGame,
  listActiveDeadlines,
  loadAgentSummaries,
  loadGame,
  loadGameForUpdate,
  persistTransition,
} from "./repository.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("game repository", () => {
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

  function fresh(): GameState {
    return createGame({
      id: randomUUID(),
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
  }

  it("round-trips a created game", async () => {
    const state = fresh();
    await insertGame(db, state);
    expect(await loadGame(db, state.id)).toEqual(state);
  });

  it("returns null for an unknown game", async () => {
    expect(await loadGame(db, randomUUID())).toBeNull();
  });

  it("persists a start and two moves and reloads the identical state", async () => {
    const created = fresh();
    await insertGame(db, created);
    const started = startGame(created, T0 + 10);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));

    const m1 = applyMove(started.state, {
      agentId: agents.white.id,
      ply: 0,
      move: "e4",
      comment: "Centre.",
      now: T0 + 2_000,
    });
    if (!m1.ok) throw new Error(m1.code);
    await db.transaction((tx) => persistTransition(tx, started.state, m1.state, m1.events, {}));

    const m2 = applyMove(m1.state, { agentId: agents.black.id, ply: 1, move: "c5", now: T0 + 4_500 });
    if (!m2.ok) throw new Error(m2.code);
    await db.transaction((tx) => persistTransition(tx, m1.state, m2.state, m2.events, {}));

    const loaded = await loadGame(db, created.id);
    expect(loaded).toEqual(m2.state);
    expect(loaded?.fenHistory).toHaveLength(3);
    expect(loaded?.moves.map((m) => [m.ply, m.san, m.comment, m.thinkTimeMs])).toEqual([
      [1, "e4", "Centre.", 1_990],
      [2, "c5", null, 2_500],
    ]);
  });

  it("records illegal attempts against the offending agent", async () => {
    const created = fresh();
    await insertGame(db, created);
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));

    const bad = applyMove(started.state, { agentId: agents.white.id, ply: 0, move: "Nf6", now: T0 + 1 });
    if (bad.ok || bad.code !== "illegal_move") throw new Error("expected illegal_move");
    await db.transaction((tx) => persistTransition(tx, started.state, bad.state, bad.events, {}));

    const rows = await db.select().from(moveAttempts).where(eq(moveAttempts.gameId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: agents.white.id, ply: 0, submitted: "Nf6", reason: "not_legal" });
    expect((await loadGame(db, created.id))?.illegalAttemptsThisTurn).toBe(1);
  });

  it("stores the pgn and terminal fields of a finished game", async () => {
    const created = fresh();
    await insertGame(db, created);
    let state = startGame(created, T0).state;
    await db.transaction((tx) => persistTransition(tx, created, state, [], {}));
    for (const [agentId, san] of [
      [agents.white.id, "f3"],
      [agents.black.id, "e5"],
      [agents.white.id, "g4"],
      [agents.black.id, "Qh4"],
    ] as const) {
      const before = state;
      const r = applyMove(before, { agentId, ply: before.ply, move: san, now: T0 + before.ply * 1_000 + 500 });
      if (!r.ok) throw new Error(r.code);
      state = r.state;
      const pgn =
        state.status === "finished" ? toPgn(state, { white: agents.white.name, black: agents.black.name }) : null;
      await db.transaction((tx) => persistTransition(tx, before, state, r.events, { pgn }));
    }
    const loaded = await loadGame(db, created.id);
    expect(loaded).toEqual(state);
    expect(loaded?.status).toBe("finished");
    const [row] = await db.query.games.findMany({ where: (g, { eq: equals }) => equals(g.id, created.id) });
    expect(row?.pgn).toContain("Qh4#");
    expect(row?.result).toBe("0-1");
    expect(row?.termination).toBe("checkmate");
    expect(await db.select().from(moves).where(eq(moves.gameId, created.id))).toHaveLength(4);
  });

  it("loads agent summaries in colour order", async () => {
    expect(await loadAgentSummaries(db, agents.white.id, agents.black.id)).toEqual(agents);
    expect(await loadAgentSummaries(db, agents.black.id, agents.white.id)).toEqual({
      white: agents.black,
      black: agents.white,
    });
    expect(await loadAgentSummaries(db, agents.white.id, randomUUID())).toBeNull();
  });

  it("lists deadlines of active games only", async () => {
    const a = fresh();
    const b = fresh();
    await insertGame(db, a);
    await insertGame(db, b);
    const startedA = startGame(a, T0);
    await db.transaction((tx) => persistTransition(tx, a, startedA.state, startedA.events, {}));
    expect(await listActiveDeadlines(db)).toEqual([{ gameId: a.id, ply: 0, moveDeadlineAt: T0 + 60_000 }]);
  });

  it("serialises concurrent updates through the row lock", async () => {
    const created = fresh();
    await insertGame(db, created);
    const order: string[] = [];
    const first = db.transaction(async (tx) => {
      await loadGameForUpdate(tx, created.id);
      order.push("first-locked");
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push("first-done");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = db.transaction(async (tx) => {
      await loadGameForUpdate(tx, created.id);
      order.push("second-locked");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first-locked", "first-done", "second-locked"]);
  });

  it("finds the active game of an agent, if any", async () => {
    const { findActiveGameIdForAgent } = await import("./repository.js");
    expect(await findActiveGameIdForAgent(db, agents.white.id)).toBeNull();
    const created = fresh();
    await insertGame(db, created);
    expect(await findActiveGameIdForAgent(db, agents.white.id)).toBeNull();
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    expect(await findActiveGameIdForAgent(db, agents.white.id)).toBe(created.id);
    expect(await findActiveGameIdForAgent(db, agents.black.id)).toBe(created.id);
    expect(await findActiveGameIdForAgent(db, randomUUID())).toBeNull();
  });

  it("writes the rating columns of a finished game when asked", async () => {
    const created = fresh();
    await insertGame(db, created);
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    const r = applyResign(started.state, agents.black.id, T0 + 5);
    if (!r.ok) throw new Error(r.code);
    await db.transaction((tx) =>
      persistTransition(tx, started.state, r.state, r.events, {
        pgn: "1-0",
        ratings: { whiteBefore: 1500, whiteAfter: 1610.5, blackBefore: 1500, blackAfter: 1389.5 },
      }),
    );
    const [row] = await db.select().from(games).where(eq(games.id, created.id));
    expect(row).toMatchObject({
      status: "finished",
      pgn: "1-0",
      whiteRatingBefore: 1500,
      whiteRatingAfter: 1610.5,
      blackRatingBefore: 1500,
      blackRatingAfter: 1389.5,
    });
  });

  it("can seed two agents with distinct owners", async () => {
    const shared = await seedTwoAgents(db);
    const distinct = await seedTwoAgents(db, { owners: "distinct" });
    const owners = await loadAgentSummaries(db, distinct.white.id, distinct.black.id);
    expect(owners).not.toBeNull();
    const rows = await db.query.agents.findMany({
      where: (t, { inArray }) =>
        inArray(t.id, [shared.white.id, shared.black.id, distinct.white.id, distinct.black.id]),
    });
    const ownerOf = (id: string): string | undefined => rows.find((r) => r.id === id)?.ownerId;
    expect(ownerOf(shared.white.id)).toBe(ownerOf(shared.black.id));
    expect(ownerOf(distinct.white.id)).not.toBe(ownerOf(distinct.black.id));
  });
});
