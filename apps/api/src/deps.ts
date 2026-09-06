import { createRuntime, runtimeConfigFrom, type RuntimeHandle, type RuntimeLogger } from "@aichess/runtime";
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
  // Built by `runtimeConfigFrom`, not by hand: the worker already used it, and
  // assembling the same object twice is how MIN_MOVE_INTERVAL_MS came to be
  // parsed, validated and then dropped one line before anything read it.
  const runtime = await createRuntime(runtimeConfigFrom(config), logger);
  const shared = asSharedLogger(logger);
  return {
    deps: {
      config,
      db: runtime.db,
      redis: runtime.redis,
      bus: runtime.bus,
      deadlines: runtime.deadlines,
      service: runtime.service,
      queue: runtime.queue,
      matchmaking: runtime.matchmaking,
      ...(shared === undefined ? {} : { logger: shared }),
    },
    close: runtime.close,
  };
}
