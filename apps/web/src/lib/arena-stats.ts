import type { ArenaStats } from "@aichess/core/protocol";
import { fetchArenaStats } from "./api";

/**
 * The landing's reading of the arena's own figures, which never throws. The
 * counters are the least important thing on that page, and a page that fails
 * to render because a counter could not be read would be the most expensive
 * possible way to lose them — the same trade `handleTrack` makes at the other
 * end of the same feature. Nothing is swallowed silently: the reason a strip is
 * missing reaches the log.
 */
export async function readArenaStats(onError: (error: unknown) => void): Promise<ArenaStats | null> {
  try {
    return await fetchArenaStats();
  } catch (error: unknown) {
    onError(error);
    return null;
  }
}
