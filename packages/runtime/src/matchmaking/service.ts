import type { QueueStatus, WireEvent } from "@aichess/core/protocol";
import type { Database } from "@aichess/db";
import type { EventBus } from "../events/bus.js";
import { findActiveGameIdForAgent } from "../games/repository.js";
import type { RuntimeLogger } from "../logger.js";
import { loadRating } from "../rating/repository.js";
import type { MatchmakingQueue, QueueMembership } from "./queue.js";

export interface MatchmakingServiceDeps {
  db: Database;
  queue: MatchmakingQueue;
  bus: EventBus;
  logger: RuntimeLogger;
  now?: () => number;
}

export type JoinQueueResult =
  { ok: true; queuedAt: number } | { ok: false; code: "already_in_queue" | "in_active_game" };

export type LeaveQueueResult = { ok: true; queuedAt: number } | { ok: false; code: "not_in_queue" };

export function toQueueStatus(membership: QueueMembership): QueueStatus {
  return { queuedAt: new Date(membership.queuedAt).toISOString() };
}

export class MatchmakingService {
  private readonly now: () => number;

  constructor(private readonly deps: MatchmakingServiceDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  async join(agentId: string): Promise<JoinQueueResult> {
    if ((await findActiveGameIdForAgent(this.deps.db, agentId)) !== null) {
      return { ok: false, code: "in_active_game" };
    }
    const rating = await loadRating(this.deps.db, agentId);
    const queuedAt = this.now();
    const added = await this.deps.queue.join(agentId, rating.rating, queuedAt);
    if (!added) return { ok: false, code: "already_in_queue" };
    await this.notify(agentId, { type: "queue.joined", ...toQueueStatus({ queuedAt }) });
    return { ok: true, queuedAt };
  }

  async leave(agentId: string): Promise<LeaveQueueResult> {
    const removed = await this.deps.queue.leave(agentId);
    if (removed === null) return { ok: false, code: "not_in_queue" };
    await this.notify(agentId, { type: "queue.left", ...toQueueStatus(removed) });
    return { ok: true, queuedAt: removed.queuedAt };
  }

  status(agentId: string): Promise<QueueMembership | null> {
    return this.deps.queue.status(agentId);
  }

  private async notify(agentId: string, event: WireEvent): Promise<void> {
    try {
      await this.deps.bus.publishToAgent(agentId, event);
    } catch (error) {
      this.deps.logger.error({ agentId, type: event.type, error }, "queue_event_publish_failed");
    }
  }
}
