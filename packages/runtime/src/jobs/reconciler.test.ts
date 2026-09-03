import { DEFAULT_GAME_CONFIG, type WireEvent } from "@aichess/core/protocol";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { RECONCILE_LOCK_KEY, startReconciler } from "./reconciler.js";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("reconciler", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let agents: GameAgents;

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
    await runtime.deadlines.obliterate({ force: true });
    await runtime.redis.del(RECONCILE_LOCK_KEY);
    agents = await seedTwoAgents(runtime.db);
  });

  it("lets only one instance run a sweep at a time and releases the lock afterwards", async () => {
    const make = (id: string): ReturnType<typeof startReconciler> =>
      startReconciler({
        redis: runtime.redis,
        service: runtime.service,
        logger: noopLogger,
        intervalMs: 60_000,
        staleTurnMs: 60_000,
        instanceId: id,
      });
    const a = make("a");
    const b = make("b");
    try {
      const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
      expect([ra, rb].filter((r) => r !== null)).toHaveLength(1);
      expect(await runtime.redis.exists(RECONCILE_LOCK_KEY)).toBe(0);
      expect(await b.runOnce()).toEqual({ scanned: 0, republished: 0, rescheduled: 0 });
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("re-publishes a stalled turn on its interval", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    if (!created.ok) throw new Error(created.code);
    const white: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => white.push(e));
    await new Promise((resolve) => setTimeout(resolve, 150));
    white.length = 0;
    const reconciler = startReconciler({
      redis: runtime.redis,
      service: runtime.service,
      logger: noopLogger,
      intervalMs: 200,
      staleTurnMs: 100,
    });
    try {
      await waitFor(() => white.some((e) => e.type === "game.your_turn"), 3_000);
      expect(white.find((e) => e.type === "game.your_turn")).toMatchObject({ gameId: created.snapshot.id, ply: 0 });
    } finally {
      await reconciler.stop();
      await off();
    }
  });
});
