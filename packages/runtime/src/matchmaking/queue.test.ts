import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { MatchmakingQueue, QUEUE_KEY, QUEUE_META_KEY } from "./queue.js";

describe("MatchmakingQueue", () => {
  let container: TestRedis;
  let redis: Redis;
  let queue: MatchmakingQueue;

  beforeAll(async () => {
    container = await startTestRedis();
    redis = createRedis(container.url);
    await redis.connect();
    queue = new MatchmakingQueue(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await queue.clear();
  });

  it("joins once per agent and lists entries by rating", async () => {
    expect(await queue.join("a", 1500, 10)).toBe(true);
    expect(await queue.join("a", 1600, 11)).toBe(false);
    expect(await queue.join("b", 1400, 12)).toBe(true);
    expect(await queue.entries()).toEqual([
      { agentId: "b", rating: 1400, queuedAt: 12 },
      { agentId: "a", rating: 1500, queuedAt: 10 },
    ]);
    expect(await queue.size()).toBe(2);
    expect(await queue.status("a")).toEqual({ queuedAt: 10 });
    expect(await queue.status("nobody")).toBeNull();
  });

  it("leaves with the original queuedAt and refuses a second leave", async () => {
    await queue.join("a", 1500, 10);
    expect(await queue.leave("a")).toEqual({ queuedAt: 10 });
    expect(await queue.leave("a")).toBeNull();
    expect(await queue.status("a")).toBeNull();
    expect(await redis.hlen(QUEUE_META_KEY)).toBe(0);
    expect(await redis.zcard(QUEUE_KEY)).toBe(0);
  });

  it("removes a pair only while both are still queued", async () => {
    await queue.join("a", 1500, 1);
    await queue.join("b", 1500, 2);
    expect(await queue.removePair("a", "c")).toBe(false);
    expect(await queue.entries()).toHaveLength(2);
    expect(await queue.removePair("a", "b")).toBe(true);
    expect(await queue.size()).toBe(0);
    expect(await queue.removePair("a", "b")).toBe(false);
  });

  it("clears everything", async () => {
    await queue.join("a", 1500, 1);
    await queue.clear();
    expect(await queue.entries()).toEqual([]);
    expect(await redis.exists(QUEUE_KEY, QUEUE_META_KEY)).toBe(0);
  });
});
