import { presenceKeyFor, toQueueStatus } from "@aichess/runtime";
import type { FastifyReply } from "fastify";
import type { AppDeps } from "../deps.js";
import type { AuthenticatedAgent } from "../plugins/auth.js";
import { openSse, type SseConnection } from "./stream.js";

interface ActiveStream {
  connection: SseConnection;
}

export class AgentStreamRegistry {
  private readonly streams = new Map<string, ActiveStream>();

  constructor(private readonly deps: AppDeps) {}

  async open(agent: AuthenticatedAgent, reply: FastifyReply, requestId: string): Promise<void> {
    this.streams.get(agent.id)?.connection.close();

    const connection = openSse(reply, requestId);
    const active: ActiveStream = { connection };
    this.streams.set(agent.id, active);

    const log = reply.log;
    const key = presenceKeyFor(agent.id);
    const refreshPresence = async (): Promise<void> => {
      try {
        await this.deps.redis.set(key, "1", "EX", this.deps.config.PRESENCE_TTL_SECONDS);
      } catch (error) {
        log.error({ err: error, agentId: agent.id }, "presence refresh failed");
      }
    };

    const unsubscribe = await this.deps.bus.subscribeAgent(agent.id, (event) => {
      connection.send(event);
    });
    const timer = setInterval(() => {
      connection.send({ type: "ping", at: new Date().toISOString() });
      void refreshPresence();
    }, this.deps.config.SSE_PING_INTERVAL_MS);

    connection.onClose(() => {
      clearInterval(timer);
      void unsubscribe().catch((error: unknown) => log.error({ err: error, agentId: agent.id }, "unsubscribe failed"));
      if (this.streams.get(agent.id) === active) {
        this.streams.delete(agent.id);
        void this.deps.redis
          .del(key)
          .catch((error: unknown) => log.error({ err: error, agentId: agent.id }, "presence delete failed"));
      }
    });

    await refreshPresence();
    try {
      const [activeGame, queue] = await Promise.all([
        this.deps.service.activeGameFor(agent.id),
        this.deps.matchmaking.status(agent.id),
      ]);
      connection.send({
        type: "hello",
        agentId: agent.id,
        activeGame,
        queue: queue === null ? null : toQueueStatus(queue),
      });
      const turn = await this.deps.service.yourTurnFor(agent.id);
      if (turn !== null) connection.send(turn);
    } catch (error) {
      log.error({ err: error, agentId: agent.id }, "hello failed");
      connection.close();
    }
  }

  async isOnline(agentId: string): Promise<boolean> {
    return (await this.deps.redis.exists(presenceKeyFor(agentId))) === 1;
  }

  closeAll(): void {
    for (const stream of this.streams.values()) stream.connection.close();
    this.streams.clear();
  }
}
