import { randomUUID } from "node:crypto";
import { applyGameRatings, applyResign, applyTimeout, createGame, initialRating, startGame } from "@aichess/core";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS } from "@aichess/core/protocol";
import { ratingHistory, ratings, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { insertGame } from "../games/repository.js";
import { seedTwoAgents } from "../testing.js";
import { settleRatings } from "./settle.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("settleRatings", () => {
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

  async function startedGame(
    timePerMoveMs: number = DEFAULT_GAME_CONFIG.timePerMoveMs,
  ): Promise<ReturnType<typeof startGame>> {
    const created = createGame({
      id: randomUUID(),
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
      config: { ...DEFAULT_GAME_CONFIG, timePerMoveMs },
      now: T0,
    });
    await insertGame(db, created);
    return startGame(created, T0);
  }

  it("applies one Glicko-2 period per game to both sides and records history", async () => {
    const { state } = await startedGame();
    const resigned = applyResign(state, agents.white.id, T0 + 5_000);
    if (!resigned.ok) throw new Error(resigned.code);

    const settled = await db.transaction((tx) => settleRatings(tx, resigned.state, T0 + 5_000));
    const expected = applyGameRatings(initialRating(), initialRating(), "0-1");
    if (settled === null || expected === null) throw new Error("expected a rated settlement");

    expect(settled.changes.white?.before).toBe(1500);
    expect(settled.changes.white?.after).toBeCloseTo(expected.white.rating, 6);
    expect(settled.changes.black?.after).toBeCloseTo(expected.black.rating, 6);
    expect(settled.columns).toEqual({
      whiteBefore: 1500,
      whiteAfter: settled.changes.white?.after,
      blackBefore: 1500,
      blackAfter: settled.changes.black?.after,
    });

    const rows = await db.select().from(ratings);
    const white = rows.find((r) => r.agentId === agents.white.id);
    const black = rows.find((r) => r.agentId === agents.black.id);
    expect(white?.rating).toBeCloseTo(expected.white.rating, 6);
    expect(white?.rd).toBeCloseTo(expected.white.rd, 6);
    expect(white?.volatility).toBeCloseTo(expected.white.volatility, 8);
    expect(white?.gamesPlayed).toBe(1);
    expect(white?.lastGameAt?.getTime()).toBe(T0 + 5_000);
    expect(black?.rating).toBeGreaterThan(1500);

    const history = await db.select().from(ratingHistory);
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.agentId === agents.black.id)).toMatchObject({
      gameId: state.id,
      ratingBefore: 1500,
    });
  });

  it("returns null and writes nothing for an aborted game", async () => {
    const { state } = await startedGame(1_000);
    const aborted = applyTimeout(state, T0 + 1_000 + NETWORK_GRACE_MS);
    if (!aborted.ok) throw new Error(aborted.code);
    expect(aborted.state.status).toBe("aborted");
    expect(await db.transaction((tx) => settleRatings(tx, aborted.state, T0 + 2_000))).toBeNull();
    expect(await db.select().from(ratings)).toHaveLength(0);
    expect(await db.select().from(ratingHistory)).toHaveLength(0);
  });

  it("returns null for a game that is still active", async () => {
    const { state } = await startedGame();
    expect(await db.transaction((tx) => settleRatings(tx, state, T0))).toBeNull();
  });
});
