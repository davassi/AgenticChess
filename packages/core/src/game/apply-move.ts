import { detectBoardTermination, legalMoves, resultForWinner, tryMove } from "../chess/rules.js";
import { MAX_COMMENT_LENGTH, type Color, type IllegalReason } from "../protocol/enums.js";
import type { LegalMove } from "../protocol/schemas.js";
import {
  agentColor,
  endedEvent,
  finishState,
  opponentOf,
  sideToMove,
  type DomainEvent,
  type GameState,
  type MoveRecord,
} from "./state.js";

export interface MoveCommand {
  agentId: string;
  ply: number;
  move: string;
  comment?: string | null | undefined;
  now: number;
}

export type ApplyMoveResult =
  | { ok: true; state: GameState; events: DomainEvent[]; idempotent: boolean }
  | { ok: false; code: "game_not_active" | "not_a_player" | "not_your_turn" | "stale_ply"; state: GameState }
  | {
      ok: false;
      code: "illegal_move";
      reason: IllegalReason;
      attemptsLeft: number;
      legalMoves: LegalMove[];
      state: GameState;
      events: DomainEvent[];
    };

function normalizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null;
  const trimmed = comment.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_COMMENT_LENGTH ? trimmed.slice(0, MAX_COMMENT_LENGTH) : trimmed;
}

function isReplayOfRecordedMove(state: GameState, color: Color, ply: number, input: string): boolean {
  const prior = state.moves[ply];
  const fenBefore = state.fenHistory[ply];
  if (prior === undefined || fenBefore === undefined || prior.color !== color) return false;
  const parsed = tryMove(fenBefore, input);
  return parsed.ok && parsed.move.uci === prior.uci;
}

function rejectIllegal(state: GameState, color: Color, cmd: MoveCommand, reason: IllegalReason): ApplyMoveResult {
  const attempts = state.illegalAttemptsThisTurn + 1;
  const attemptsLeft = Math.max(0, state.config.illegalAttemptsPerTurn - attempts);
  const legal = legalMoves(state.fen);
  const attemptEvent: DomainEvent = {
    type: "illegal_attempt",
    color,
    ply: state.ply,
    submitted: cmd.move,
    reason,
    attemptsLeft,
  };
  const counted: GameState = { ...state, illegalAttemptsThisTurn: attempts };

  if (attemptsLeft === 0) {
    const finished = finishState(counted, resultForWinner(opponentOf(color)), "illegal_moves", cmd.now);
    return {
      ok: false,
      code: "illegal_move",
      reason,
      attemptsLeft,
      legalMoves: legal,
      state: finished,
      events: [attemptEvent, endedEvent(finished)],
    };
  }
  return { ok: false, code: "illegal_move", reason, attemptsLeft, legalMoves: legal, state: counted, events: [attemptEvent] };
}

export function applyMove(state: GameState, cmd: MoveCommand): ApplyMoveResult {
  if (state.status !== "active") return { ok: false, code: "game_not_active", state };

  const color = agentColor(state, cmd.agentId);
  if (color === null) return { ok: false, code: "not_a_player", state };

  if (cmd.ply < state.ply) {
    if (isReplayOfRecordedMove(state, color, cmd.ply, cmd.move)) {
      return { ok: true, state, events: [], idempotent: true };
    }
    return { ok: false, code: "stale_ply", state };
  }
  if (cmd.ply > state.ply) return { ok: false, code: "stale_ply", state };
  if (color !== sideToMove(state)) return { ok: false, code: "not_your_turn", state };

  const parsed = tryMove(state.fen, cmd.move);
  if (!parsed.ok) return rejectIllegal(state, color, cmd, parsed.reason);

  const turnStartedAt = state.turnStartedAt ?? cmd.now;
  const record: MoveRecord = {
    ply: state.ply + 1,
    color,
    san: parsed.move.san,
    uci: parsed.move.uci,
    fenAfter: parsed.move.fenAfter,
    comment: normalizeComment(cmd.comment),
    thinkTimeMs: Math.max(0, cmd.now - turnStartedAt),
    illegalAttemptsBefore: state.illegalAttemptsThisTurn,
  };
  const fenHistory = [...state.fenHistory, record.fenAfter];
  const advanced: GameState = {
    ...state,
    fen: record.fenAfter,
    fenHistory,
    ply: record.ply,
    moves: [...state.moves, record],
    illegalAttemptsThisTurn: 0,
  };
  const moveEvent: DomainEvent = { type: "move", record };

  const board = detectBoardTermination(advanced.fen, fenHistory);
  if (board !== null) {
    const result = board === "checkmate" ? resultForWinner(color) : "1/2-1/2";
    const finished = finishState(advanced, result, board, cmd.now);
    return { ok: true, idempotent: false, state: finished, events: [moveEvent, endedEvent(finished)] };
  }
  if (advanced.ply >= advanced.config.moveLimitPlies) {
    const finished = finishState(advanced, "1/2-1/2", "move_limit", cmd.now);
    return { ok: true, idempotent: false, state: finished, events: [moveEvent, endedEvent(finished)] };
  }

  const deadlineAt = cmd.now + state.config.timePerMoveMs;
  const next: GameState = { ...advanced, turnStartedAt: cmd.now, moveDeadlineAt: deadlineAt };
  return {
    ok: true,
    idempotent: false,
    state: next,
    events: [
      moveEvent,
      {
        type: "turn",
        color: opponentOf(color),
        ply: next.ply,
        deadlineAt,
        attemptsLeft: next.config.illegalAttemptsPerTurn,
      },
    ],
  };
}
