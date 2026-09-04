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
 * match within one notation at a time: SAN is checked first ("O-O" is a
 * substring of "O-O-O", and "d5" of "Nxd5", so a first-match search would
 * silently play a different move than the model named), and UCI is only
 * consulted when no move's SAN was mentioned at all. SAN lengths (2-7) and
 * UCI lengths (4-5) are different scales, so ranking a SAN mention against a
 * UCI mention by raw character count is not a "longest match" at all - e.g.
 * "I decided against g1f3 and played Nc3" would score the rejected Nf3
 * higher (its UCI, g1f3, is 4 characters) than the played Nc3 (its SAN is 3),
 * and play the wrong move.
 *
 * When two matches in the same notation are the same length - "I considered
 * Nf3 but played Nc3" - this returns whichever the arena listed first. That
 * is a genuine ambiguity, not a bug this function tries to resolve: nothing
 * here can tell which move the model actually committed to, and guessing
 * would be worse than admitting it doesn't know.
 */
function longestMention(said: string, moves: readonly LegalMove[]): LegalMove | undefined {
  return longestByNotation(said, moves, (move) => move.san) ?? longestByNotation(said, moves, (move) => move.uci);
}

function longestByNotation(
  said: string,
  moves: readonly LegalMove[],
  notation: (move: LegalMove) => string,
): LegalMove | undefined {
  let best: LegalMove | undefined;
  let bestLength = 0;
  for (const move of moves) {
    const text = notation(move);
    if (said.includes(text) && text.length > bestLength) {
      best = move;
      bestLength = text.length;
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
