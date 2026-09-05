import { ArenaError, type WireEvent } from "@agenticchess/sdk";

export interface QueueClient {
  joinQueue: (options: { mode: "unrated" }) => Promise<unknown>;
}

export interface QueueKeeperDeps {
  client: QueueClient;
  logger: { info: (fields: object, message: string) => void; error: (fields: object, message: string) => void };
  now?: () => number;
}

/**
 * Keeps the house agent in the practice queue.
 *
 * Joining once at start-up is not enough, and this is the arena's own doing:
 * the API deletes an agent's presence key the moment its stream closes, and the
 * matchmaker drops any queued agent that has been absent for longer than the
 * offline grace. So an API restart, a container recycle or a dropped proxy
 * connection takes the house out of the queue - and the client reconnects into
 * an arena where nobody is waiting, with nothing to notice it.
 *
 * Two things put it back. The `hello` event the arena writes on every
 * connection says whether we are queued and whether we are playing, which
 * covers the reconnect exactly. The caller's periodic sweep covers everything
 * else, whatever the cause, because `joinQueue` is idempotent.
 */
export class QueueKeeper {
  private inGame = false;
  private confirmedAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: QueueKeeperDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** Updates what we believe, and answers whether the caller should re-join now. */
  observe(event: WireEvent): boolean {
    switch (event.type) {
      case "hello":
        this.inGame = event.activeGame !== null;
        this.confirmedAt = event.queue === null ? null : this.now();
        // Reconnected into an arena that has forgotten us: nothing else will
        // put the house back, because no game is going to end.
        return !this.inGame && event.queue === null;
      case "game.start":
        this.inGame = true;
        this.confirmedAt = null;
        return false;
      case "game.end":
        // One game is not a career: back into the queue, or the next newcomer
        // finds nobody waiting.
        this.inGame = false;
        this.confirmedAt = null;
        return true;
      default:
        return false;
    }
  }

  async ensureQueued(): Promise<void> {
    if (this.inGame) return;
    try {
      await this.deps.client.joinQueue({ mode: "unrated" });
      this.confirmedAt = this.now();
    } catch (error) {
      // The arena and this object disagreed about a game being under way. It
      // is right and we are wrong, so believe it rather than hammering the
      // endpoint until the game ends.
      if (error instanceof ArenaError && error.code === "in_active_game") {
        this.inGame = true;
        return;
      }
      this.deps.logger.error({ err: error }, "could not join the practice queue");
    }
  }

  /**
   * Whether the house is doing its job: playing, or known to be waiting
   * recently enough to still be believed.
   *
   * This is what the health endpoint reports. An agent that has silently
   * fallen out of the queue is not healthy, however alive its process is.
   */
  isPresent(freshnessMs: number): boolean {
    if (this.inGame) return true;
    return this.confirmedAt !== null && this.now() - this.confirmedAt <= freshnessMs;
  }
}
