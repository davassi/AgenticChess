import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { ExpireResult, GameService } from "../games/service.js";
import type { RuntimeLogger } from "../logger.js";
import {
  DEADLINES_QUEUE,
  DeadlineNotReachedError,
  deadlineBackoffStrategy,
  type DeadlineJobData,
} from "./deadlines.js";

const DEFAULT_CONCURRENCY = 10;

export type DeadlineJobLike = Pick<Job<DeadlineJobData>, "data" | "id" | "attemptsMade">;

export async function processDeadline(
  job: DeadlineJobLike,
  service: GameService,
  logger: RuntimeLogger,
): Promise<ExpireResult> {
  const result = await service.expireDeadline(job.data);
  if (!result.ok && result.code === "deadline_not_reached") {
    throw new DeadlineNotReachedError(result.fireAt);
  }
  if (result.ok && result.applied) {
    logger.info(
      { jobId: job.id, gameId: job.data.gameId, ply: job.data.ply, termination: result.snapshot.termination },
      "deadline applied",
    );
  }
  return result;
}

export interface DeadlineWorkerInput {
  connection: Redis;
  service: GameService;
  logger: RuntimeLogger;
  concurrency?: number;
}

export function createDeadlineWorker(input: DeadlineWorkerInput): Worker<DeadlineJobData> {
  const worker = new Worker<DeadlineJobData>(
    DEADLINES_QUEUE,
    (job) => processDeadline(job, input.service, input.logger),
    {
      connection: input.connection,
      concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
      settings: {
        backoffStrategy: (attemptsMade: number, type?: string, err?: Error) =>
          deadlineBackoffStrategy(attemptsMade, type, err),
      },
    },
  );
  worker.on("failed", (job, error) => {
    if (error instanceof DeadlineNotReachedError) return;
    input.logger.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err: error }, "deadline job failed");
  });
  worker.on("error", (error) => {
    input.logger.error({ err: error }, "deadline worker error");
  });
  return worker;
}
