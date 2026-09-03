import { keysMatch } from "@aichess/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseWith } from "../validation.js";

const CreateGameBodySchema = z.object({
  whiteAgentId: z.uuid(),
  blackAgentId: z.uuid(),
  timePerMoveMs: z.int().min(1_000).max(3_600_000).optional(),
});

export function registerInternalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const token = deps.config.INTERNAL_API_TOKEN;
  if (token === undefined) return;

  app.post("/v1/internal/games", { config: { rateLimit: false } }, async (request, reply) => {
    const provided = request.headers["x-internal-token"];
    if (typeof provided !== "string" || !keysMatch(provided, token)) {
      throw new ApiError("unauthorized", "Invalid internal token");
    }
    const body = parseWith(CreateGameBodySchema, request.body, "body");
    const result = await deps.service.createAndStartGame({
      whiteAgentId: body.whiteAgentId,
      blackAgentId: body.blackAgentId,
      ...(body.timePerMoveMs === undefined ? {} : { config: { timePerMoveMs: body.timePerMoveMs } }),
    });
    if (!result.ok) throw new ApiError("not_found", "One or both agents do not exist");
    return reply.status(201).send(result.snapshot);
  });
}
