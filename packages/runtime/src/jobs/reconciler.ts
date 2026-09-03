import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { GameService, ReconcileReport } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";

export const RECONCILE_LOCK_KEY = "lock:reconcile";

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface ReconcilerInput {
  redis: Redis;
  service: GameService;
  logger: RuntimeLogger;
  intervalMs: number;
  staleTurnMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export interface Reconciler {
  runOnce(): Promise<ReconcileReport | null>;
  stop(): Promise<void>;
}

export function startReconciler(input: ReconcilerInput): Reconciler {
  const instanceId = input.instanceId ?? randomUUID();
  const lockTtlMs = input.lockTtlMs ?? Math.max(input.intervalMs, 1_000);
  let inFlight: Promise<ReconcileReport | null> | null = null;

  const runOnce = async (): Promise<ReconcileReport | null> => {
    const acquired = await input.redis.set(RECONCILE_LOCK_KEY, instanceId, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await input.service.reconcile({ staleTurnMs: input.staleTurnMs });
    } finally {
      await input.redis.eval(RELEASE_SCRIPT, 1, RECONCILE_LOCK_KEY, instanceId);
    }
  };

  const tick = (): void => {
    if (inFlight !== null) return;
    inFlight = runOnce()
      .catch((error: unknown) => {
        input.logger.error({ err: error }, "reconcile failed");
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
