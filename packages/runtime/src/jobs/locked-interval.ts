import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { RuntimeLogger } from "../logger.js";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const MIN_LOCK_TTL_MS = 1_000;

export interface LockedIntervalInput<T> {
  redis: Redis;
  lockKey: string;
  name: string;
  intervalMs: number;
  lockTtlMs?: number;
  instanceId?: string;
  logger: RuntimeLogger;
  run: () => Promise<T>;
}

export interface LockedInterval<T> {
  runOnce(): Promise<T | null>;
  stop(): Promise<void>;
}

export function startLockedInterval<T>(input: LockedIntervalInput<T>): LockedInterval<T> {
  const instanceId = input.instanceId ?? randomUUID();
  const lockTtlMs = input.lockTtlMs ?? Math.max(input.intervalMs, MIN_LOCK_TTL_MS);
  let inFlight: Promise<T | null> | null = null;

  const runOnce = async (): Promise<T | null> => {
    const acquired = await input.redis.set(input.lockKey, instanceId, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await input.run();
    } finally {
      await input.redis.eval(RELEASE_SCRIPT, 1, input.lockKey, instanceId);
    }
  };

  const tick = (): void => {
    if (inFlight !== null) return;
    inFlight = runOnce()
      .catch((error: unknown) => {
        input.logger.error({ err: error, job: input.name }, "locked interval run failed");
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(tick, input.intervalMs);
  return {
    runOnce,
    stop: async () => {
      clearInterval(timer);
      if (inFlight !== null) await inFlight;
    },
  };
}
