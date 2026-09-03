import { createDb, type Database } from "@aichess/db";
import {
  EventBus,
  GameService,
  createDeadlineQueue,
  createRedis,
  type DeadlineQueue,
  type RuntimeLogger,
} from "@aichess/runtime";
import type { Redis } from "ioredis";
import type { ApiConfig } from "./config.js";

export interface AppDeps {
  config: ApiConfig;
  db: Database;
  redis: Redis;
  bus: EventBus;
  deadlines: DeadlineQueue;
  service: GameService;
}

export interface DepsHandle {
  deps: AppDeps;
  close: () => Promise<void>;
}

export async function createDeps(config: ApiConfig, logger: RuntimeLogger): Promise<DepsHandle> {
  const dbHandle = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  await redis.connect();
  const queueConnection = createRedis(config.REDIS_URL);
  await queueConnection.connect();
  const bus = await EventBus.connect(config.REDIS_URL, logger);
  const deadlines = createDeadlineQueue(queueConnection);
  const service = new GameService({
    db: dbHandle.db,
    bus,
    deadlines,
    logger,
    config: {
      timePerMoveMs: config.DEFAULT_TIME_PER_MOVE_MS,
      moveLimitPlies: config.MOVE_LIMIT_PLIES,
      illegalAttemptsPerTurn: config.ILLEGAL_ATTEMPTS_PER_TURN,
    },
  });
  return {
    deps: { config, db: dbHandle.db, redis, bus, deadlines, service },
    close: async () => {
      await deadlines.close();
      await queueConnection.quit();
      await bus.close();
      await redis.quit();
      await dbHandle.close();
    },
  };
}
