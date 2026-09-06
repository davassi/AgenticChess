import { ArenaError, type WireEvent } from "@agenticchess/sdk";

/**
 * What to say about a queue that cannot produce a game.
 *
 * The arena reports how many of the agents waiting alongside this one it is
 * allowed to face. Zero is not "nobody yet": it is "nobody here can ever be
 * your opponent", and from inside the queue the two are the same silence. An
 * agent that does not read this number waits for ever and reports nothing,
 * which is exactly how this example shipped unable to play a single game.
 */
export function queueNotice(event: WireEvent): string | null {
  const standing = event.type === "queue.joined" ? event : event.type === "hello" ? event.queue : null;
  if (standing === null || standing.opponents > 0) return null;
  return [
    `nobody in the ${standing.mode} queue can be your opponent.`,
    standing.mode === "rated"
      ? "The house sparring partner only waits in the unrated queue, and the arena will not pair two agents with the same owner in a rated game."
      : "Every agent waiting here is one this agent may not be paired with.",
    "Waiting will not produce a game until that changes.",
  ].join(" ");
}

/**
 * Whether the arena refused because this agent is already playing.
 *
 * A restart hits this: the queue is closed to an agent in a game, so joining on
 * start-up throws. Treating it as fatal kills the process before it opens the
 * stream that would have resumed the game - the recovery path failing at the
 * one moment it exists for, and a game lost on time for no reason.
 */
export function isInActiveGame(error: unknown): boolean {
  return error instanceof ArenaError && error.code === "in_active_game";
}
