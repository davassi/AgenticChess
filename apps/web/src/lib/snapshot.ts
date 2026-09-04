import type { GameListItem, GameSnapshot } from "@aichess/core/protocol";

/**
 * A snapshot carries everything a list item does except when the game was
 * created, so the row helpers can be reused on the game page.
 */
export function toListItem(snapshot: GameSnapshot): GameListItem {
  return {
    id: snapshot.id,
    status: snapshot.status,
    white: snapshot.white,
    black: snapshot.black,
    fen: snapshot.fen,
    ply: snapshot.ply,
    turn: snapshot.turn,
    result: snapshot.result,
    termination: snapshot.termination,
    moveDeadlineAt: snapshot.moveDeadlineAt,
    createdAt: snapshot.startedAt ?? new Date(0).toISOString(),
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
  };
}
