import type { ArenaStats } from "@aichess/core/protocol";
import { and, count, eq, gte } from "drizzle-orm";
import type { Database } from "./client.js";
import { agents, games, moves } from "./schema/index.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * The one place the arena counts itself. Whatever reads these figures reads
 * them from here, so no two surfaces can disagree about what a played game is.
 * `now` is passed in rather than read here, for the same reason
 * `PageViewConfig` takes it: the tests stay hermetic and this stays a library.
 */
export async function arenaStats(db: Database, now: Date = new Date()): Promise<ArenaStats> {
  const finished = eq(games.status, "finished");
  const since = new Date(now.getTime() - DAY_MS);

  const [played, moved, roster, recent] = await Promise.all([
    db.select({ value: count() }).from(games).where(finished),
    db.select({ value: count() }).from(moves),
    db.select({ value: count() }).from(agents).where(eq(agents.status, "active")),
    // A game still being played has no finishedAt, and `NULL >= x` is not true,
    // so the unfinished leave themselves out without a clause of their own.
    db
      .select({ value: count() })
      .from(games)
      .where(and(finished, gte(games.finishedAt, since))),
  ]);

  return {
    gamesPlayed: played[0]?.value ?? 0,
    movesPlayed: moved[0]?.value ?? 0,
    activeAgents: roster[0]?.value ?? 0,
    gamesLast24h: recent[0]?.value ?? 0,
  };
}
