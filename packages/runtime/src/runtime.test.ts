import { DEFAULT_GAME_CONFIG } from "@aichess/core/protocol";
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "./logger.js";
import { createRuntime } from "./runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "./testing.js";

describe("createRuntime", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
  });

  afterAll(async () => {
    await redis.stop();
    await tdb.stop();
  });

  it("wires a working service and closes every connection", async () => {
    const runtime = await createRuntime(
      { databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG },
      noopLogger,
    );
    const agents = await seedTwoAgents(runtime.db);
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    expect(created.ok).toBe(true);
    expect(await runtime.redis.ping()).toBe("PONG");
    await runtime.close();
    expect(runtime.redis.status).toBe("end");
    await expect(runtime.redis.ping()).rejects.toThrow();
  });

  it("fails fast when Redis is unreachable", async () => {
    await expect(
      createRuntime({ databaseUrl: tdb.url, redisUrl: "redis://127.0.0.1:1", game: DEFAULT_GAME_CONFIG }, noopLogger),
    ).rejects.toThrow();
  });
});
