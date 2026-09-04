import { toPgn, turnOf } from "@aichess/core";
import type {
  GameListItem,
  GameOutcomeFilter,
  GameStatus,
  GameTimeline,
  Termination,
  TimelineAttempt,
  TimelineMove,
} from "@aichess/core/protocol";
import { agents, games, moveAttempts, moves } from "@aichess/db";
import { and, asc, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { loadAgentSummaries, loadGame, type Executor } from "./repository.js";

export interface GamesCursor {
  createdAt: number;
  id: string;
}

export interface GamesListInput {
  limit: number;
  after?: GamesCursor;
  status?: GameStatus;
  agentId?: string;
  outcome?: GameOutcomeFilter;
  termination?: Termination;
}

const whiteAgent = alias(agents, "white_agent");
const blackAgent = alias(agents, "black_agent");

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Either side of the board. */
function playedBy(agentId: string): SQL | undefined {
  return or(eq(games.whiteAgentId, agentId), eq(games.blackAgentId, agentId));
}

/** Win, loss and draw are read from the named agent's side of the board. */
function outcomeCondition(agentId: string, outcome: GameOutcomeFilter): SQL | undefined {
  // A win or a loss names a side and so carries the participation with it; a
  // draw does not, and without this every drawn game in the arena would match.
  if (outcome === "draw") return and(playedBy(agentId), eq(games.result, "1/2-1/2"));
  const asWhite = outcome === "win" ? "1-0" : "0-1";
  const asBlack = outcome === "win" ? "0-1" : "1-0";
  return or(
    and(eq(games.whiteAgentId, agentId), eq(games.result, asWhite)),
    and(eq(games.blackAgentId, agentId), eq(games.result, asBlack)),
  );
}

export async function listGames(ex: Executor, input: GamesListInput): Promise<GameListItem[]> {
  const conditions: Array<SQL | undefined> = [];
  if (input.status !== undefined) conditions.push(eq(games.status, input.status));
  if (input.termination !== undefined) conditions.push(eq(games.termination, input.termination));
  if (input.agentId !== undefined) {
    conditions.push(
      input.outcome === undefined ? playedBy(input.agentId) : outcomeCondition(input.agentId, input.outcome),
    );
  }
  const after = input.after;
  if (after !== undefined) {
    const at = new Date(after.createdAt);
    conditions.push(or(lt(games.createdAt, at), and(eq(games.createdAt, at), lt(games.id, after.id))));
  }

  const rows = await ex
    .select({
      id: games.id,
      status: games.status,
      fen: games.currentFen,
      ply: games.ply,
      result: games.result,
      termination: games.termination,
      moveDeadlineAt: games.moveDeadlineAt,
      createdAt: games.createdAt,
      startedAt: games.startedAt,
      finishedAt: games.finishedAt,
      white: {
        id: whiteAgent.id,
        name: whiteAgent.name,
        slug: whiteAgent.slug,
        modelProvider: whiteAgent.modelProvider,
        modelName: whiteAgent.modelName,
      },
      black: {
        id: blackAgent.id,
        name: blackAgent.name,
        slug: blackAgent.slug,
        modelProvider: blackAgent.modelProvider,
        modelName: blackAgent.modelName,
      },
    })
    .from(games)
    .innerJoin(whiteAgent, eq(whiteAgent.id, games.whiteAgentId))
    .innerJoin(blackAgent, eq(blackAgent.id, games.blackAgentId))
    .where(and(...conditions))
    .orderBy(desc(games.createdAt), desc(games.id))
    .limit(input.limit);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    white: row.white,
    black: row.black,
    fen: row.fen,
    ply: row.ply,
    turn: turnOf(row.fen),
    result: row.result,
    termination: row.termination,
    moveDeadlineAt: iso(row.moveDeadlineAt),
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  }));
}

/**
 * The full record of a game: the moves with their comments and think times,
 * and the rejected attempts. `GameSnapshot.history` carries SAN strings only,
 * so a spectator arriving mid-game would otherwise see a silent board.
 */
export async function loadGameTimeline(ex: Executor, gameId: string): Promise<GameTimeline | null> {
  const [game] = await ex
    .select({ white: games.whiteAgentId, black: games.blackAgentId })
    .from(games)
    .where(eq(games.id, gameId));
  if (game === undefined) return null;

  const [moveRows, attemptRows] = await Promise.all([
    ex.select().from(moves).where(eq(moves.gameId, gameId)).orderBy(asc(moves.ply)),
    ex
      .select()
      .from(moveAttempts)
      .where(eq(moveAttempts.gameId, gameId))
      .orderBy(asc(moveAttempts.ply), asc(moveAttempts.createdAt)),
  ]);

  const timelineMoves: TimelineMove[] = moveRows.map((row) => ({
    ply: row.ply,
    color: row.color,
    san: row.san,
    uci: row.uci,
    fen: row.fenAfter,
    comment: row.comment,
    thinkTimeMs: row.thinkTimeMs,
    at: row.createdAt.toISOString(),
  }));

  const attempts: TimelineAttempt[] = attemptRows.map((row) => ({
    ply: row.ply,
    color: row.agentId === game.white ? "white" : "black",
    submitted: row.submitted.slice(0, 64),
    reason: row.reason,
    at: row.createdAt.toISOString(),
  }));

  return { moves: timelineMoves, attempts };
}

/** The stored PGN once the game is over, rebuilt from the moves while it is still running. */
export async function loadGamePgn(ex: Executor, gameId: string): Promise<string | null> {
  const [row] = await ex.select({ pgn: games.pgn }).from(games).where(eq(games.id, gameId));
  if (row === undefined) return null;
  if (row.pgn !== null && row.pgn !== "") return row.pgn;
  const state = await loadGame(ex, gameId);
  if (state === null) return null;
  const players = await loadAgentSummaries(ex, state.whiteAgentId, state.blackAgentId);
  if (players === null) return null;
  return toPgn(state, { white: players.white.name, black: players.black.name });
}
