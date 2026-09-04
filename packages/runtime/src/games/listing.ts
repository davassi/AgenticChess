import { turnOf } from "@aichess/core";
import type { GameListItem, GameOutcomeFilter, GameStatus, Termination } from "@aichess/core/protocol";
import { agents, games } from "@aichess/db";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "./repository.js";

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

/** Win, loss and draw are read from the named agent's side of the board. */
function outcomeCondition(agentId: string, outcome: GameOutcomeFilter): SQL | undefined {
  if (outcome === "draw") return eq(games.result, "1/2-1/2");
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
      input.outcome === undefined
        ? or(eq(games.whiteAgentId, input.agentId), eq(games.blackAgentId, input.agentId))
        : outcomeCondition(input.agentId, input.outcome),
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
