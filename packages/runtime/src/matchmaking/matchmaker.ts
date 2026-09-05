import type { Database } from "@aichess/db";
import type { Redis } from "ioredis";
import type { GameService } from "../games/service.js";
import { startLockedInterval, type LockedInterval } from "../jobs/locked-interval.js";
import type { RuntimeLogger } from "../logger.js";
import { presenceKeyFor } from "../presence.js";
import { DEFAULT_PAIRING_WINDOW, pairCandidates, type Candidate, type Pair, type PairingWindow } from "./pairing.js";
import type { MatchmakingQueue, QueueEntry } from "./queue.js";
import { listAgentsInActiveGames, loadLastColors, loadQueueAgents, type QueueAgent } from "./repository.js";
import type { MatchmakingService } from "./service.js";

export const MATCHMAKING_LOCK_KEY = "lock:matchmaking";

export interface MatchmakerDeps {
  db: Database;
  redis: Redis;
  queue: MatchmakingQueue;
  matchmaking: Pick<MatchmakingService, "leave">;
  games: Pick<GameService, "createAndStartGame">;
  logger: RuntimeLogger;
  offlineGraceMs: number;
  now?: () => number;
  window?: PairingWindow;
}

export interface PairingReport {
  scanned: number;
  paired: number;
  dropped: number;
}

export type DropReason = "unavailable" | "in_active_game" | "offline";

export class Matchmaker {
  private readonly now: () => number;
  private readonly window: PairingWindow;

  constructor(private readonly deps: MatchmakerDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    this.window = deps.window ?? DEFAULT_PAIRING_WINDOW;
  }

  async runOnce(): Promise<PairingReport> {
    const entries = await this.deps.queue.entries("rated");
    const report: PairingReport = { scanned: entries.length, paired: 0, dropped: 0 };
    if (entries.length === 0) return report;

    const ids = entries.map((entry) => entry.agentId);
    const [rows, busy, online, lastColors] = await Promise.all([
      loadQueueAgents(this.deps.db, ids),
      listAgentsInActiveGames(this.deps.db, ids),
      this.onlineAgents(ids),
      loadLastColors(this.deps.db, ids),
    ]);
    const now = this.now();

    const candidates: Candidate[] = [];
    for (const entry of entries) {
      const row = rows.get(entry.agentId);
      const reason = this.dropReason(entry, row, busy, online, now);
      if (reason !== null) {
        await this.drop(entry, reason);
        report.dropped += 1;
        continue;
      }
      if (row === undefined || !online.has(entry.agentId)) continue;
      candidates.push({
        agentId: entry.agentId,
        ownerId: row.ownerId,
        rating: entry.rating,
        queuedAt: entry.queuedAt,
        lastColor: lastColors.get(entry.agentId) ?? null,
      });
    }

    for (const pair of pairCandidates(candidates, now, this.window)) {
      if (await this.startGame(pair)) report.paired += 1;
    }
    if (report.paired > 0 || report.dropped > 0) {
      this.deps.logger.info({ ...report }, "matchmaking applied");
    }
    return report;
  }

  private dropReason(
    entry: QueueEntry,
    row: QueueAgent | undefined,
    busy: Set<string>,
    online: Set<string>,
    now: number,
  ): DropReason | null {
    if (row === undefined || row.status !== "active") return "unavailable";
    if (busy.has(entry.agentId)) return "in_active_game";
    if (!online.has(entry.agentId) && now - entry.queuedAt >= this.deps.offlineGraceMs) return "offline";
    return null;
  }

  private async onlineAgents(ids: string[]): Promise<Set<string>> {
    const pipeline = this.deps.redis.pipeline();
    for (const id of ids) pipeline.exists(presenceKeyFor(id));
    const results = await pipeline.exec();
    const online = new Set<string>();
    results?.forEach(([error, value], index) => {
      const id = ids[index];
      if (error === null && value === 1 && id !== undefined) online.add(id);
    });
    return online;
  }

  private async drop(entry: QueueEntry, reason: DropReason): Promise<void> {
    const result = await this.deps.matchmaking.leave(entry.agentId);
    if (result.ok) {
      this.deps.logger.info({ agentId: entry.agentId, reason }, "removed from queue");
    }
  }

  private async startGame(pair: Pair): Promise<boolean> {
    const white = pair.white.agentId;
    const black = pair.black.agentId;
    const removed = await this.deps.queue.removePair(white, black, "rated");
    if (!removed) return false;
    try {
      const created = await this.deps.games.createAndStartGame({ whiteAgentId: white, blackAgentId: black });
      if (!created.ok) {
        this.deps.logger.warn({ white, black, code: created.code }, "pairing skipped");
        return false;
      }
      this.deps.logger.info({ gameId: created.snapshot.id, white, black }, "paired");
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error, white, black }, "game creation failed, requeueing pair");
      await this.requeue(pair.white);
      await this.requeue(pair.black);
      throw error;
    }
  }

  private async requeue(candidate: Candidate): Promise<void> {
    try {
      await this.deps.queue.join(candidate.agentId, candidate.rating, candidate.queuedAt, "rated");
    } catch (error) {
      this.deps.logger.error({ err: error, agentId: candidate.agentId }, "requeue failed");
    }
  }
}

export interface MatchmakerLoopInput {
  redis: Redis;
  matchmaker: Matchmaker;
  logger: RuntimeLogger;
  intervalMs: number;
  lockTtlMs?: number;
  instanceId?: string;
}

export type MatchmakerLoop = LockedInterval<PairingReport>;

export function startMatchmaker(input: MatchmakerLoopInput): MatchmakerLoop {
  return startLockedInterval({
    redis: input.redis,
    lockKey: MATCHMAKING_LOCK_KEY,
    name: "matchmaking",
    intervalMs: input.intervalMs,
    logger: input.logger,
    ...(input.lockTtlMs === undefined ? {} : { lockTtlMs: input.lockTtlMs }),
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    run: () => input.matchmaker.runOnce(),
  });
}
