import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import { openSse, type SseConnection } from "./stream.js";

export class GameStreamRegistry {
  private readonly connections = new Set<SseConnection>();

  constructor(private readonly deps: AppDeps) {}

  async open(gameId: string, reply: FastifyReply, requestId: string): Promise<boolean> {
    const snapshot = await this.deps.service.getSnapshot(gameId);
    if (snapshot === null) return false;

    const connection = openSse(reply, requestId);
    this.connections.add(connection);
    connection.onClose(() => {
      this.connections.delete(connection);
    });
    connection.send({ type: "game.snapshot", game: snapshot });

    if (snapshot.status === "finished" || snapshot.status === "aborted") {
      connection.close();
      return true;
    }

    const log = reply.log;
    const unsubscribe = await this.deps.bus.subscribeGame(gameId, (event) => {
      connection.send(event);
      if (event.type === "game.end") connection.close();
    });
    const timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
    }, this.deps.config.SSE_PING_INTERVAL_MS);
    connection.onClose(() => {
      clearInterval(timer);
      void unsubscribe().catch((error: unknown) => log.error({ err: error, gameId }, "unsubscribe failed"));
    });
    return true;
  }

  closeAll(): void {
    for (const connection of this.connections) connection.close();
    this.connections.clear();
  }
}
