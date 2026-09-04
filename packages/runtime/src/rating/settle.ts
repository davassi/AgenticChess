import { applyGameRatings, type GameState } from "@aichess/core";
import { ratingHistory, ratings, type Transaction } from "@aichess/db";
import { eq } from "drizzle-orm";
import type { RatingChanges } from "../events/wire.js";
import type { GameRatingColumns } from "../games/repository.js";
import { lockRatings } from "./repository.js";

export interface SettledRatings {
  changes: RatingChanges;
  columns: GameRatingColumns;
}

export async function settleRatings(tx: Transaction, state: GameState, now: number): Promise<SettledRatings | null> {
  if (state.status !== "finished" || state.result === null) return null;
  const locked = await lockRatings(tx, [state.whiteAgentId, state.blackAgentId]);
  const white = locked.get(state.whiteAgentId);
  const black = locked.get(state.blackAgentId);
  if (white === undefined || black === undefined) {
    throw new Error(`ratings missing for game ${state.id}`);
  }
  const next = applyGameRatings(white, black, state.result);
  if (next === null) return null;

  const at = new Date(now);
  for (const [record, updated] of [
    [white, next.white],
    [black, next.black],
  ] as const) {
    await tx
      .update(ratings)
      .set({
        rating: updated.rating,
        rd: updated.rd,
        volatility: updated.volatility,
        gamesPlayed: record.gamesPlayed + 1,
        lastGameAt: at,
        updatedAt: at,
      })
      .where(eq(ratings.agentId, record.agentId));
  }
  await tx.insert(ratingHistory).values([
    {
      agentId: white.agentId,
      gameId: state.id,
      ratingBefore: white.rating,
      ratingAfter: next.white.rating,
      rdAfter: next.white.rd,
    },
    {
      agentId: black.agentId,
      gameId: state.id,
      ratingBefore: black.rating,
      ratingAfter: next.black.rating,
      rdAfter: next.black.rd,
    },
  ]);
  return {
    changes: {
      white: { before: white.rating, after: next.white.rating },
      black: { before: black.rating, after: next.black.rating },
    },
    columns: {
      whiteBefore: white.rating,
      whiteAfter: next.white.rating,
      blackBefore: black.rating,
      blackAfter: next.black.rating,
    },
  };
}
