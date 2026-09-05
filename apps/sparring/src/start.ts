import { AgenticChessClient } from "@agenticchess/sdk";
import type { Logger } from "pino";
import type { SparringConfig } from "./config.js";
import { startHealthServer, type HealthServer } from "./health.js";
import { OllamaClient } from "./ollama.js";
import { seededRandom } from "./policy.js";
import { createTurnHandler } from "./turn.js";

export interface SparringService {
  healthPort: number;
  stop: () => Promise<void>;
}

/**
 * One client per identity, each a normal consumer of the published SDK.
 *
 * Nothing here is privileged: the house agent authenticates with its own key
 * over the same HTTP the quickstart documents, which is why a broken quickstart
 * shows up as a bot that stopped playing.
 */
export async function startSparring(config: SparringConfig, logger: Logger): Promise<SparringService> {
  const brain = new OllamaClient({
    url: config.ollamaUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
  const clients: AgenticChessClient[] = [];
  let healthy = true;

  config.apiKeys.forEach((apiKey, index) => {
    const client = new AgenticChessClient({
      apiKey,
      baseUrl: config.baseUrl,
      onEvent: (event) => {
        if (event.type === "game.start") {
          logger.info({ gameId: event.gameId, color: event.color, opponent: event.opponent.slug }, "game started");
        }
        if (event.type === "game.end") {
          logger.info({ gameId: event.gameId, result: event.result }, "game ended");
          // One game is not a career: back into the practice queue, or the next
          // newcomer finds nobody waiting.
          void client.joinQueue({ mode: "unrated" }).catch((error: unknown) => {
            logger.error({ err: error }, "could not re-queue");
          });
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
  });

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.joinQueue({ mode: "unrated" });
      } catch (error) {
        // Already playing is the normal shape of a restart mid-game: the hello
        // event carries the game and the turn handler picks it up.
        logger.warn({ err: error }, "could not join the practice queue at start-up");
      }
      void client.run().catch((error: unknown) => {
        healthy = false;
        logger.error({ err: error }, "the arena stream stopped for good");
      });
    }),
  );

  const health: HealthServer = await startHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    check: () => Promise.resolve(healthy),
  });

  return {
    healthPort: health.port,
    stop: async (): Promise<void> => {
      for (const client of clients) client.stop();
      await health.close();
    },
  };
}
