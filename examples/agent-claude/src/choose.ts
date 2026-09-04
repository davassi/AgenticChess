import type { LegalMove, MoveChoice, Turn } from "@agenticchess/sdk";

const MAX_QUOTED = 40;

/** The deterministic fallback: the first move the arena listed. */
export function firstLegal(turn: Turn): MoveChoice {
  const move = turn.legalMoves[0];
  if (move === undefined) throw new Error("The arena offered no legal move");
  return { move: move.san, comment: "No model configured: playing the first legal move." };
}

/**
 * The legal move whose notation appears in the answer, preferring the longest
 * match: "O-O" is a substring of "O-O-O", and "d5" of "Nxd5", so a first-match
 * search would silently play a different move than the model named.
 *
 * When two matches are the same length - "I considered Nf3 but played Nc3" -
 * this returns whichever the arena listed first. That is a genuine ambiguity,
 * not a bug this function tries to resolve: nothing here can tell which move
 * the model actually committed to, and guessing would be worse than admitting
 * it doesn't know.
 */
function longestMention(said: string, moves: readonly LegalMove[]): LegalMove | undefined {
  let best: LegalMove | undefined;
  let bestLength = 0;
  for (const move of moves) {
    const matchLength = Math.max(
      said.includes(move.san) ? move.san.length : 0,
      said.includes(move.uci) ? move.uci.length : 0,
    );
    if (matchLength > bestLength) {
      best = move;
      bestLength = matchLength;
    }
  }
  return best;
}

/**
 * Map whatever the model said onto a move the arena will accept.
 *
 * The SDK deliberately refuses to do this: choosing is the agent's job, and an
 * SDK that silently corrected a model would corrupt the leaderboard it feeds.
 * Here the choice is explicit - fall back rather than forfeit the turn - and it
 * belongs to this example, which any author is free to change.
 */
export function toLegalChoice(answer: string, turn: Turn): MoveChoice {
  const said = answer.trim();

  const exact = turn.legalMoves.find((move) => move.san === said || move.uci === said);
  if (exact !== undefined) return { move: exact.san, comment: `Playing ${exact.san}.` };

  const mentioned = longestMention(said, turn.legalMoves);
  if (mentioned !== undefined) return { move: mentioned.san, comment: `Read ${mentioned.san} out of the answer.` };

  const quoted = said.slice(0, MAX_QUOTED);
  return {
    move: firstLegal(turn).move,
    comment: `The answer "${quoted}" is not legal here, so I played the first legal move instead.`,
  };
}
