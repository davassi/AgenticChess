import { randomUUID } from "node:crypto";
import {
  applyMove,
  applyResign,
  applyTimeout,
  createGame,
  sideToMove,
  startGame,
  toPgn,
  type DomainEvent,
  type GameState,
} from "@aichess/core";
import type { GameConfig, GameSnapshot, IllegalReason, LegalMove, WireEvent } from "@aichess/core/protocol";
import type { Database, Transaction } from "@aichess/db";
import type { EventBus, GameParties } from "../events/bus.js";
import {
  NO_RATING_CHANGES,
  toSnapshot,
  toWireEvents,
  toYourTurn,
  type GameAgents,
  type Outgoing,
  type WireExtras,
} from "../events/wire.js";
import { deadlineFireAt, deadlineJobId, scheduleDeadline, type DeadlineQueue } from "../jobs/deadlines.js";
import type { RuntimeLogger } from "../logger.js";
import { settleRatings } from "../rating/settle.js";
import {
  findActiveGameIdForAgent,
  insertGame,
  listActiveDeadlines,
  loadAgentSummaries,
  loadGame,
  loadGameForUpdate,
  persistTransition,
  type Executor,
} from "./repository.js";

export interface GameServiceDeps {
  db: Database;
  bus: EventBus;
  deadlines: DeadlineQueue;
  config: GameConfig;
  logger: RuntimeLogger;
  now?: () => number;
  newId?: () => string;
}

export interface CreateGameInput {
  whiteAgentId: string;
  blackAgentId: string;
  config?: Partial<GameConfig>;
}

export type CreateGameResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "agents_not_found" };

export interface SubmitMoveInput {
  gameId: string;
  agentId: string;
  ply: number;
  move: string;
  comment?: string | null;
}

export type SubmitMoveResult =
  | { ok: true; idempotent: boolean; snapshot: GameSnapshot }
  | { ok: false; code: "not_found" | "game_not_active" | "not_your_turn" | "stale_ply" }
  | {
      ok: false;
      code: "illegal_move";
      reason: IllegalReason;
      attemptsLeft: number;
      legalMoves: LegalMove[];
      snapshot: GameSnapshot;
    };

export interface ResignInput {
  gameId: string;
  agentId: string;
}

export type ResignResult = { ok: true; snapshot: GameSnapshot } | { ok: false; code: "not_found" | "game_not_active" };

export interface ExpireInput {
  gameId: string;
  ply: number;
}

export type ExpireResult =
  | { ok: true; applied: true; snapshot: GameSnapshot }
  | { ok: true; applied: false; reason: "stale_ply" | "not_active" }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "deadline_not_reached"; fireAt: number };

export interface ReconcileInput {
  staleTurnMs: number;
}

export interface ReconcileReport {
  scanned: number;
  republished: number;
  rescheduled: number;
}

type PostCommit = () => Promise<void>;

interface TxOutcome<T> {
  result: T;
  postCommit: PostCommit | null;
}

function partiesOf(state: GameState): GameParties {
  return { gameId: state.id, whiteAgentId: state.whiteAgentId, blackAgentId: state.blackAgentId };
}

function isOver(state: GameState): boolean {
  return state.status === "finished" || state.status === "aborted";
}

