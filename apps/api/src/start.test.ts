import { createServer } from "node:net";
import { startTestDatabase, type TestDatabase } from "@aichess/db/testing";
import { createDeadlineQueue, createRedis, deadlineJobId } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { startServer } from "./start.js";
import { TEST_INTERNAL_TOKEN } from "./test-utils/harness.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

describe("startServer", () => {
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

  it("listens, serves health, re-arms deadlines on boot and stops cleanly", async () => {
    const port = await freePort();
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
      LOG_LEVEL: "silent",
    });
    const logger = pino({ level: "silent" });

    const first = await startServer(config, logger);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);

    const agents = await seedTwoAgents(first.deps.db);
    const created = await fetch(`${base}/v1/internal/games`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": TEST_INTERNAL_TOKEN },
      body: JSON.stringify({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id }),
    });
    expect(created.status).toBe(201);
    const gameId = ((await created.json()) as { id: string }).id;
    await first.stop();
    expect(first.deps.redis.status).toBe("end");
    await expect(fetch(`${base}/health`)).rejects.toThrow();

    const connection = createRedis(redis.url);
    await connection.connect();
    const queue = createDeadlineQueue(connection);
    await queue.obliterate({ force: true });
    expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeUndefined();

    const second = await startServer(config, logger);
    expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeDefined();
    await second.stop();
    await queue.close();
    await connection.quit();
  });

  it("cleans up when the port is taken", async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    const config = loadConfig({
      DATABASE_URL: tdb.url,
      REDIS_URL: redis.url,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
    });
    await expect(startServer(config, pino({ level: "silent" }))).rejects.toThrow(/EADDRINUSE/);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});
