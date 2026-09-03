import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { createRuntime, noopLogger, type RuntimeHandle } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { startWorker } from "./start.js";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("startWorker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;

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

  it("expires deadlines, serves health and stops cleanly", async () => {
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      LOG_LEVEL: "silent",
      WORKER_HEALTH_PORT: "0",
      WORKER_HEALTH_HOST: "127.0.0.1",
      RECONCILE_INTERVAL_MS: "1000",
    });
    const worker = await startWorker(config, pino({ level: "silent" }));
    try {
      expect((await fetch(`http://127.0.0.1:${worker.healthPort}/health`)).status).toBe(200);
      const agents = await seedTwoAgents(runtime.db);
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_000 },
      });
      if (!created.ok) throw new Error(created.code);
      await waitFor(async () => (await runtime.service.getSnapshot(created.snapshot.id))?.status === "aborted", 8_000);
    } finally {
      await worker.stop();
    }
    await expect(fetch(`http://127.0.0.1:${worker.healthPort}/health`)).rejects.toThrow();
  });
});
