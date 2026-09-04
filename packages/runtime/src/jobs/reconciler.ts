import type { Redis } from "ioredis";
import type { GameService, ReconcileReport } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";
import { startLockedInterval, type LockedInterval } from "./locked-interval.js";

export const RECONCILE_LOCK_KEY = "lock:reconcile";

export interface ReconcilerInput {
  redis: Redis;
  service: GameService;
  logger: RuntimeLogger;
  intervalMs: number;
  staleTurnMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export type Reconciler = LockedInterval<ReconcileReport>;

export function startReconciler(input: ReconcilerInput): Reconciler {
  return startLockedInterval({
    redis: input.redis,
    lockKey: RECONCILE_LOCK_KEY,
    name: "reconcile",
    intervalMs: input.intervalMs,
    logger: input.logger,
    ...(input.lockTtlMs === undefined ? {} : { lockTtlMs: input.lockTtlMs }),
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    run: () => input.service.reconcile({ staleTurnMs: input.staleTurnMs }),
  });
}
