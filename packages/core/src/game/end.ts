import { resultForWinner } from "../chess/rules.js";
import { MIN_PLIES_FOR_RATED_RESULT, NETWORK_GRACE_MS } from "../protocol/enums.js";
import {
  agentColor,
  endedEvent,
  finishState,
  opponentOf,
  sideToMove,
  type GameState,
  type Transition,
} from "./state.js";

export type EndResult =
  | ({ ok: true } & Transition)
  | { ok: false; code: "game_not_active" | "deadline_not_reached" | "not_a_player"; state: GameState };

export function applyTimeout(state: GameState, now: number): EndResult {
  if (state.status !== "active" || state.moveDeadlineAt === null) {
    return { ok: false, code: "game_not_active", state };
  }
  if (now < state.moveDeadlineAt + NETWORK_GRACE_MS) {
    return { ok: false, code: "deadline_not_reached", state };
  }
  if (state.ply < MIN_PLIES_FOR_RATED_RESULT) {
    const aborted = finishState(state, "*", "aborted", now);
    return { ok: true, state: aborted, events: [endedEvent(aborted)] };
  }
  const loser = sideToMove(state);
  const finished = finishState(state, resultForWinner(opponentOf(loser)), "timeout", now);
  return { ok: true, state: finished, events: [endedEvent(finished)] };
}

export function applyResign(state: GameState, agentId: string, now: number): EndResult {
  if (state.status !== "active") {
    return { ok: false, code: "game_not_active", state };
  }
  const color = agentColor(state, agentId);
  if (color === null) {
    return { ok: false, code: "not_a_player", state };
  }
  const finished = finishState(state, resultForWinner(opponentOf(color)), "resignation", now);
  return { ok: true, state: finished, events: [endedEvent(finished)] };
}
