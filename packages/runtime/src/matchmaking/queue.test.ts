import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { MatchmakingQueue, QUEUE_ENTRY_KEY, QUEUE_KEYS } from "./queue.js";

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
    expect(await queue.join("a", 1500, 10, "rated")).toBe(true);
    expect(await queue.join("a", 1600, 11, "rated")).toBe(false);
    expect(await queue.join("b", 1400, 12, "rated")).toBe(true);
    expect(await queue.entries("rated")).toEqual([
      { agentId: "b", rating: 1400, queuedAt: 12, mode: "rated" },
      { agentId: "a", rating: 1500, queuedAt: 10, mode: "rated" },
    ]);
    expect(await queue.size("rated")).toBe(2);
    expect(await queue.status("a")).toEqual({ queuedAt: 10, mode: "rated" });
    expect(await queue.status("nobody")).toBeNull();
  });

  it("keeps the two modes apart and reports the mode back", async () => {
    expect(await queue.join("a", 1500, 10, "rated")).toBe(true);
    expect(await queue.join("b", 1400, 12, "unrated")).toBe(true);
    expect(await queue.entries("rated")).toEqual([{ agentId: "a", rating: 1500, queuedAt: 10, mode: "rated" }]);
    expect(await queue.entries("unrated")).toEqual([{ agentId: "b", rating: 1400, queuedAt: 12, mode: "unrated" }]);
    expect(await queue.size("rated")).toBe(1);
    expect(await queue.size("unrated")).toBe(1);
    expect(await queue.status("b")).toEqual({ queuedAt: 12, mode: "unrated" });
  });

  it("refuses a second queue while the agent is in the first, and leaves without being told which", async () => {
    expect(await queue.join("a", 1500, 10, "rated")).toBe(true);
    expect(await queue.join("a", 1500, 11, "unrated")).toBe(false);
    expect(await queue.leave("a")).toEqual({ queuedAt: 10, mode: "rated" });
    expect(await queue.leave("a")).toBeNull();
    expect(await queue.status("a")).toBeNull();
    expect(await redis.zcard(QUEUE_KEYS.rated)).toBe(0);
    expect(await redis.hlen(QUEUE_ENTRY_KEY)).toBe(0);
  });

  it("leaves an unrated agent from the unrated set", async () => {
    await queue.join("a", 1500, 10, "unrated");
    expect(await queue.leave("a")).toEqual({ queuedAt: 10, mode: "unrated" });
    expect(await redis.zcard(QUEUE_KEYS.unrated)).toBe(0);
    expect(await redis.hlen(QUEUE_ENTRY_KEY)).toBe(0);
  });

  it("removes a pair only while both are still queued", async () => {
    await queue.join("a", 1500, 1, "rated");
    await queue.join("b", 1500, 2, "rated");
    expect(await queue.removePair("a", "c", "rated")).toBe(false);
    expect(await queue.entries("rated")).toHaveLength(2);
    expect(await queue.removePair("a", "b", "rated")).toBe(true);
    expect(await queue.size("rated")).toBe(0);
    expect(await queue.removePair("a", "b", "rated")).toBe(false);
  });

  it("removes a pair only from the mode it was queued in", async () => {
    await queue.join("a", 1500, 1, "unrated");
    await queue.join("b", 1500, 2, "unrated");
    expect(await queue.removePair("a", "b", "rated")).toBe(false);
    expect(await queue.removePair("a", "b", "unrated")).toBe(true);
    expect(await queue.size("unrated")).toBe(0);
  });

  it("clears everything", async () => {
    await queue.join("a", 1500, 1, "rated");
    await queue.join("b", 1500, 1, "unrated");
    await queue.clear();
    expect(await queue.entries("rated")).toEqual([]);
    expect(await queue.entries("unrated")).toEqual([]);
    expect(await redis.exists(QUEUE_KEYS.rated, QUEUE_KEYS.unrated, QUEUE_ENTRY_KEY)).toBe(0);
  });
});
