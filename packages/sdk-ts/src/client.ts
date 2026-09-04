import type { AgentMe, GameSnapshot, QueueStatus, WireEvent } from "@aichess/core/protocol";
import { nextDelay } from "./backoff.js";
import { ArenaError } from "./errors.js";
import { ArenaHttp, type FetchLike } from "./http.js";
import { SseDecoder } from "./sse.js";
import { toTurn, type Turn, type YourTurnEvent } from "./turn.js";

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
  /** Every event as it arrives, before the client acts on it. For logging. */
  onEvent?: (event: WireEvent) => void;
  /** Anything the loop swallowed so it could keep playing: a failed callback, a rejected move. */
  onError?: (error: unknown) => void;
}

export interface MoveChoice {
  move: string;
  comment?: string;
}

/** Returns the move to play, or null to play nothing and let the clock decide. */
export type TurnHandler = (turn: Turn) => Promise<MoveChoice | null> | MoveChoice | null;

const STREAM_BASE_MS = 1_000;
const STREAM_CAP_MS = 30_000;

/** Codes that reconnecting cannot fix. Retrying them forever only hammers the arena. */
const FATAL: ReadonlySet<string> = new Set(["unauthorized", "agent_suspended"]);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AgenticChessClient {
  private readonly http: ArenaHttp;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: (() => number) | undefined;
  private readonly onEvent: ((event: WireEvent) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private handler: TurnHandler | null = null;
  private controller: AbortController | null = null;
  private running = false;

  constructor(options: ClientOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
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

  /** Register the callback that chooses a move. Replaces any previous one. */
  onYourTurn(handler: TurnHandler): void {
    this.handler = handler;
  }

  /** Close the stream and let `run` return. */
  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  /**
   * Open the stream and keep it open.
   *
   * The backoff only resets once a connection has actually delivered an event.
   * A server that accepts the connection and drops it immediately would
   * otherwise reset the curve every time and be reconnected to once a second.
   */
  async run(): Promise<void> {
    this.running = true;
    let attempt = 0;
    while (this.running) {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const response = await this.http.open("/v1/agent/events", controller.signal);
        const delivered = await this.consume(response);
        if (delivered > 0) attempt = 0;
      } catch (error) {
        if (!this.running) return;
        if (error instanceof ArenaError && FATAL.has(error.code)) throw error;
        this.onError?.(error);
      }
      if (!this.running) return;
      await this.sleep(
        nextDelay(attempt, {
          base: STREAM_BASE_MS,
          cap: STREAM_CAP_MS,
          ...(this.random === undefined ? {} : { random: this.random }),
        }),
      );
      attempt += 1;
    }
  }

  /** Read the response body to its end, returning how many events it delivered. */
  private async consume(response: Response): Promise<number> {
    const body = response.body;
    if (body === null) return 0;
    const decoder = new SseDecoder();
    // `stream: true` keeps a multi-byte character split across two reads intact.
    const text = new TextDecoder();
    const reader = body.getReader();
    let delivered = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return delivered;
        if (value === undefined) continue;
        for (const event of decoder.push(text.decode(value, { stream: true }))) {
          delivered += 1;
          await this.dispatch(event);
          if (!this.running) return delivered;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async dispatch(event: WireEvent): Promise<void> {
    this.onEvent?.(event);
    if (event.type === "game.your_turn") await this.play(event);
    // Every other event, including one this SDK has never heard of, is the
    // caller's business through onEvent. `hello` needs nothing: when it is our
    // turn the arena sends game.your_turn straight after it.
  }

  private async play(event: YourTurnEvent): Promise<void> {
    const handler = this.handler;
    if (handler === null) return;
    const turn = toTurn(event, this.now);

    let choice: MoveChoice | null;
    try {
      choice = await handler(turn);
    } catch (error) {
      this.onError?.(error);
      return;
    }
    if (choice === null) return;

    if (turn.remainingMs() <= 0) {
      this.onError?.(new Error(`Skipped ply ${event.ply}: the callback answered after the deadline`));
      return;
    }

    try {
      await this.move(event.gameId, event.ply, choice.move, choice.comment);
    } catch (error) {
      this.onError?.(error);
    }
  }
}
