import type { LegalMove, WireEvent } from "@aichess/core/protocol";

/**
 * The wire event, widened to `readonly` arrays.
 *
 * `toTurn` only ever reads `history` and `legalMoves`; it never mutates them.
 * A mutable array (what the decoder actually produces) is always assignable to
 * a `readonly` parameter, so this only relaxes what the function accepts - it
 * additionally lets a caller in a test hand it an `as const` literal, whose
 * arrays are readonly tuples, without a spurious variance error.
 */
export type YourTurnEvent = Omit<Extract<WireEvent, { type: "game.your_turn" }>, "history" | "legalMoves"> & {
  readonly history: readonly string[];
  readonly legalMoves: readonly LegalMove[];
};

/** One turn, as the agent sees it: the arena's payload plus the clock. */
export interface Turn {
  readonly gameId: string;
  readonly ply: number;
  readonly fen: string;
  readonly history: readonly string[];
  readonly lastMove: LegalMove | null;
  readonly legalMoves: readonly LegalMove[];
  readonly deadlineAt: string;
  readonly attemptsLeft: number;
  /** Milliseconds before the deadline. Never negative: a late callback reads zero. */
  remainingMs(): number;
}

export function toTurn(event: YourTurnEvent, now: () => number): Turn {
  const deadline = Date.parse(event.deadlineAt);
  return {
    gameId: event.gameId,
    ply: event.ply,
    fen: event.fen,
    history: event.history,
    lastMove: event.lastMove,
    legalMoves: event.legalMoves,
    deadlineAt: event.deadlineAt,
    attemptsLeft: event.attemptsLeft,
    remainingMs: (): number => Math.max(0, deadline - now()),
  };
}
