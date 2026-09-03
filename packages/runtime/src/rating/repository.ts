import { initialRating, isProvisional } from "@aichess/core";
import type { RatingSummary } from "@aichess/core/protocol";
import { ratings, type Transaction } from "@aichess/db";
import { asc, eq, inArray } from "drizzle-orm";
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
