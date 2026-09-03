import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedis } from "../events/bus.js";
import { noopLogger, type RuntimeLogger } from "../logger.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { startLockedInterval } from "./locked-interval.js";

const LOCK = "lock:test";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("startLockedInterval", () => {
  let container: TestRedis;
  let redis: Redis;

  beforeAll(async () => {
    container = await startTestRedis();
    redis = createRedis(container.url);
    await redis.connect();
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.del(LOCK);
  });

  it("runs one instance at a time and releases the lock afterwards", async () => {
    let running = 0;
    let peak = 0;
    const make = (id: string): ReturnType<typeof startLockedInterval<string>> =>
      startLockedInterval({
        redis,
        lockKey: LOCK,
        name: "test",
        intervalMs: 60_000,
        instanceId: id,
        logger: noopLogger,
        run: async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 100));
          running -= 1;
          return id;
        },
      });
    const a = make("a");
    const b = make("b");
    try {
      const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
      expect([ra, rb].filter((r) => r !== null)).toHaveLength(1);
      expect(peak).toBe(1);
      expect(await redis.exists(LOCK)).toBe(0);
      expect(await b.runOnce()).toBe("b");
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("ticks on its interval and logs a failure without stopping", async () => {
    let calls = 0;
    const errors: Record<string, unknown>[] = [];
    const logger: RuntimeLogger = { ...noopLogger, error: (meta) => void errors.push(meta) };
    const loop = startLockedInterval({
      redis,
      lockKey: LOCK,
      name: "test",
      intervalMs: 50,
      logger,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return calls;
      },
    });
    try {
      await waitFor(() => calls >= 3, 3_000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ job: "test" });
    } finally {
      await loop.stop();
    }
    const after = calls;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(after);
  });
});
