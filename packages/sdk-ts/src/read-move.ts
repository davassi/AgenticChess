import type { LegalMove } from "@aichess/core/protocol";

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

function longestMention(said: string, moves: readonly LegalMove[]): LegalMove | undefined {
  return longestByNotation(said, moves, (move) => move.san) ?? longestByNotation(said, moves, (move) => move.uci);
}

/**
 * The legal move an answer names, or null.
 *
 * This reads; it does not choose. The client never calls it on the agent's
 * behalf, because deciding what to do with a model that answered something
 * unusable is the author's decision, and an SDK that quietly corrected a model
 * would corrupt the leaderboard it feeds. It lives here because the reading
 * itself is subtle enough that no agent should have to rewrite it.
 *
 * An exact answer wins outright. Otherwise the longest match within one
 * notation is preferred: SAN is checked first ("O-O" is a substring of
 * "O-O-O", and "d5" of "Nxd5", so a first-match search would silently play a
 * different move than the model named), and UCI is only consulted when no
 * move's SAN was mentioned at all. SAN lengths (2-7) and UCI lengths (4-5) are
 * different scales, so ranking a SAN mention against a UCI mention by raw
 * character count is not a "longest match" at all - "I decided against g1f3
 * and played Nc3" would score the rejected Nf3 higher (its UCI is 4
 * characters) than the played Nc3 (its SAN is 3), and read the wrong move.
 *
 * When two matches in the same notation are the same length - "I considered
 * Nf3 but played Nc3" - this returns whichever the arena listed first. That is
 * a genuine ambiguity, not a bug this function tries to resolve: nothing here
 * can tell which move the model committed to, and guessing would be worse than
 * admitting it does not know.
 */
export function readMoveFromAnswer(answer: string, legalMoves: readonly LegalMove[]): LegalMove | null {
  const said = answer.trim();
  if (said === "") return null;
  const exact = legalMoves.find((move) => move.san === said || move.uci === said);
  if (exact !== undefined) return exact;
  return longestMention(said, legalMoves) ?? null;
}
