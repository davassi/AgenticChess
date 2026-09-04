import type { AgentMe, GameSnapshot, QueueStatus } from "@aichess/core/protocol";
import { ArenaError } from "./errors.js";
import { ArenaHttp, type FetchLike } from "./http.js";

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Defaults to the global fetch. Injected so tests never touch a network. */
  fetch?: FetchLike;
  /** Defaults to setTimeout. Injected so tests never wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to Date.now. Injected so the deadline is testable. */
  now?: () => number;
  /** Defaults to Math.random, used only for backoff jitter. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AgenticChessClient {
  protected readonly http: ArenaHttp;
  protected readonly now: () => number;
  protected readonly sleep: (ms: number) => Promise<void>;
  protected readonly random: (() => number) | undefined;

  constructor(options: ClientOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random;
    this.http = new ArenaHttp({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetch ?? fetch,
      sleep: this.sleep,
      ...(options.random === undefined ? {} : { random: options.random }),
    });
  }

  async me(): Promise<AgentMe> {
    return this.http.requestJson<AgentMe>("GET", "/v1/agent/me");
  }

  /**
   * Join the rated queue.
   *
   * A join whose response was lost is retried by the HTTP layer and comes back
   * as `already_in_queue`. That is the same outcome the caller asked for, so it
   * is resolved by reading the real state rather than raised as a failure - but
   * only if the arena confirms we are queued.
   */
  async joinQueue(): Promise<QueueStatus> {
    try {
      return await this.http.requestJson<QueueStatus>("POST", "/v1/agent/queue");
    } catch (error) {
      if (!(error instanceof ArenaError) || error.code !== "already_in_queue") throw error;
      const me = await this.me();
      if (me.queue === null) throw error;
      return me.queue;
    }
  }

  /** Leave the queue. Leaving when not queued is not an error: the end state is the same. */
  async leaveQueue(): Promise<QueueStatus | null> {
    try {
      return await this.http.requestJson<QueueStatus>("DELETE", "/v1/agent/queue");
    } catch (error) {
      if (error instanceof ArenaError && error.code === "not_in_queue") return null;
      throw error;
    }
  }

  async game(id: string): Promise<GameSnapshot> {
    return this.http.requestJson<GameSnapshot>("GET", `/v1/games/${id}`);
  }

  async move(gameId: string, ply: number, move: string, comment?: string): Promise<GameSnapshot> {
    return this.http.requestJson<GameSnapshot>("POST", `/v1/games/${gameId}/move`, {
      ply,
      move,
      ...(comment === undefined ? {} : { comment }),
    });
  }

  async resign(gameId: string): Promise<GameSnapshot> {
    return this.http.requestJson<GameSnapshot>("POST", `/v1/games/${gameId}/resign`);
  }
}
