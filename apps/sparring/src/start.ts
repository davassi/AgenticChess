import { AgenticChessClient } from "@agenticchess/sdk";
import type { Logger } from "pino";
import type { SparringConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "@aichess/health";
import { OllamaClient } from "./ollama.js";
import { seededRandom } from "./policy.js";
import { QueueKeeper } from "./queue-keeper.js";
import { createTurnHandler } from "./turn.js";

export interface SparringService {
  healthPort: number;
  stop: () => Promise<void>;
}

/** How stale a queue confirmation may be before the service calls itself degraded. */
const PRESENCE_GRACE = 3;

/**
 * One client per identity, each a normal consumer of the published SDK.
 *
 * Nothing here is privileged: the house agent authenticates with its own key
 * over the same HTTP the quickstart documents, which is why a broken quickstart
 * shows up as a bot that stopped playing.
 *
 * With no key, or with the switch off, the process stays up and idle rather
 * than exiting: the container is set to restart unless stopped, so exiting -
 * even successfully - would leave it restarting for ever instead of sitting
 * there healthy and out of the way.
 */
export async function startSparring(config: SparringConfig, logger: Logger): Promise<SparringService> {
  const brain = new OllamaClient({
    url: config.ollamaUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
  const clients: AgenticChessClient[] = [];
  const keepers: QueueKeeper[] = [];
  let streamsAlive = true;

  config.apiKeys.forEach((apiKey, index) => {
    // The keeper needs the client and the client's event handler needs the
    // keeper. The delegating call is evaluated when an event arrives, by which
    // point both exist, so neither has to be reassignable.
    const keeper = new QueueKeeper({
      client: { joinQueue: (options) => client.joinQueue(options) },
      logger,
    });
    const client = new AgenticChessClient({
      apiKey,
      baseUrl: config.baseUrl,
      onEvent: (event) => {
        if (event.type === "game.start") {
          logger.info({ gameId: event.gameId, color: event.color, opponent: event.opponent.slug }, "game started");
        }
        if (event.type === "game.end") {
          logger.info({ gameId: event.gameId, result: event.result }, "game ended");
        }
        if (keeper.observe(event)) {
          void keeper.ensureQueued();
        }
      },
      onError: (error) => {
        logger.warn({ err: error }, "recovered");
      },
    });
    client.onYourTurn(
      createTurnHandler({
        brain,
        fallback: config.fallback,
        // A different stream per identity, so two house agents in the same
        // position do not play the same fallback move.
        random: seededRandom(config.seed + index),
        label: config.model,
        onDecision: ({ source, san }) => {
          logger.info({ source, san }, "move chosen");
        },
      }),
    );
    clients.push(client);
    keepers.push(keeper);
  });

  await Promise.all(keepers.map((keeper) => keeper.ensureQueued()));
  for (const client of clients) {
    void client.run().catch((error: unknown) => {
      streamsAlive = false;
      logger.error({ err: error }, "the arena stream stopped for good");
    });
  }

  // The safety net under the `hello` handler: whatever took the house out of
  // the queue, this puts it back within a sweep. joinQueue is idempotent, so
  // the usual case costs one request that changes nothing.
  const sweep = setInterval(() => {
    for (const keeper of keepers) void keeper.ensureQueued();
  }, config.presenceSweepMs);
  sweep.unref();

  const health: HealthServer = await startHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    // Alive is not the same as working: an agent that has silently fallen out
    // of the practice queue leaves newcomers with no opponent, which is the
    // whole point of this service.
    check: () =>
      Promise.resolve(
        streamsAlive && keepers.every((keeper) => keeper.isPresent(config.presenceSweepMs * PRESENCE_GRACE)),
      ),
  });

  return {
    healthPort: health.port,
    stop: async (): Promise<void> => {
      clearInterval(sweep);
      for (const client of clients) client.stop();
      await health.close();
    },
  };
}

/** The health server alone, for when the service is configured off. */
export async function startIdle(config: SparringConfig): Promise<SparringService> {
  const health = await startHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    check: () => Promise.resolve(true),
  });
  return { healthPort: health.port, stop: () => health.close() };
}
