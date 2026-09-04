import { WireEventSchema, type WireEvent } from "@aichess/core/protocol";
import { Redis } from "ioredis";
import type { RuntimeLogger } from "../logger.js";
import type { Outgoing } from "./wire.js";

export function agentChannel(agentId: string): string {
  return `agent:${agentId}`;
}

export function gameChannel(gameId: string): string {
  return `game:${gameId}`;
}

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true, enableReadyCheck: true });
}

export interface GameParties {
  gameId: string;
  whiteAgentId: string;
  blackAgentId: string;
}

export type EventHandler = (event: WireEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  private constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly logger: RuntimeLogger,
  ) {
    this.subscriber.on("message", (channel: string, message: string) => this.dispatch(channel, message));
  }

  static async connect(url: string, logger: RuntimeLogger): Promise<EventBus> {
    const publisher = createRedis(url);
    const subscriber = createRedis(url);
    await publisher.connect();
    try {
      await subscriber.connect();
    } catch (error) {
      publisher.disconnect();
      throw error;
    }
    return new EventBus(publisher, subscriber, logger);
  }

  async publish(parties: GameParties, outgoing: Outgoing): Promise<void> {
    const pipeline = this.publisher.pipeline();
    for (const event of outgoing.toWhite) pipeline.publish(agentChannel(parties.whiteAgentId), JSON.stringify(event));
    for (const event of outgoing.toBlack) pipeline.publish(agentChannel(parties.blackAgentId), JSON.stringify(event));
    for (const event of outgoing.toPublic) pipeline.publish(gameChannel(parties.gameId), JSON.stringify(event));
    const results = await pipeline.exec();
    const failure = results?.find(([error]) => error !== null);
    if (failure !== undefined) {
      throw failure[0];
    }
  }

  subscribeAgent(agentId: string, handler: EventHandler): Promise<() => Promise<void>> {
    return this.subscribe(agentChannel(agentId), handler);
  }

  subscribeGame(gameId: string, handler: EventHandler): Promise<() => Promise<void>> {
    return this.subscribe(gameChannel(gameId), handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  private async subscribe(channel: string, handler: EventHandler): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(channel, set);
      set.add(handler);
      try {
        await this.subscriber.subscribe(channel);
      } catch (error) {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(channel);
        throw error;
      }
    } else {
      set.add(handler);
    }
    return async () => {
      const current = this.handlers.get(channel);
      if (current === undefined) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  private dispatch(channel: string, message: string): void {
    const set = this.handlers.get(channel);
    if (set === undefined || set.size === 0) return;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message);
    } catch {
      this.logger.warn({ channel }, "dropped non-JSON event");
      return;
    }
    const parsed = WireEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger.warn({ channel, issues: parsed.error.issues }, "dropped invalid event");
      return;
    }
    for (const handler of set) {
      try {
        handler(parsed.data);
      } catch (error) {
        this.logger.error({ channel, error }, "event handler failed");
      }
    }
  }
}
