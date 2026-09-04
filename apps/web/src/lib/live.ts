import type { GameSnapshot, TimelineAttempt, TimelineMove, WireEvent } from "@aichess/core/protocol";

export interface LiveGame {
  snapshot: GameSnapshot;
  moves: TimelineMove[];
  attempts: TimelineAttempt[];
  finished: boolean;
}

/**
 * The whole live-update rule, as a pure function. An event that changes
 * nothing returns the same object, so React skips the re-render.
 */
export function applyStreamEvent(state: LiveGame, event: WireEvent): LiveGame {
  switch (event.type) {
    case "game.snapshot":
      return {
        ...state,
        snapshot: event.game,
        finished: event.game.status === "finished" || event.game.status === "aborted",
      };

    case "game.move": {
      if (event.ply <= state.snapshot.ply) return state;
      const move: TimelineMove = {
        ply: event.ply,
        color: event.color,
        san: event.san,
        uci: event.uci,
        fen: event.fen,
        comment: event.comment,
        thinkTimeMs: event.thinkTimeMs,
        at: new Date().toISOString(),
      };
      return {
        ...state,
        moves: [...state.moves, move],
        snapshot: {
          ...state.snapshot,
          fen: event.fen,
          ply: event.ply,
          history: [...state.snapshot.history, event.san],
          turn: event.color === "white" ? "black" : "white",
        },
      };
    }

    case "game.turn":
      return {
        ...state,
        snapshot: { ...state.snapshot, turn: event.color, moveDeadlineAt: event.deadlineAt },
      };

    case "game.illegal_attempt":
      return {
        ...state,
        attempts: [
          ...state.attempts,
          {
            ply: event.ply,
            color: event.color,
            submitted: event.submitted,
            reason: event.reason,
            at: new Date().toISOString(),
          },
        ],
      };

    case "game.end":
      return {
        ...state,
        finished: true,
        snapshot: {
          ...state.snapshot,
          status: "finished",
          result: event.result,
          termination: event.termination,
          moveDeadlineAt: null,
          finishedAt: new Date().toISOString(),
        },
      };

    default:
      // Pings, and the agent-only events a spectator stream never sends.
      return state;
  }
}
