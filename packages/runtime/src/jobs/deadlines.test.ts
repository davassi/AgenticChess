import { randomUUID } from "node:crypto";
import { NETWORK_GRACE_MS } from "@aichess/core/protocol";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { forceJobFailed, startTestRedis, type TestRedis } from "../testing.js";
import {
  DEADLINE_JOB_NAME,
  DEADLINES_QUEUE,
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

  it("retries an early job exactly at its fire time and backs off exponentially otherwise", async () => {
    const { DeadlineNotReachedError, deadlineBackoffStrategy } = await import("./deadlines.js");
    const now = (): number => 1_000_000;
    expect(deadlineBackoffStrategy(1, "custom", new DeadlineNotReachedError(1_004_000), now)).toBe(4_000);
    expect(deadlineBackoffStrategy(1, "custom", new DeadlineNotReachedError(999_000), now)).toBe(0);
    expect(deadlineBackoffStrategy(1, "custom", new Error("db down"), now)).toBe(1_000);
    expect(deadlineBackoffStrategy(2, "custom", new Error("db down"), now)).toBe(2_000);
    expect(deadlineBackoffStrategy(10, "custom", undefined, now)).toBe(30_000);
  });

  it("uses the custom backoff by default", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    await scheduleDeadline(queue, { gameId, ply: 0 }, now + 1_000, now);
    const job = await queue.getJob(deadlineJobId(gameId, 0));
    expect(job?.opts.backoff).toEqual({ type: "custom" });
    expect(job?.opts.attempts).toBe(5);
  });

  it("replaces a failed job so the same game and ply can fire again", async () => {
    const gameId = randomUUID();
    const now = Date.now();
    expect(await scheduleDeadline(queue, { gameId, ply: 2 }, now - 60_000, now)).toBe(true);
    const jobId = deadlineJobId(gameId, 2);
    await forceJobFailed(connection, DEADLINES_QUEUE, jobId);
    expect(await (await queue.getJob(jobId))!.getState()).toBe("failed");
    expect(await scheduleDeadline(queue, { gameId, ply: 2 }, now + 8_000, now)).toBe(true);
    const replaced = await queue.getJob(jobId);
    expect(await replaced!.getState()).not.toBe("failed");
    expect(replaced!.opts.delay).toBe(8_000 + NETWORK_GRACE_MS);
  });
});
