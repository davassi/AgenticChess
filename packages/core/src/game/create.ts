import { START_FEN } from "../chess/rules.js";
import type { GameConfig } from "../protocol/schemas.js";
import { InvalidTransitionError, sideToMove, type GameState, type Transition } from "./state.js";

export interface CreateGameInput {
  id: string;
  whiteAgentId: string;
  blackAgentId: string;
  config: GameConfig;
  now: number;
}

export function createGame(input: CreateGameInput): GameState {
  return {
    id: input.id,
    whiteAgentId: input.whiteAgentId,
    blackAgentId: input.blackAgentId,
    status: "created",
    config: { ...input.config },
    fen: START_FEN,
    fenHistory: [START_FEN],
    ply: 0,
    moves: [],
    turnStartedAt: null,
    moveDeadlineAt: null,
    illegalAttemptsThisTurn: 0,
    result: null,
    termination: null,
    createdAt: input.now,
    startedAt: null,
    finishedAt: null,
  };
}

export function startGame(state: GameState, now: number): Transition {
  if (state.status !== "created") {
    throw new InvalidTransitionError("start", state.status);
  }
  const deadlineAt = now + state.config.timePerMoveMs;
  const next: GameState = {
    ...state,
    status: "active",
    startedAt: now,
    turnStartedAt: now,
    moveDeadlineAt: deadlineAt,
    illegalAttemptsThisTurn: 0,
  };
  return {
    state: next,
    events: [
      { type: "started", startedAt: now },
      {
        type: "turn",
        color: sideToMove(next),
        ply: next.ply,
        deadlineAt,
        attemptsLeft: next.config.illegalAttemptsPerTurn,
      },
    ],
  };
}
