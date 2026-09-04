import { LOBBY_MAX_ONLINE, type Lobby } from "@aichess/core/protocol";
import { loadLobby } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export function registerLobbyRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/lobby", async () => {
    const body: Lobby = await loadLobby(deps.db, deps.redis, deps.queue, LOBBY_MAX_ONLINE);
    return body;
  });
}
