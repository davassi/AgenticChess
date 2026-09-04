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

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function createDeadlineQueue(connection: Redis): DeadlineQueue {
  return new Queue<DeadlineJobData>(DEADLINES_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: MAX_ATTEMPTS,
      backoff: { type: "custom" },
    },
  });
}

export class DeadlineNotReachedError extends Error {
  readonly fireAt: number;

  constructor(fireAt: number) {
    super(`deadline not reached, fire at ${new Date(fireAt).toISOString()}`);
    this.name = "DeadlineNotReachedError";
    this.fireAt = fireAt;
  }
}

export function deadlineBackoffStrategy(
  attemptsMade: number,
  _type: string | undefined,
  error: Error | undefined,
  now: () => number = (): number => Date.now(),
): number {
  if (error instanceof DeadlineNotReachedError) {
    return Math.max(0, error.fireAt - now());
  }
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptsMade - 1));
}

const TERMINAL_JOB_STATES = new Set(["failed", "completed"]);

export async function scheduleDeadline(
  queue: DeadlineQueue,
  data: DeadlineJobData,
  moveDeadlineAt: number,
  now: number,
): Promise<boolean> {
  const id = deadlineJobId(data.gameId, data.ply);
  const existing = await queue.getJob(id);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (!TERMINAL_JOB_STATES.has(state)) return false;
    await existing.remove();
  }
  const delay = Math.max(0, deadlineFireAt(moveDeadlineAt) - now);
  await queue.add(DEADLINE_JOB_NAME, data, { jobId: id, delay });
  return true;
}
