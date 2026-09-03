import { NETWORK_GRACE_MS } from "@aichess/core/protocol";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const DEADLINES_QUEUE = "deadlines";
export const DEADLINE_JOB_NAME = "expire";

export interface DeadlineJobData {
  gameId: string;
  ply: number;
}

export type DeadlineQueue = Queue<DeadlineJobData>;

export function deadlineJobId(gameId: string, ply: number): string {
  return `deadline-${gameId}-${ply}`;
}

export function deadlineFireAt(moveDeadlineAt: number): number {
  return moveDeadlineAt + NETWORK_GRACE_MS;
}

export function createDeadlineQueue(connection: Redis): DeadlineQueue {
  return new Queue<DeadlineJobData>(DEADLINES_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  });
}

export async function scheduleDeadline(
  queue: DeadlineQueue,
  data: DeadlineJobData,
  moveDeadlineAt: number,
  now: number,
): Promise<void> {
  const delay = Math.max(0, deadlineFireAt(moveDeadlineAt) - now);
  await queue.add(DEADLINE_JOB_NAME, data, { jobId: deadlineJobId(data.gameId, data.ply), delay });
}
