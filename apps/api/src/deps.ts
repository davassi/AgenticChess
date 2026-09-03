import { createRuntime, type RuntimeHandle, type RuntimeLogger } from "@aichess/runtime";
import type { FastifyBaseLogger } from "fastify";
import type { ApiConfig } from "./config.js";

export interface AppDeps extends Omit<RuntimeHandle, "close"> {
  config: ApiConfig;
  logger?: FastifyBaseLogger;
}

export interface DepsHandle {
  deps: AppDeps;
  close: () => Promise<void>;
}

function asSharedLogger(logger: RuntimeLogger): FastifyBaseLogger | undefined {
  const candidate = logger as { child?: unknown };
  return typeof candidate.child === "function" ? (logger as unknown as FastifyBaseLogger) : undefined;
}

export async function createDeps(config: ApiConfig, logger: RuntimeLogger): Promise<DepsHandle> {
  const runtime = await createRuntime(
    {
      databaseUrl: config.DATABASE_URL,
      redisUrl: config.REDIS_URL,
      game: {
        timePerMoveMs: config.DEFAULT_TIME_PER_MOVE_MS,
        moveLimitPlies: config.MOVE_LIMIT_PLIES,
        illegalAttemptsPerTurn: config.ILLEGAL_ATTEMPTS_PER_TURN,
      },
    },
    logger,
  );
  const shared = asSharedLogger(logger);
  return {
    deps: {
      config,
      db: runtime.db,
      redis: runtime.redis,
      bus: runtime.bus,
      deadlines: runtime.deadlines,
      service: runtime.service,
      ...(shared === undefined ? {} : { logger: shared }),
    },
    close: runtime.close,
  };
}
