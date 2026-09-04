import type { GameSnapshot, TimelineAttempt, TimelineMove, WireEvent } from "@aichess/core/protocol";

export interface LiveGame {
  snapshot: GameSnapshot;
  moves: TimelineMove[];
  attempts: TimelineAttempt[];
  finished: boolean;
  /** A move arrived that could not continue the list: the list is short. */
  gap: boolean;
}

/**
 * The events after which the API closes the connection: the end of the game,
 * and the opening snapshot of a game that was already over when the browser
 * connected. An EventSource the page does not close itself reconnects to a
 * closed stream for ever.
 */
export function endsTheStream(event: WireEvent): boolean {
  if (event.type === "game.end") return true;
  return event.type === "game.snapshot" && (event.game.status === "finished" || event.game.status === "aborted");
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
      const snapshot: GameSnapshot = {
        ...state.snapshot,
        fen: event.fen,
        ply: event.ply,
        history: [...state.snapshot.history, event.san],
        turn: event.color === "white" ? "black" : "white",
      };
      // The stream carries only what happens next, so a move played between
      // the server render and the subscription arrives inside the snapshot and
      // never as an event of its own. Appending the move after it would put a
      // hole in the list, and the positions replayed past a hole are wrong.
      // The list keeps what it can prove and says that it is short;
      // useGameStream reads the whole timeline back once to repair it.
      if (event.ply !== state.moves.length + 1) return { ...state, snapshot, gap: true };
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
      return { ...state, snapshot, moves: [...state.moves, move] };
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
          // A game nobody ever moved in is aborted, not finished, and the
          // difference is what tells the page to say so instead of reading a
          // null result as a win for black.
          status: event.termination === "aborted" ? "aborted" : "finished",
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
