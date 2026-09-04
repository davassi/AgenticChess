import type { LegalMove, WireEvent } from "@aichess/core/protocol";

export type YourTurnEvent = Extract<WireEvent, { type: "game.your_turn" }>;

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
