import { PROVISIONAL_RD_THRESHOLD, initialRating, isProvisional } from "@aichess/core";
import type { AgentSummary, RatingSummary } from "@aichess/core/protocol";
import { agents, ratings, type Transaction } from "@aichess/db";
import { and, asc, desc, eq, gt, inArray, lt, lte, or } from "drizzle-orm";
import type { Executor } from "../games/repository.js";

export interface RatingRecord {
  agentId: string;
  rating: number;
  rd: number;
  volatility: number;
  gamesPlayed: number;
  lastGameAt: number | null;
}

type RatingRow = typeof ratings.$inferSelect;

export function defaultRatingRecord(agentId: string): RatingRecord {
  return { agentId, ...initialRating(), gamesPlayed: 0, lastGameAt: null };
}

export function toRatingSummary(record: RatingRecord): RatingSummary {
  return {
    rating: record.rating,
    rd: record.rd,
    gamesPlayed: record.gamesPlayed,
    provisional: isProvisional(record),
  };
}

function rowToRecord(row: RatingRow): RatingRecord {
  return {
    agentId: row.agentId,
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    gamesPlayed: row.gamesPlayed,
    lastGameAt: row.lastGameAt === null ? null : row.lastGameAt.getTime(),
  };
}

export async function loadRating(ex: Executor, agentId: string): Promise<RatingRecord> {
  const [row] = await ex.select().from(ratings).where(eq(ratings.agentId, agentId));
  return row === undefined ? defaultRatingRecord(agentId) : rowToRecord(row);
}

export async function lockRatings(tx: Transaction, agentIds: string[]): Promise<Map<string, RatingRecord>> {
  const ordered = [...new Set(agentIds)].sort();
  if (ordered.length === 0) return new Map();
  await tx
    .insert(ratings)
    .values(
      ordered.map((agentId) => {
        const record = defaultRatingRecord(agentId);
        return { agentId, rating: record.rating, rd: record.rd, volatility: record.volatility };
      }),
    )
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(ratings)
    .where(inArray(ratings.agentId, ordered))
    .orderBy(asc(ratings.agentId))
    .for("update");
  return new Map(rows.map((row) => [row.agentId, rowToRecord(row)]));
}

export interface LeaderboardCursor {
  rating: number;
  rd: number;
  agentId: string;
}

export interface LeaderboardRow {
  agent: AgentSummary;
  rating: number;
  rd: number;
  gamesPlayed: number;
}

export interface LeaderboardInput {
  limit: number;
  after?: LeaderboardCursor;
}

export async function listLeaderboard(ex: Executor, input: LeaderboardInput): Promise<LeaderboardRow[]> {
  const ranked = and(lte(ratings.rd, PROVISIONAL_RD_THRESHOLD), eq(agents.status, "active"));
  const after = input.after;
  const beyondCursor =
    after === undefined
      ? undefined
      : or(
          lt(ratings.rating, after.rating),
          and(eq(ratings.rating, after.rating), gt(ratings.rd, after.rd)),
          and(eq(ratings.rating, after.rating), eq(ratings.rd, after.rd), gt(ratings.agentId, after.agentId)),
        );
  const rows = await ex
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      isHouse: agents.isHouse,
      rating: ratings.rating,
      rd: ratings.rd,
      gamesPlayed: ratings.gamesPlayed,
    })
    .from(ratings)
    .innerJoin(agents, eq(agents.id, ratings.agentId))
    .where(beyondCursor === undefined ? ranked : and(ranked, beyondCursor))
    .orderBy(desc(ratings.rating), asc(ratings.rd), asc(ratings.agentId))
    .limit(input.limit);
  return rows.map((row) => ({
    agent: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      modelProvider: row.modelProvider,
      modelName: row.modelName,
      isHouse: row.isHouse,
    },
    rating: row.rating,
    rd: row.rd,
    gamesPlayed: row.gamesPlayed,
  }));
}
