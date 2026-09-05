import { START_FEN, type DomainEvent, type GameState, type MoveRecord } from "@aichess/core";
import type { Color } from "@aichess/core/protocol";
import { agents, games, moveAttempts, moves, type Database, type Transaction } from "@aichess/db";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { GameAgents } from "../events/wire.js";

export type Executor = Database | Transaction;

type GameRow = typeof games.$inferSelect;
type MoveRow = typeof moves.$inferSelect;

function ms(date: Date | null): number | null {
  return date === null ? null : date.getTime();
}

function date(msValue: number | null): Date | null {
  return msValue === null ? null : new Date(msValue);
}

function rowToState(row: GameRow, moveRows: MoveRow[]): GameState {
  const records: MoveRecord[] = moveRows.map((m) => ({
    ply: m.ply,
    color: m.color,
    san: m.san,
    uci: m.uci,
    fenAfter: m.fenAfter,
    comment: m.comment,
    thinkTimeMs: m.thinkTimeMs,
    illegalAttemptsBefore: m.illegalAttemptsBefore,
  }));
  return {
    id: row.id,
    whiteAgentId: row.whiteAgentId,
    blackAgentId: row.blackAgentId,
    status: row.status,
    config: {
      timePerMoveMs: row.timePerMoveMs,
      moveLimitPlies: row.moveLimitPlies,
      illegalAttemptsPerTurn: row.illegalAttemptsPerTurn,
      rated: row.rated,
    },
    fen: row.currentFen,
    fenHistory: [START_FEN, ...records.map((m) => m.fenAfter)],
    ply: row.ply,
    moves: records,
    turnStartedAt: ms(row.turnStartedAt),
    moveDeadlineAt: ms(row.moveDeadlineAt),
    illegalAttemptsThisTurn: row.illegalAttemptsThisTurn,
    result: row.result,
    termination: row.termination,
    createdAt: row.createdAt.getTime(),
    startedAt: ms(row.startedAt),
    finishedAt: ms(row.finishedAt),
  };
}

async function loadMoves(ex: Executor, gameId: string): Promise<MoveRow[]> {
  return ex.select().from(moves).where(eq(moves.gameId, gameId)).orderBy(asc(moves.ply));
}

export async function insertGame(ex: Executor, state: GameState): Promise<void> {
  await ex.insert(games).values({
    id: state.id,
    whiteAgentId: state.whiteAgentId,
    blackAgentId: state.blackAgentId,
    status: state.status,
    result: state.result,
    termination: state.termination,
    timePerMoveMs: state.config.timePerMoveMs,
    moveLimitPlies: state.config.moveLimitPlies,
    illegalAttemptsPerTurn: state.config.illegalAttemptsPerTurn,
    rated: state.config.rated,
    currentFen: state.fen,
    ply: state.ply,
    turnStartedAt: date(state.turnStartedAt),
    moveDeadlineAt: date(state.moveDeadlineAt),
    illegalAttemptsThisTurn: state.illegalAttemptsThisTurn,
    createdAt: new Date(state.createdAt),
    startedAt: date(state.startedAt),
    finishedAt: date(state.finishedAt),
    updatedAt: new Date(state.createdAt),
  });
}

export async function loadGame(ex: Executor, gameId: string): Promise<GameState | null> {
  const [row] = await ex.select().from(games).where(eq(games.id, gameId));
  if (row === undefined) return null;
  return rowToState(row, await loadMoves(ex, gameId));
}

export async function loadGameForUpdate(tx: Transaction, gameId: string): Promise<GameState | null> {
  const [row] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
  if (row === undefined) return null;
  return rowToState(row, await loadMoves(tx, gameId));
}

export interface PersistOptions {
  pgn?: string | null;
  ratings?: GameRatingColumns;
}

export interface GameRatingColumns {
  whiteBefore: number;
  whiteAfter: number;
  blackBefore: number;
  blackAfter: number;
}

export async function persistTransition(
  tx: Transaction,
  before: GameState,
  after: GameState,
  events: DomainEvent[],
  options: PersistOptions,
): Promise<void> {
  const now = new Date();
  await tx
    .update(games)
    .set({
      status: after.status,
      result: after.result,
      termination: after.termination,
      currentFen: after.fen,
      ply: after.ply,
      turnStartedAt: date(after.turnStartedAt),
      moveDeadlineAt: date(after.moveDeadlineAt),
      illegalAttemptsThisTurn: after.illegalAttemptsThisTurn,
      startedAt: date(after.startedAt),
      finishedAt: date(after.finishedAt),
      ...(options.pgn === undefined ? {} : { pgn: options.pgn }),
      ...(options.ratings === undefined
        ? {}
        : {
            whiteRatingBefore: options.ratings.whiteBefore,
            whiteRatingAfter: options.ratings.whiteAfter,
            blackRatingBefore: options.ratings.blackBefore,
            blackRatingAfter: options.ratings.blackAfter,
          }),
      updatedAt: now,
    })
    .where(eq(games.id, after.id));

  const newMoves = after.moves.slice(before.moves.length);
  if (newMoves.length > 0) {
    await tx.insert(moves).values(
      newMoves.map((m) => ({
        gameId: after.id,
        ply: m.ply,
        color: m.color,
        san: m.san,
        uci: m.uci,
        fenAfter: m.fenAfter,
        comment: m.comment,
        thinkTimeMs: m.thinkTimeMs,
        illegalAttemptsBefore: m.illegalAttemptsBefore,
      })),
    );
  }

  const agentIdFor = (color: Color): string => (color === "white" ? after.whiteAgentId : after.blackAgentId);
  const attempts = events.flatMap((e) =>
    e.type === "illegal_attempt"
      ? [{ gameId: after.id, agentId: agentIdFor(e.color), ply: e.ply, submitted: e.submitted, reason: e.reason }]
      : [],
  );
  if (attempts.length > 0) {
    await tx.insert(moveAttempts).values(attempts);
  }
}

export async function loadAgentSummaries(
  ex: Executor,
  whiteAgentId: string,
  blackAgentId: string,
): Promise<GameAgents | null> {
  const rows = await ex
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      isHouse: agents.isHouse,
    })
    .from(agents)
    .where(inArray(agents.id, [whiteAgentId, blackAgentId]));
  const white = rows.find((r) => r.id === whiteAgentId);
  const black = rows.find((r) => r.id === blackAgentId);
  if (white === undefined || black === undefined) return null;
  return { white, black };
}

export async function listActiveDeadlines(
  ex: Executor,
): Promise<Array<{ gameId: string; ply: number; moveDeadlineAt: number }>> {
  const rows = await ex
    .select({ gameId: games.id, ply: games.ply, moveDeadlineAt: games.moveDeadlineAt })
    .from(games)
    .where(and(eq(games.status, "active"), isNotNull(games.moveDeadlineAt)));
  return rows.flatMap((r) =>
    r.moveDeadlineAt === null ? [] : [{ gameId: r.gameId, ply: r.ply, moveDeadlineAt: r.moveDeadlineAt.getTime() }],
  );
}

export async function findActiveGameIdForAgent(ex: Executor, agentId: string): Promise<string | null> {
  const [row] = await ex
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.status, "active"), or(eq(games.whiteAgentId, agentId), eq(games.blackAgentId, agentId))))
    .orderBy(desc(games.startedAt))
    .limit(1);
  return row?.id ?? null;
}
