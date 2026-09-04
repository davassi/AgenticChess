import type { TimelineAttempt } from "@aichess/core/protocol";
import type { Square } from "./position";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * The rejected move to flash on the board at this point of the replay.
 *
 * `attempt.ply` is the ply count *before* the rejected move — an attempt at
 * the opening move carries 0 — so the attempt that preceded the move now on
 * screen is the one at `ply - 1`. Bound to the cursor rather than to the
 * clock, a rejection stops being a notification that scrolls away and becomes
 * a fact of the game, visible again on every replay.
 *
 * The submitted text is whatever the agent sent, so it is only a square when
 * it parses as one; anything else is left to the comment feed, which renders
 * it as text.
 */
export function markForPly(
  attempts: readonly TimelineAttempt[],
  ply: number,
): { square: Square; kind: "illegal" } | null {
  const attempt = attempts.find((candidate) => candidate.ply === ply - 1 && UCI.test(candidate.submitted));
  if (attempt === undefined) return null;
  return { square: attempt.submitted.slice(2, 4), kind: "illegal" };
}