export class GameService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: GameServiceDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    this.newId = deps.newId ?? ((): string => randomUUID());
  }

  async createAndStartGame(input: CreateGameInput): Promise<CreateGameResult> {
    const agents = await loadAgentSummaries(this.deps.db, input.whiteAgentId, input.blackAgentId);
    if (agents === null) return { ok: false, code: "agents_not_found" };

    const now = this.now();
    const config: GameConfig = { ...this.deps.config, ...input.config };
    const created = createGame({
      id: this.newId(),
      whiteAgentId: input.whiteAgentId,
      blackAgentId: input.blackAgentId,
      config,
      now,
    });
    const started = startGame(created, now);
    const extras = await this.deps.db.transaction(async (tx) => {
      await insertGame(tx, created);
      return this.commitTransition(tx, created, started.state, started.events, agents);
    });
    await this.afterCommit(started.state, agents, started.events, extras);
    return { ok: true, snapshot: toSnapshot(started.state, agents) };
  }

  async getSnapshot(gameId: string, viewerAgentId?: string): Promise<GameSnapshot | null> {
    const state = await loadGame(this.deps.db, gameId);
    if (state === null) return null;
    const agents = await this.agentsOf(this.deps.db, state);
    return toSnapshot(state, agents, viewerAgentId);
  }

  async submitMove(input: SubmitMoveInput): Promise<SubmitMoveResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<SubmitMoveResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      const agents = await this.agentsOf(tx, state);
      const r = applyMove(state, {
        agentId: input.agentId,
        ply: input.ply,
        move: input.move,
        comment: input.comment,
        now: this.now(),
      });

      if (r.ok) {
        if (r.idempotent) {
          return {
            result: { ok: true, idempotent: true, snapshot: toSnapshot(r.state, agents, input.agentId) },
            postCommit: null,
          };
        }
        const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
        return {
          result: { ok: true, idempotent: false, snapshot: toSnapshot(r.state, agents, input.agentId) },
          postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
        };
      }

      if (r.code === "illegal_move") {
        const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
        return {
          result: {
            ok: false,
            code: "illegal_move",
            reason: r.reason,
            attemptsLeft: r.attemptsLeft,
            legalMoves: r.legalMoves,
            snapshot: toSnapshot(r.state, agents, input.agentId),
          },
          postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
        };
      }

      const code = r.code === "not_a_player" ? "not_found" : r.code;
      return { result: { ok: false, code }, postCommit: null };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async resign(input: ResignInput): Promise<ResignResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<ResignResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      const agents = await this.agentsOf(tx, state);
      const r = applyResign(state, input.agentId, this.now());
      if (!r.ok) {
        const code = r.code === "not_a_player" ? "not_found" : "game_not_active";
        return { result: { ok: false, code }, postCommit: null };
      }
      const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
      return {
        result: { ok: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
      };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async expireDeadline(input: ExpireInput): Promise<ExpireResult> {
    const outcome = await this.deps.db.transaction(async (tx): Promise<TxOutcome<ExpireResult>> => {
      const state = await loadGameForUpdate(tx, input.gameId);
      if (state === null) return { result: { ok: false, code: "not_found" }, postCommit: null };
      if (state.status !== "active" || state.moveDeadlineAt === null) {
        return { result: { ok: true, applied: false, reason: "not_active" }, postCommit: null };
      }
      if (state.ply !== input.ply) {
        return { result: { ok: true, applied: false, reason: "stale_ply" }, postCommit: null };
      }
      const r = applyTimeout(state, this.now());
      if (!r.ok) {
        if (r.code === "deadline_not_reached") {
          return {
            result: { ok: false, code: "deadline_not_reached", fireAt: deadlineFireAt(state.moveDeadlineAt) },
            postCommit: null,
          };
        }
        return { result: { ok: true, applied: false, reason: "not_active" }, postCommit: null };
      }
      const agents = await this.agentsOf(tx, state);
      const extras = await this.commitTransition(tx, state, r.state, r.events, agents);
      return {
        result: { ok: true, applied: true, snapshot: toSnapshot(r.state, agents) },
        postCommit: () => this.afterCommit(r.state, agents, r.events, extras),
      };
    });
    if (outcome.postCommit !== null) await outcome.postCommit();
    return outcome.result;
  }

  async rearmActiveDeadlines(): Promise<number> {
    const rows = await listActiveDeadlines(this.deps.db);
    const now = this.now();
    for (const row of rows) {
      await scheduleDeadline(this.deps.deadlines, { gameId: row.gameId, ply: row.ply }, row.moveDeadlineAt, now);
    }
    if (rows.length > 0) {
      this.deps.logger.info({ count: rows.length }, "deadlines re-armed");
    }
    return rows.length;
  }

  async activeGameFor(agentId: string): Promise<GameSnapshot | null> {
    const gameId = await findActiveGameIdForAgent(this.deps.db, agentId);
    if (gameId === null) return null;
    return this.getSnapshot(gameId, agentId);
  }

  async yourTurnFor(agentId: string): Promise<WireEvent | null> {
    const gameId = await findActiveGameIdForAgent(this.deps.db, agentId);
    if (gameId === null) return null;
    const state = await loadGame(this.deps.db, gameId);
    if (state === null) return null;
    const color = state.whiteAgentId === agentId ? "white" : "black";
    return toYourTurn(state, color);
  }

  async reconcile(input: ReconcileInput): Promise<ReconcileReport> {
    const rows = await listActiveDeadlines(this.deps.db);
    const now = this.now();
    const report: ReconcileReport = { scanned: rows.length, republished: 0, rescheduled: 0 };
    for (const row of rows) {
      const job = await this.deps.deadlines.getJob(deadlineJobId(row.gameId, row.ply));
      if (job === undefined) {
        await scheduleDeadline(this.deps.deadlines, { gameId: row.gameId, ply: row.ply }, row.moveDeadlineAt, now);
        report.rescheduled += 1;
      }
      const state = await loadGame(this.deps.db, row.gameId);
      if (state === null || state.status !== "active" || state.turnStartedAt === null) continue;
      if (now - state.turnStartedAt < input.staleTurnMs) continue;
      const color = sideToMove(state);
      const event = toYourTurn(state, color);
      if (event === null) continue;
      const outgoing: Outgoing = { toWhite: [], toBlack: [], toPublic: [] };
      (color === "white" ? outgoing.toWhite : outgoing.toBlack).push(event);
      try {
        await this.deps.bus.publish(partiesOf(state), outgoing);
        report.republished += 1;
      } catch (error) {
        this.deps.logger.error({ gameId: state.id, error }, "reconcile_publish_failed");
      }
    }
    if (report.republished > 0 || report.rescheduled > 0) {
      this.deps.logger.info({ ...report }, "reconcile applied");
    }
    return report;
  }

  private async agentsOf(ex: Executor, state: GameState): Promise<GameAgents> {
    const agents = await loadAgentSummaries(ex, state.whiteAgentId, state.blackAgentId);
    if (agents === null) {
      throw new Error(`agents missing for game ${state.id}`);
    }
    return agents;
  }

  private async commitTransition(
    tx: Transaction,
    before: GameState,
    after: GameState,
    events: DomainEvent[],
    agents: GameAgents,
  ): Promise<WireExtras> {
    if (!isOver(after)) {
      await persistTransition(tx, before, after, events, {});
      return { pgn: null, ratings: NO_RATING_CHANGES };
    }
    const pgn = toPgn(after, {
      white: agents.white.name,
      black: agents.black.name,
      date: new Date(after.startedAt ?? after.createdAt),
    });
    const settled = await settleRatings(tx, after, this.now());
    await persistTransition(tx, before, after, events, settled === null ? { pgn } : { pgn, ratings: settled.columns });
    return { pgn, ratings: settled === null ? NO_RATING_CHANGES : settled.changes };
  }

  private async afterCommit(
    state: GameState,
    agents: GameAgents,
    events: DomainEvent[],
    extras: WireExtras,
  ): Promise<void> {
    const outgoing = toWireEvents(state, agents, events, extras);
    try {
      await this.deps.bus.publish(partiesOf(state), outgoing);
    } catch (error) {
      this.deps.logger.error({ gameId: state.id, error }, "game_events_publish_failed");
    }
    for (const event of events) {
      if (event.type !== "turn") continue;
      try {
        await scheduleDeadline(this.deps.deadlines, { gameId: state.id, ply: event.ply }, event.deadlineAt, this.now());
      } catch (error) {
        this.deps.logger.error({ gameId: state.id, ply: event.ply, error }, "deadline_schedule_failed");
      }
    }
  }
}
