import type { QueueMode, QueueStanding, QueueStatus, WireEvent } from "@aichess/core/protocol";
import type { Database } from "@aichess/db";
import type { EventBus } from "../events/bus.js";
import { findActiveGameIdForAgent } from "../games/repository.js";
import type { RuntimeLogger } from "../logger.js";
import { loadRating } from "../rating/repository.js";
import { countPairableOpponents } from "./pairing.js";
import { loadQueueAgents } from "./repository.js";
import type { MatchmakingQueue, QueueMembership } from "./queue.js";

export interface MatchmakingServiceDeps {
  db: Database;
  queue: MatchmakingQueue;
  bus: EventBus;
  logger: RuntimeLogger;
  now?: () => number;
}

export type JoinQueueResult =
  | { ok: true; queuedAt: number; mode: QueueMode; opponents: number }
  | { ok: false; code: "already_in_queue" | "in_active_game" };

export type LeaveQueueResult = { ok: true; queuedAt: number; mode: QueueMode } | { ok: false; code: "not_in_queue" };

export function toQueueStatus(membership: QueueMembership): QueueStatus {
  return { queuedAt: new Date(membership.queuedAt).toISOString(), mode: membership.mode };
}

export function toQueueStanding(membership: QueueMembership, opponents: number): QueueStanding {
  return { ...toQueueStatus(membership), opponents };
}

export class MatchmakingService {
  private readonly now: () => number;

  constructor(private readonly deps: MatchmakingServiceDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** Defaults to the rated queue: that is what every client shipped so far asks for. */
  async join(agentId: string, mode: QueueMode = "rated"): Promise<JoinQueueResult> {
    if ((await findActiveGameIdForAgent(this.deps.db, agentId)) !== null) {
      return { ok: false, code: "in_active_game" };
    }
    const rating = await loadRating(this.deps.db, agentId);
    const queuedAt = this.now();
    const added = await this.deps.queue.join(agentId, rating.rating, queuedAt, mode);
    if (!added) return { ok: false, code: "already_in_queue" };
    const opponents = await this.countOpponents(agentId, mode);
    await this.notify(agentId, { type: "queue.joined", ...toQueueStanding({ queuedAt, mode }, opponents) });
    return { ok: true, queuedAt, mode, opponents };
  }

  async leave(agentId: string): Promise<LeaveQueueResult> {
    const removed = await this.deps.queue.leave(agentId);
    if (removed === null) return { ok: false, code: "not_in_queue" };
    await this.notify(agentId, { type: "queue.left", ...toQueueStatus(removed) });
    return { ok: true, queuedAt: removed.queuedAt, mode: removed.mode };
  }

  status(agentId: string): Promise<QueueMembership | null> {
    return this.deps.queue.status(agentId);
  }

  /** The membership an agent is shown, with the count that says whether waiting can work. */
  async standing(agentId: string): Promise<QueueStanding | null> {
    const membership = await this.deps.queue.status(agentId);
    if (membership === null) return null;
    return toQueueStanding(membership, await this.countOpponents(agentId, membership.mode));
  }

  /**
   * Counted from the queue as it stands, without the liveness checks the
   * matchmaker applies before pairing: a queue holding only agents that have
   * gone offline reports them until the next sweep drops them. That keeps this
   * to one extra read on a path an agent hits twice per game, and the number is
   * an answer to "can anyone here be my opponent", which liveness does not
   * change - a stale entry means somebody was there a moment ago, not that the
   * queue is structurally empty.
   */
  private async countOpponents(agentId: string, mode: QueueMode): Promise<number> {
    const entries = await this.deps.queue.entries(mode);
    const rows = await loadQueueAgents(
      this.deps.db,
      entries.map((entry) => entry.agentId),
    );
    const waiting = entries.flatMap((entry) => {
      const row = rows.get(entry.agentId);
      return row === undefined ? [] : [{ agentId: entry.agentId, ownerId: row.ownerId, isHouse: row.isHouse }];
    });
    return countPairableOpponents(waiting, agentId, mode === "unrated");
  }

  private async notify(agentId: string, event: WireEvent): Promise<void> {
    try {
      await this.deps.bus.publishToAgent(agentId, event);
    } catch (error) {
      this.deps.logger.error({ agentId, type: event.type, error }, "queue_event_publish_failed");
    }
  }
}
