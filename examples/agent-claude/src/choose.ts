import { readMoveFromAnswer, type LegalMove, type MoveChoice, type Turn } from "@agenticchess/sdk";

const MAX_QUOTED = 40;

/** The deterministic fallback: the first move the arena listed. */
export function firstLegal(turn: Turn): MoveChoice {
  const move = turn.legalMoves[0];
  if (move === undefined) throw new Error("The arena offered no legal move");
  return { move: move.san, comment: "No model configured: playing the first legal move." };
}

/**
 * Map whatever the model said onto a move the arena will accept.
 *
 * The SDK reads the answer but deliberately refuses to decide what to do when
 * it reads nothing: falling back rather than forfeiting the turn is a choice,
 * and an SDK that silently corrected a model would corrupt the leaderboard it
 * feeds. Here the choice is explicit, and it belongs to this example, which
 * any author is free to change.
 */
export function toLegalChoice(answer: string, turn: Turn): MoveChoice {
  const said = answer.trim();
  const read: LegalMove | null = readMoveFromAnswer(said, turn.legalMoves);
  if (read !== null) {
    const exact = read.san === said || read.uci === said;
    return { move: read.san, comment: exact ? `Playing ${read.san}.` : `Read ${read.san} out of the answer.` };
  }

  const quoted = said.slice(0, MAX_QUOTED);
  return {
    move: firstLegal(turn).move,
    comment: `The answer "${quoted}" is not legal here, so I played the first legal move instead.`,
  };
}
