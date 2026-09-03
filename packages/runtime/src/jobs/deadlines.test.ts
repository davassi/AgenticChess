import { randomUUID } from "node:crypto";
import { NETWORK_GRACE_MS } from "@aichess/core/protocol";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import {
  DEADLINE_JOB_NAME,
  createDeadlineQueue,
  deadlineFireAt,
  deadlineJobId,
  scheduleDeadline,
  type DeadlineQueue,
} from "./deadlines.js";

describe("deadline jobs", () => {
  let redis: TestRedis;
  let connection: Redis;
  let queue: DeadlineQueue;

  beforeAll(async () => {
    redis = await startTestRedis();
    connection = createRedis(redis.url);
    await connection.connect();
    queue = createDeadlineQueue(connection);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    await redis.stop();
  });

  it("derives a stable id and fire time", () => {
    expect(deadlineJobId("g1", 4)).toBe("deadline-g1-4");
    expect(deadlineFireAt(1_000)).toBe(1_000 + NETWORK_GRACE_MS);
  });

  it("schedules a delayed job with the grace period", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 0 }, now + 10_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 0));
    expect(job?.name).toBe(DEADLINE_JOB_NAME);
    expect(job?.data).toEqual({ gameId, ply: 0 });
    expect(job?.opts.delay).toBe(10_000 + NETWORK_GRACE_MS);
    expect(await job?.getState()).toBe("delayed");
  });

  it("is idempotent for the same game and ply", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 3 }, now + 5_000, now);
    await scheduleDeadline(queue, { gameId, ply: 3 }, now + 9_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 3));
    expect(job?.opts.delay).toBe(5_000 + NETWORK_GRACE_MS);
    const delayed = await queue.getDelayed();
    expect(delayed.filter((j) => j.data.gameId === gameId)).toHaveLength(1);
  });

  it("never uses a negative delay for a deadline already in the past", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 1 }, now - 60_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 1));
    expect(job?.opts.delay).toBe(0);
    expect(await job?.getState()).toBe("waiting");
  });
});
