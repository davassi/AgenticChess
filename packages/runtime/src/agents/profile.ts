import { PROVISIONAL_RD_THRESHOLD } from "@aichess/core";
import type { AgentListItem, AgentProfile, AgentStats, AgentStatus, RatingPoint } from "@aichess/core/protocol";
import { agents, games, moveAttempts, moves, ratingHistory, ratings } from "@aichess/db";
import { and, asc, desc, avg, count, eq, gt, lt, lte, or, type SQL } from "drizzle-orm";
import { listGames } from "../games/listing.js";
import type { Executor } from "../games/repository.js";
import { defaultRatingRecord, loadRating, toRatingSummary, type RatingRecord } from "../rating/repository.js";

export const RATING_HISTORY_LIMIT = 200;
export const RECENT_GAMES_LIMIT = 10;

/** Everything about an agent that Postgres knows. Presence and queue live in Redis and are added by the route. */
export type AgentProfileBase = Omit<AgentProfile, "online" | "queue">;

export interface AgentsCursor {
  name: string;
  id: string;
}

export interface AgentsListInput {
  limit: number;
  after?: AgentsCursor;
}

const EMPTY_STATS: AgentStats = { games: 0, wins: 0, draws: 0, losses: 0, illegalRate: 0, avgThinkTimeMs: 0 };

async function loadStats(ex: Executor, agentId: string): Promise<AgentStats> {
  // Grouped on the column, not on a `white_agent_id = $1` expression: Postgres
  // rebinds the parameter per occurrence and then refuses the GROUP BY.
  const [resultRows, moveRows, attemptRows] = await Promise.all([
    ex
      .select({ result: games.result, white: games.whiteAgentId, total: count() })
      .from(games)
      .where(and(eq(games.status, "finished"), or(eq(games.whiteAgentId, agentId), eq(games.blackAgentId, agentId))))
      .groupBy(games.result, games.whiteAgentId),
    // Both aggregates are shown beside `games`, which counts finished games
    // only: a game still being played would otherwise drag the averages
    // printed next to a total that does not include it.
    ex
      .select({ total: count(), avgThinkTimeMs: avg(moves.thinkTimeMs) })
      .from(moves)
      .innerJoin(games, eq(games.id, moves.gameId))
      .where(
        and(
          eq(games.status, "finished"),
          or(
            and(eq(games.whiteAgentId, agentId), eq(moves.color, "white")),
            and(eq(games.blackAgentId, agentId), eq(moves.color, "black")),
          ),
        ),
      ),
    ex
      .select({ total: count() })
      .from(moveAttempts)
      .innerJoin(games, eq(games.id, moveAttempts.gameId))
      .where(and(eq(moveAttempts.agentId, agentId), eq(games.status, "finished"))),
  ]);

  const stats: AgentStats = { ...EMPTY_STATS };
  for (const row of resultRows) {
    const total = Number(row.total);
    const isWhite = row.white === agentId;
    stats.games += total;
    if (row.result === "1/2-1/2") {
      stats.draws += total;
    } else if ((row.result === "1-0" && isWhite) || (row.result === "0-1" && !isWhite)) {
      stats.wins += total;
    } else if (row.result !== null) {
      stats.losses += total;
    }
  }

  const ownMoves = Number(moveRows[0]?.total ?? 0);
  const attempts = Number(attemptRows[0]?.total ?? 0);
  stats.avgThinkTimeMs = Math.round(Number(moveRows[0]?.avgThinkTimeMs ?? 0));
  stats.illegalRate = ownMoves === 0 ? 0 : attempts / ownMoves;
  return stats;
}

/** Same ordering as the leaderboard: rating desc, RD asc, id asc. */
async function loadRank(ex: Executor, record: RatingRecord, status: AgentStatus): Promise<number | null> {
  if (status !== "active" || record.rd > PROVISIONAL_RD_THRESHOLD) return null;
  const ahead: SQL | undefined = or(
    gt(ratings.rating, record.rating),
    and(eq(ratings.rating, record.rating), lt(ratings.rd, record.rd)),
    and(eq(ratings.rating, record.rating), eq(ratings.rd, record.rd), lt(ratings.agentId, record.agentId)),
  );
  const [row] = await ex
    .select({ ahead: count() })
    .from(ratings)
    .innerJoin(agents, eq(agents.id, ratings.agentId))
    .where(and(lte(ratings.rd, PROVISIONAL_RD_THRESHOLD), eq(agents.status, "active"), ahead));
  return Number(row?.ahead ?? 0) + 1;
}

async function loadRatingCurve(ex: Executor, agentId: string): Promise<RatingPoint[]> {
  const rows = await ex
    .select({
      gameId: ratingHistory.gameId,
      rating: ratingHistory.ratingAfter,
      rd: ratingHistory.rdAfter,
      at: ratingHistory.createdAt,
    })
    .from(ratingHistory)
    .where(eq(ratingHistory.agentId, agentId))
    // The newest points are what a curve is read for: take them from the end
    // and put them back in order. Reading from the start froze the curve at
    // the agent's first two hundred rated games.
    .orderBy(desc(ratingHistory.createdAt), desc(ratingHistory.id))
    .limit(RATING_HISTORY_LIMIT);
  return rows
    .reverse()
    .map((row) => ({ gameId: row.gameId, rating: row.rating, rd: row.rd, at: row.at.toISOString() }));
}

export async function loadAgentProfile(ex: Executor, slug: string): Promise<AgentProfileBase | null> {
  const [row] = await ex.select().from(agents).where(eq(agents.slug, slug));
  if (row === undefined) return null;

  const [rating, stats, curve, recentGames, activeGames] = await Promise.all([
    loadRating(ex, row.id),
    loadStats(ex, row.id),
    loadRatingCurve(ex, row.id),
    listGames(ex, { limit: RECENT_GAMES_LIMIT, agentId: row.id }),
    listGames(ex, { limit: 1, agentId: row.id, status: "active" }),
  ]);

  return {
    agent: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      modelProvider: row.modelProvider,
      modelName: row.modelName,
    },
    description: row.description,
    status: row.status,
    activeGameId: activeGames[0]?.id ?? null,
    rating: toRatingSummary(rating),
    rank: await loadRank(ex, rating, row.status),
    createdAt: row.createdAt.toISOString(),
    stats,
    ratingHistory: curve,
    recentGames,
  };
}

export async function listAgents(ex: Executor, input: AgentsListInput): Promise<AgentListItem[]> {
  const after = input.after;
  const beyond: SQL | undefined =
    after === undefined
      ? undefined
      : or(gt(agents.name, after.name), and(eq(agents.name, after.name), gt(agents.id, after.id)));
  const rows = await ex
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      description: agents.description,
      status: agents.status,
      rating: ratings.rating,
      rd: ratings.rd,
      gamesPlayed: ratings.gamesPlayed,
    })
    .from(agents)
    .leftJoin(ratings, eq(ratings.agentId, agents.id))
    .where(and(eq(agents.status, "active"), beyond))
    .orderBy(asc(agents.name), asc(agents.id))
    .limit(input.limit);

  return rows.map((row) => {
    const fallback = defaultRatingRecord(row.id);
    return {
      agent: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        modelProvider: row.modelProvider,
        modelName: row.modelName,
      },
      description: row.description,
      status: row.status,
      rating: toRatingSummary({
        ...fallback,
        rating: row.rating ?? fallback.rating,
        rd: row.rd ?? fallback.rd,
        gamesPlayed: row.gamesPlayed ?? 0,
      }),
    };
  });
}
