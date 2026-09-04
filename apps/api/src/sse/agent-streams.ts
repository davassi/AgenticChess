import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import type { AuthenticatedAgent } from "../plugins/auth.js";
import { clearPresent, isPresent, markPresent } from "./presence.js";
import { openSse, type SseConnection } from "./stream.js";
import { LiveBuffer, keepAfterHello } from "./subscribe.js";

export { presenceKeyFor } from "./presence.js";

interface ActiveStream {
  connection: SseConnection;
}

export class AgentStreamRegistry {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly instanceId = randomUUID();

  constructor(private readonly deps: AppDeps) {}

  async open(agent: AuthenticatedAgent, reply: FastifyReply, requestId: string): Promise<void> {
    this.streams.get(agent.id)?.connection.close();

    const connection = openSse(reply, requestId);
    const active: ActiveStream = { connection };
    this.streams.set(agent.id, active);

    const log = reply.log;
    const buffer = new LiveBuffer();
    const session: { unsubscribe?: () => Promise<void>; timer?: ReturnType<typeof setInterval> } = {};

    const refreshPresence = async (): Promise<void> => {
      try {
        await markPresent(this.deps.redis, agent.id, this.instanceId, this.deps.config.PRESENCE_TTL_SECONDS);
      } catch (error) {
        log.error({ err: error, agentId: agent.id }, "presence refresh failed");
      }
    };

    const cleanup = (): void => {
      if (session.timer !== undefined) clearInterval(session.timer);
      void session
        .unsubscribe?.()
        .catch((error: unknown) => log.error({ err: error, agentId: agent.id }, "unsubscribe failed"));
      if (this.streams.get(agent.id) !== active) return;
      this.streams.delete(agent.id);
      void clearPresent(this.deps.redis, agent.id, this.instanceId).catch((error: unknown) =>
        log.error({ err: error, agentId: agent.id }, "presence delete failed"),
      );
    };
    connection.onClose(cleanup);

    session.unsubscribe = await this.deps.bus.subscribeAgent(agent.id, buffer.handler);
    if (connection.closed) return;

    await refreshPresence();
    if (connection.closed) return;

    try {
      const activeGame = await this.deps.service.activeGameFor(agent.id);
      if (connection.closed) return;
      connection.send({ type: "hello", agentId: agent.id, activeGame });
      const turn = await this.deps.service.yourTurnFor(agent.id);
      if (connection.closed) return;
      if (turn !== null) connection.send(turn);
      buffer.takeOver(
        (event) => connection.send(event),
        (event) => keepAfterHello(event, activeGame),
      );
    } catch (error) {
      log.error({ err: error, agentId: agent.id }, "hello failed");
      connection.close();
      return;
    }

    session.timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
      void refreshPresence();
    }, this.deps.config.SSE_PING_INTERVAL_MS);
    if (connection.closed) clearInterval(session.timer);
  }

  async isOnline(agentId: string): Promise<boolean> {
    return isPresent(this.deps.redis, agentId);
  }

  closeAll(): void {
    for (const stream of this.streams.values()) stream.connection.close();
    this.streams.clear();
  }
}
