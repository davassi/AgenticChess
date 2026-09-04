import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import { openSse, type SseConnection } from "./stream.js";
import { LiveBuffer, keepAfterSnapshot } from "./subscribe.js";

export class GameStreamRegistry {
  private readonly connections = new Set<SseConnection>();

  constructor(private readonly deps: AppDeps) {}

  async open(gameId: string, reply: FastifyReply, requestId: string): Promise<boolean> {
    const existing = await this.deps.service.getSnapshot(gameId);
    if (existing === null) return false;

    const connection = openSse(reply, requestId);
    this.connections.add(connection);

    const log = reply.log;
    const buffer = new LiveBuffer();
    const session: { unsubscribe?: () => Promise<void>; timer?: ReturnType<typeof setInterval> } = {};

    const cleanup = (): void => {
      this.connections.delete(connection);
      if (session.timer !== undefined) clearInterval(session.timer);
      void session.unsubscribe?.().catch((error: unknown) => log.error({ err: error, gameId }, "unsubscribe failed"));
    };
    connection.onClose(cleanup);

    session.unsubscribe = await this.deps.bus.subscribeGame(gameId, buffer.handler);
    if (connection.closed) return true;

    const snapshot = (await this.deps.service.getSnapshot(gameId)) ?? existing;
    if (connection.closed) return true;

    connection.send({ type: "game.snapshot", game: snapshot });
    if (snapshot.status === "finished" || snapshot.status === "aborted") {
      connection.close();
      return true;
    }

    buffer.takeOver(
      (event) => {
        connection.send(event);
        if (event.type === "game.end") connection.close();
      },
      (event) => keepAfterSnapshot(event, snapshot.ply),
    );

    session.timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
    }, this.deps.config.SSE_PING_INTERVAL_MS);
    if (connection.closed) clearInterval(session.timer);
    return true;
  }

  closeAll(): void {
    for (const connection of this.connections) connection.close();
    this.connections.clear();
  }
}
