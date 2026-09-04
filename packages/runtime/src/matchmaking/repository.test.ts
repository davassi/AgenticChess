import { randomUUID } from "node:crypto";
import { applyResign, createGame, startGame } from "@aichess/core";
import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { agents, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { insertGame, persistTransition } from "../games/repository.js";
import { seedTwoAgents } from "../testing.js";
import { listAgentsInActiveGames, loadLastColors, loadQueueAgents } from "./repository.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

describe("matchmaking repository", () => {
  let tdb: TestDatabase;
  let db: Database;
  let pair: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    pair = await seedTwoAgents(db, { owners: "distinct" });
  });

  async function activeGame(whiteAgentId: string, blackAgentId: string, now: number): Promise<string> {
    const created = createGame({ id: randomUUID(), whiteAgentId, blackAgentId, config: DEFAULT_GAME_CONFIG, now });
    await insertGame(db, created);
    const started = startGame(created, now);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    return created.id;
  }

  it("loads owner and status for the given agents only", async () => {
    await db.update(agents).set({ status: "suspended" }).where(eq(agents.id, pair.black.id));
    const rows = await loadQueueAgents(db, [pair.white.id, pair.black.id, randomUUID()]);
    expect(rows.size).toBe(2);
    expect(rows.get(pair.white.id)).toMatchObject({ id: pair.white.id, status: "active" });
    expect(rows.get(pair.black.id)).toMatchObject({ status: "suspended" });
    expect(rows.get(pair.white.id)?.ownerId).not.toBe(rows.get(pair.black.id)?.ownerId);
    expect(await loadQueueAgents(db, [])).toEqual(new Map());
  });

  it("lists the agents that are in an active game", async () => {
    const other = await seedTwoAgents(db);
    expect(await listAgentsInActiveGames(db, [pair.white.id, pair.black.id])).toEqual(new Set());
    const created = createGame({
      id: randomUUID(),
      whiteAgentId: pair.white.id,
      blackAgentId: other.white.id,
      config: DEFAULT_GAME_CONFIG,
      now: T0,
    });
    await insertGame(db, created);
    expect(await listAgentsInActiveGames(db, [pair.white.id])).toEqual(new Set());
    const started = startGame(created, T0);
    await db.transaction((tx) => persistTransition(tx, created, started.state, started.events, {}));
    expect(await listAgentsInActiveGames(db, [pair.white.id, pair.black.id, other.white.id])).toEqual(
      new Set([pair.white.id, other.white.id]),
    );
    const resigned = applyResign(started.state, pair.white.id, T0 + 1);
    if (!resigned.ok) throw new Error(resigned.code);
    await db.transaction((tx) => persistTransition(tx, started.state, resigned.state, resigned.events, {}));
    expect(await listAgentsInActiveGames(db, [pair.white.id, other.white.id])).toEqual(new Set());
    expect(await listAgentsInActiveGames(db, [])).toEqual(new Set());
  });

  it("finds the colour of each agent's most recent game", async () => {
    const other = await seedTwoAgents(db);
    await activeGame(pair.white.id, pair.black.id, T0);
    await activeGame(other.white.id, pair.white.id, T0 + 1_000);
    const colors = await loadLastColors(db, [pair.white.id, pair.black.id, other.white.id, other.black.id]);
    expect(colors.get(pair.white.id)).toBe("black");
    expect(colors.get(pair.black.id)).toBe("black");
    expect(colors.get(other.white.id)).toBe("white");
    expect(colors.has(other.black.id)).toBe(false);
    expect(await loadLastColors(db, [])).toEqual(new Map());
  });
});
