import {
  Matchmaker,
  createDeadlineWorker,
  createRedis,
  createRuntime,
  runtimeConfigFrom,
  startMatchmaker,
  startReconciler,
} from "@aichess/runtime";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health.js";

export interface RunningWorker {
  healthPort: number;
  stop: () => Promise<void>;
}

export async function startWorker(config: WorkerConfig, logger: Logger): Promise<RunningWorker> {
  const runtime = await createRuntime(runtimeConfigFrom(config), logger);
  const workerConnection = createRedis(config.REDIS_URL);
  workerConnection.on("error", (error: Error) => logger.error({ err: error, connection: "worker" }, "redis error"));
  try {
    await workerConnection.connect();
  } catch (error) {
    workerConnection.disconnect();
    await runtime.close();
    throw error;
  }

  const worker = createDeadlineWorker({
    connection: workerConnection,
    service: runtime.service,
    logger,
    concurrency: config.DEADLINE_CONCURRENCY,
  });
  const reconciler = startReconciler({
    redis: runtime.redis,
    service: runtime.service,
    logger,
    intervalMs: config.RECONCILE_INTERVAL_MS,
    staleTurnMs: config.RECONCILE_STALE_TURN_MS,
  });
  const matchmaker = new Matchmaker({
    db: runtime.db,
    redis: runtime.redis,
    queue: runtime.queue,
    matchmaking: runtime.matchmaking,
    games: runtime.service,
    logger,
    offlineGraceMs: config.MATCHMAKING_OFFLINE_GRACE_MS,
  });
  const pairing = startMatchmaker({
    redis: runtime.redis,
    matchmaker,
    logger,
    intervalMs: config.MATCHMAKING_INTERVAL_MS,
  });

  const stopJobs = async (): Promise<void> => {
    await pairing.stop();
    await reconciler.stop();
    await worker.close();
    await workerConnection.quit();
  };

  const rearmed = await runtime.service.rearmActiveDeadlines();
  logger.info({ rearmed }, "deadlines re-armed on boot");

  let health: HealthServer;
  try {
    health = await startHealthServer({
      host: config.WORKER_HEALTH_HOST,
      port: config.WORKER_HEALTH_PORT,
      check: async () => {
        const [db, redis] = await Promise.allSettled([runtime.db.execute(sql`select 1`), runtime.redis.ping()]);
        return db.status === "fulfilled" && redis.status === "fulfilled";
      },
    });
  } catch (error) {
    await stopJobs();
    await runtime.close();
    throw error;
  }

  let stopped = false;
  return {
    healthPort: health.port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopJobs();
      await health.close();
      await runtime.close();
    },
  };
}
