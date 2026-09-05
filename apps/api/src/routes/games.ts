import { GamesQuerySchema, MoveRequestSchema, type GameListPage } from "@aichess/core/protocol";
import { findAgentIdBySlug, listGames, loadGamePgn, loadGameTimeline, type GamesCursor } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../cursor.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { assertAgent, optionalAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import type { GameStreamRegistry } from "../sse/game-streams.js";
import { parseWith } from "../validation.js";

const ParamsSchema = z.object({ id: z.uuid() });
const GamesCursorSchema = z.object({ createdAt: z.int(), id: z.uuid() });

const MESSAGES = {
  not_found: "Game not found",
  game_not_active: "Game is not active",
  not_your_turn: "Not your turn",
  stale_ply: "Ply does not match the current position",
} as const;

export function registerGameRoutes(app: FastifyInstance, deps: AppDeps, gameStreams: GameStreamRegistry): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/games", async (request) => {
    const query = parseWith(GamesQuerySchema, request.query, "query");
    const after: GamesCursor | undefined =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, GamesCursorSchema);
    let agentId: string | undefined;
    if (query.agent !== undefined) {
      const found = await findAgentIdBySlug(deps.db, query.agent);
      if (found === null) throw new ApiError("not_found", "Agent not found");
      agentId = found;
    }
    const rows = await listGames(deps.db, {
      limit: query.limit + 1,
      ...(after === undefined ? {} : { after }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(agentId === undefined ? {} : { agentId }),
      ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
      ...(query.termination === undefined ? {} : { termination: query.termination }),
      ...(query.rated === undefined ? {} : { rated: query.rated }),
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    const body: GameListPage = {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ createdAt: Date.parse(last.createdAt), id: last.id })
          : null,
    };
    return body;
  });

  app.get("/v1/games/:id", { preHandler: optionalAgent(deps) }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const snapshot = await deps.service.getSnapshot(id, request.agent?.id);
    if (snapshot === null) throw new ApiError("not_found", MESSAGES.not_found);
    return snapshot;
  });

  app.get("/v1/games/:id/moves", async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const timeline = await loadGameTimeline(deps.db, id);
    if (timeline === null) throw new ApiError("not_found", MESSAGES.not_found);
    return timeline;
  });

  app.get("/v1/games/:id/pgn", async (request, reply) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const pgn = await loadGamePgn(deps.db, id);
    if (pgn === null) throw new ApiError("not_found", MESSAGES.not_found);
    return reply
      .header("content-type", "application/x-chess-pgn; charset=utf-8")
      .header("content-disposition", `attachment; filename="game-${id}.pgn"`)
      .send(pgn);
  });

  app.get("/v1/games/:id/stream", async (request, reply) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const opened = await gameStreams.open(id, reply, request.id);
    if (!opened) throw new ApiError("not_found", MESSAGES.not_found);
  });

  app.post("/v1/games/:id/move", { preHandler: [requireAgent(deps), limit] }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const body = parseWith(MoveRequestSchema, request.body, "body");
    const agent = assertAgent(request);
    const result = await deps.service.submitMove({
      gameId: id,
      agentId: agent.id,
      ply: body.ply,
      move: body.move,
      comment: body.comment ?? null,
    });
    if (result.ok) return result.snapshot;
    if (result.code === "illegal_move") {
      throw new ApiError("illegal_move", `Illegal move (${result.reason})`, {
        reason: result.reason,
        attemptsLeft: result.attemptsLeft,
        legalMoves: result.legalMoves,
      });
    }
    throw new ApiError(result.code, MESSAGES[result.code]);
  });

  app.post("/v1/games/:id/resign", { preHandler: [requireAgent(deps), limit] }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const agent = assertAgent(request);
    const result = await deps.service.resign({ gameId: id, agentId: agent.id });
    if (result.ok) return result.snapshot;
    throw new ApiError(result.code, MESSAGES[result.code]);
  });
}
