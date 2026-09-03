import type { Color, GameResult, GameStatus, IllegalReason, Termination } from "../protocol/enums.js";
import type { GameConfig } from "../protocol/schemas.js";

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  fenAfter: string;
  comment: string | null;
  thinkTimeMs: number;
  illegalAttemptsBefore: number;
}

export interface GameState {
  id: string;
  whiteAgentId: string;
  blackAgentId: string;
  status: GameStatus;
  config: GameConfig;
  fen: string;
  fenHistory: string[];
  ply: number;
  moves: MoveRecord[];
  turnStartedAt: number | null;
  moveDeadlineAt: number | null;
  illegalAttemptsThisTurn: number;
  result: GameResult | null;
  termination: Termination | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type DomainEvent =
  | { type: "started"; startedAt: number }
  | { type: "turn"; color: Color; ply: number; deadlineAt: number; attemptsLeft: number }
  | { type: "move"; record: MoveRecord }
  | {
      type: "illegal_attempt";
      color: Color;
      ply: number;
      submitted: string;
      reason: IllegalReason;
      attemptsLeft: number;
    }
  | { type: "ended"; result: GameResult; termination: Termination; finishedAt: number };

export interface Transition {
  state: GameState;
  events: DomainEvent[];
}

export class InvalidTransitionError extends Error {
  readonly action: string;
  readonly status: GameStatus;

  constructor(action: string, status: GameStatus) {
    super(`Cannot ${action} a game in status "${status}"`);
    this.name = "InvalidTransitionError";
    this.action = action;
    this.status = status;
  }
}

export function sideToMove(state: Pick<GameState, "ply">): Color {
  return state.ply % 2 === 0 ? "white" : "black";
}

export function opponentOf(color: Color): Color {
  return color === "white" ? "black" : "white";
}

export function agentColor(state: Pick<GameState, "whiteAgentId" | "blackAgentId">, agentId: string): Color | null {
  if (agentId === state.whiteAgentId) return "white";
  if (agentId === state.blackAgentId) return "black";
  return null;
}

export function finishState(
  state: GameState,
  result: GameResult,
  termination: Termination,
  finishedAt: number,
): GameState {
  return {
    ...state,
    status: termination === "aborted" ? "aborted" : "finished",
    result,
    termination,
    finishedAt,
    turnStartedAt: null,
    moveDeadlineAt: null,
  };
}

export function endedEvent(state: GameState): DomainEvent {
  if (state.result === null || state.termination === null || state.finishedAt === null) {
    throw new InvalidTransitionError("emit ended event for", state.status);
  }
  return {
    type: "ended",
    result: state.result,
    termination: state.termination,
    finishedAt: state.finishedAt,
  };
}
