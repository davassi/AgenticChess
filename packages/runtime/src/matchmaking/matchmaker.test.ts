import { DEFAULT_GAME_CONFIG, type QueueMode, type WireEvent } from "@aichess/core/protocol";
import { agents, games, ratings } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { presenceKeyFor } from "../presence.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { MATCHMAKING_LOCK_KEY, Matchmaker, startMatchmaker, type MatchmakerDeps } from "./matchmaker.js";
import { MatchmakingService } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Matchmaker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let pair: GameAgents;
  let clock: number;
  let mm: MatchmakingService;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
  });

  afterAll(async () => {
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(runtime.db);
    await runtime.redis.flushdb();
    pair = await seedTwoAgents(runtime.db, { owners: "distinct" });
    clock = T0;
    mm = new MatchmakingService({
      db: runtime.db,
      queue: runtime.queue,
      bus: runtime.bus,
      logger: noopLogger,
      now: () => clock,
    });
  });

  function matchmaker(overrides: Partial<MatchmakerDeps> = {}): Matchmaker {
    return new Matchmaker({
      db: runtime.db,
      redis: runtime.redis,
      queue: runtime.queue,
      matchmaking: mm,
      games: runtime.service,
      logger: noopLogger,
      offlineGraceMs: 15_000,
      now: () => clock,
      ...overrides,
    });
  }

  async function online(...ids: string[]): Promise<void> {
    for (const id of ids) await runtime.redis.set(presenceKeyFor(id), "1", "EX", 60);
  }

  async function join(agentId: string, mode: QueueMode = "rated"): Promise<void> {
    const r = await mm.join(agentId, mode);
    if (!r.ok) throw new Error(r.code);
  }

  it("pairs two online agents of different owners and starts a game", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);

    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
    expect(await runtime.queue.size("rated")).toBe(0);
    const game = await runtime.service.activeGameFor(pair.white.id);
    expect(game).not.toBeNull();
    expect(game?.white.id).toBe(pair.white.id);
    expect(game?.black.id).toBe(pair.black.id);
    expect((await runtime.service.activeGameFor(pair.black.id))?.id).toBe(game?.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 0, paired: 0, dropped: 0 });
  });

  it("never pairs two agents of the same owner", async () => {
    const sameOwner = await seedTwoAgents(runtime.db);
    await online(sameOwner.white.id, sameOwner.black.id);
    await join(sameOwner.white.id);
    await join(sameOwner.black.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    expect(await runtime.queue.size("rated")).toBe(2);
  });

  it("waits for an offline agent during the grace period, then drops it and tells it", async () => {
    const seen: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(pair.black.id, (e) => seen.push(e));
    await online(pair.white.id);
    await join(pair.white.id);
    await join(pair.black.id);
    const m = matchmaker({ offlineGraceMs: 1_000 });

    clock = T0 + 500;
    expect(await m.runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    expect(await runtime.queue.size("rated")).toBe(2);

    clock = T0 + 1_000;
    expect(await m.runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 1 });
    expect(await runtime.queue.status(pair.black.id)).toBeNull();
    expect(await runtime.queue.status(pair.white.id)).toEqual({ queuedAt: T0, mode: "rated" });
    await waitFor(() => seen.some((e) => e.type === "queue.left"));
    expect(seen.find((e) => e.type === "queue.left")).toEqual({
      type: "queue.left",
      queuedAt: new Date(T0).toISOString(),
      mode: "rated",
    });
    await off();
  });

  it("drops suspended agents and agents that are already playing", async () => {
    const extra = await seedTwoAgents(runtime.db, { owners: "distinct" });
    await online(pair.white.id, pair.black.id, extra.white.id);
    await join(pair.white.id);
    await join(pair.black.id);
    await join(extra.white.id);
    await runtime.db.update(agents).set({ status: "suspended" }).where(eq(agents.id, pair.black.id));
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: pair.white.id,
      blackAgentId: extra.white.id,
    });
    expect(created.ok).toBe(true);

    expect(await matchmaker().runOnce()).toEqual({ scanned: 3, paired: 0, dropped: 3 });
    expect(await runtime.queue.size("rated")).toBe(0);
  });

  it("widens the rating window with the wait", async () => {
    await runtime.db.insert(ratings).values({ agentId: pair.black.id, rating: 1900, rd: 60, volatility: 0.06 });
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    await join(pair.black.id);
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });
    clock = T0 + 40_000;
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
  });

  it("alternates colours with the previous game", async () => {
    const first = await runtime.service.createAndStartGame({
      whiteAgentId: pair.white.id,
      blackAgentId: pair.black.id,
    });
    if (!first.ok) throw new Error(first.code);
    await runtime.service.resign({ gameId: first.snapshot.id, agentId: pair.black.id });

    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);
    // The first game moved both ratings by about 160 points each way, beyond the initial window.
    clock = T0 + 30_000;
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 1, dropped: 0 });
    const game = await runtime.service.activeGameFor(pair.white.id);
    expect(game?.white.id).toBe(pair.black.id);
    expect(game?.black.id).toBe(pair.white.id);
  });

  it("puts both agents back when the game cannot be created", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    clock = T0 + 1;
    await join(pair.black.id);
    const failing = matchmaker({
      games: {
        createAndStartGame: async () => {
          throw new Error("db down");
        },
      },
    });
    await expect(failing.runOnce()).rejects.toThrow("db down");
    const entries = (await runtime.queue.entries("rated")).sort((a, b) => a.queuedAt - b.queuedAt);
    expect(entries).toEqual([
      { agentId: pair.white.id, rating: 1500, queuedAt: T0, mode: "rated" },
      { agentId: pair.black.id, rating: 1500, queuedAt: T0 + 1, mode: "rated" },
    ]);
  });

  it("runs on its interval under the shared lock", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id);
    await join(pair.black.id);
    const loop = startMatchmaker({
      redis: runtime.redis,
      matchmaker: matchmaker(),
      logger: noopLogger,
      intervalMs: 200,
    });
    try {
      await waitFor(async () => (await runtime.service.activeGameFor(pair.white.id)) !== null);
    } finally {
      await loop.stop();
    }
    expect(await runtime.redis.exists(MATCHMAKING_LOCK_KEY)).toBe(0);
  });

  it("pairs inside a mode and never across", async () => {
    await online(pair.white.id, pair.black.id);
    await join(pair.white.id, "rated");
    await join(pair.black.id, "unrated");
    expect(await matchmaker().runOnce()).toEqual({ scanned: 2, paired: 0, dropped: 0 });

    await mm.leave(pair.white.id);
    await join(pair.white.id, "unrated");
    expect((await matchmaker().runOnce()).paired).toBe(1);

    const rows = await runtime.db.select().from(games);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rated).toBe(false);
  });

  it("lets an owner face themselves in the unrated queue", async () => {
    const sameOwner = await seedTwoAgents(runtime.db);
    await online(sameOwner.white.id, sameOwner.black.id);
    await join(sameOwner.white.id, "unrated");
    await join(sameOwner.black.id, "unrated");
    expect((await matchmaker().runOnce()).paired).toBe(1);
    expect(await runtime.queue.size("unrated")).toBe(0);
    const [game] = await runtime.db.select().from(games);
    expect(game?.rated).toBe(false);
  });
});
