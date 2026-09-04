import type { GameConfig } from "@aichess/core/protocol";
import { createDb, type Database } from "@aichess/db";
import type { Redis } from "ioredis";
import { EventBus, createRedis } from "./events/bus.js";
import { GameService } from "./games/service.js";
import { createDeadlineQueue, type DeadlineQueue } from "./jobs/deadlines.js";
import type { RuntimeLogger } from "./logger.js";
import { MatchmakingQueue } from "./matchmaking/queue.js";
import { MatchmakingService } from "./matchmaking/service.js";

export interface RuntimeConfig {
  databaseUrl: string;
  redisUrl: string;
  game: GameConfig;
  dbPoolMax?: number;
}

export interface RuntimeHandle {
  db: Database;
  redis: Redis;
  bus: EventBus;
  deadlines: DeadlineQueue;
  service: GameService;
  queue: MatchmakingQueue;
  matchmaking: MatchmakingService;
  close: () => Promise<void>;
}

async function connectOrThrow(redis: Redis): Promise<void> {
  try {
    await redis.connect();
  } catch (error) {
    redis.disconnect();
    throw error;
  }
}

export async function createRuntime(config: RuntimeConfig, logger: RuntimeLogger): Promise<RuntimeHandle> {
  const dbHandle = createDb(config.databaseUrl, config.dbPoolMax === undefined ? {} : { max: config.dbPoolMax });
  const redis = createRedis(config.redisUrl);
  const queueConnection = createRedis(config.redisUrl);
  redis.on("error", (error: Error) => logger.error({ err: error, connection: "general" }, "redis error"));
  queueConnection.on("error", (error: Error) => logger.error({ err: error, connection: "queue" }, "redis error"));
  let bus: EventBus | null = null;
  try {
    await connectOrThrow(redis);
    await connectOrThrow(queueConnection);
    bus = await EventBus.connect(config.redisUrl, logger);
  } catch (error) {
    redis.disconnect();
    queueConnection.disconnect();
    await dbHandle.close();
    throw error;
  }
  const deadlines = createDeadlineQueue(queueConnection);
  const service = new GameService({ db: dbHandle.db, bus, deadlines, logger, config: config.game });
  const queue = new MatchmakingQueue(redis);
  const matchmaking = new MatchmakingService({ db: dbHandle.db, queue, bus, logger });
  const openBus = bus;
  let closed = false;
  return {
    db: dbHandle.db,
    redis,
    bus: openBus,
    deadlines,
    service,
    queue,
    matchmaking,
    close: async () => {
      if (closed) return;
      closed = true;
      await deadlines.close();
      await queueConnection.quit();
      await openBus.close();
      await redis.quit();
      await dbHandle.close();
    },
  };
}
