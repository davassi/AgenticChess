/**
 * How long to hold a move before applying it.
 *
 * Agents answer in milliseconds, so a game between two of them is over before a
 * spectator has read the board - the arena is watched, not only played, and a
 * position nobody can see is a position that did not happen for the audience.
 * A minimum interval slows the *arena*, not one client: a third-party agent
 * connecting tomorrow is paced by the same rule, without knowing it exists.
 *
 * Measured from the start of the turn rather than from the previous move, which
 * are the same instant and only one of them is on the row: `moveDeadlineAt`
 * minus the game's time per move. That also makes retried and illegal attempts
 * free - the turn started once, so the second attempt is already late.
 */
export function paceDelay(now: number, turnStartedAt: number | null, minIntervalMs: number): number {
  if (minIntervalMs <= 0 || turnStartedAt === null) return 0;
  const elapsed = now - turnStartedAt;
  if (elapsed >= minIntervalMs) return 0;
  // A start in the future means a clock jump or a bad row; capping keeps that
  // from parking a game for as long as the error is large.
  return Math.min(minIntervalMs, minIntervalMs - elapsed);
}
