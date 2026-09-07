import type { ArenaStats } from "@aichess/core/protocol";
import { arenaStats } from "@aichess/db";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export function registerStatsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/stats", async () => {
    const body: ArenaStats = await arenaStats(deps.db);
    return body;
  });
}
