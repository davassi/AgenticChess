import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { DelayedError } from "bullmq";
import { createDeadlineWorker, processDeadline } from "./deadline-worker.js";
import { DeadlineNotReachedError, deadlineJobId, scheduleDeadline } from "./deadlines.js";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("deadline worker", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let workerConnection: Redis;
  let agents: GameAgents;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
    workerConnection = createRedis(redis.url);
    await workerConnection.connect();
  });

  afterAll(async () => {
    await workerConnection.quit();
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(runtime.db);
    await runtime.deadlines.obliterate({ force: true });
    agents = await seedTwoAgents(runtime.db);
  });

  it("moves an early job to delayed when the worker token is present", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    if (!created.ok) throw new Error(created.code);
    const moved: number[] = [];
    await expect(
      processDeadline(
        {
          id: "x",
          attemptsMade: 0,
          data: { gameId: created.snapshot.id, ply: 0 },
          moveToDelayed: async (timestamp) => {
            moved.push(timestamp);
          },
        },
        runtime.service,
        noopLogger,
        "token",
      ),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moved).toHaveLength(1);
  });

  it("throws DeadlineNotReachedError for an early job so BullMQ retries it later", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    if (!created.ok) throw new Error(created.code);
    await expect(
      processDeadline(
        { id: "x", attemptsMade: 0, data: { gameId: created.snapshot.id, ply: 0 } },
        runtime.service,
        noopLogger,
      ),
    ).rejects.toBeInstanceOf(DeadlineNotReachedError);
  });

  it("aborts a game nobody played once the clock runs out", async () => {
    const worker = createDeadlineWorker({ connection: workerConnection, service: runtime.service, logger: noopLogger });
    try {
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_000 },
      });
      if (!created.ok) throw new Error(created.code);
      const gameId = created.snapshot.id;
      await waitFor(async () => (await runtime.service.getSnapshot(gameId))?.status === "aborted", 8_000);
      expect(await runtime.service.getSnapshot(gameId)).toMatchObject({ status: "aborted", termination: "aborted" });
    } finally {
      await worker.close();
    }
  });

  it("makes the side on move lose after both have played, even if the job was scheduled early", async () => {
    const worker = createDeadlineWorker({ connection: workerConnection, service: runtime.service, logger: noopLogger });
    try {
      const created = await runtime.service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 1_500 },
      });
      if (!created.ok) throw new Error(created.code);
      const gameId = created.snapshot.id;
      const w = await runtime.service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" });
      if (!w.ok) throw new Error(w.code);
      const b = await runtime.service.submitMove({ gameId, agentId: agents.black.id, ply: 1, move: "e5" });
      if (!b.ok) throw new Error(b.code);
      await runtime.deadlines.remove(deadlineJobId(gameId, 2));
      await scheduleDeadline(runtime.deadlines, { gameId, ply: 2 }, Date.now() - 10_000, Date.now());
      await waitFor(async () => (await runtime.service.getSnapshot(gameId))?.status === "finished", 8_000);
      expect(await runtime.service.getSnapshot(gameId)).toMatchObject({
        status: "finished",
        result: "0-1",
        termination: "timeout",
      });
    } finally {
      await worker.close();
    }
  });
});
