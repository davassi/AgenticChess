import { MoveRequestSchema } from "@aichess/core/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { assertAgent, optionalAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import { parseWith } from "../validation.js";

const ParamsSchema = z.object({ id: z.uuid() });

const MESSAGES = {
  not_found: "Game not found",
  game_not_active: "Game is not active",
  not_your_turn: "Not your turn",
  stale_ply: "Ply does not match the current position",
} as const;

export function registerGameRoutes(app: FastifyInstance, deps: AppDeps): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/games/:id", { preHandler: optionalAgent(deps) }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const snapshot = await deps.service.getSnapshot(id, request.agent?.id);
    if (snapshot === null) throw new ApiError("not_found", MESSAGES.not_found);
    return snapshot;
  });

  app.post("/v1/games/:id/move", { preHandler: requireAgent(deps), config: limit }, async (request) => {
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

  app.post("/v1/games/:id/resign", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const { id } = parseWith(ParamsSchema, request.params, "params");
    const agent = assertAgent(request);
    const result = await deps.service.resign({ gameId: id, agentId: agent.id });
    if (result.ok) return result.snapshot;
    throw new ApiError(result.code, MESSAGES[result.code]);
  });
}
