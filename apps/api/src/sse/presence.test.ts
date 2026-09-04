import { randomUUID } from "node:crypto";
import { createRedis } from "@aichess/runtime";
import { startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearPresent, isPresent, markPresent, presenceKeyFor } from "./presence.js";

describe("presence", () => {
  let redis: TestRedis;
  let client: Redis;
  let agentId: string;

  beforeAll(async () => {
    redis = await startTestRedis();
    client = createRedis(redis.url);
    await client.connect();
  });

  afterAll(async () => {
    await client.quit();
    await redis.stop();
  });

  beforeEach(async () => {
    agentId = randomUUID();
    await client.flushall();
  });

  it("stays online when one of two instances disconnects", async () => {
    await markPresent(client, agentId, "a", 30);
    await markPresent(client, agentId, "b", 30);
    expect(await isPresent(client, agentId)).toBe(true);
    await clearPresent(client, agentId, "a");
    expect(await isPresent(client, agentId)).toBe(true);
    await clearPresent(client, agentId, "b");
    expect(await isPresent(client, agentId)).toBe(false);
    expect(await client.exists(presenceKeyFor(agentId))).toBe(0);
  });
});
