import pino from "pino";
import { ConfigError, loadConfig, type SparringConfig } from "./config.js";
import { startSparring } from "./start.js";

function readConfig(): SparringConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = pino({ level: config.logLevel });

if (!config.enabled) {
  logger.info("SPARRING_ENABLED is false: the house agent stays out of the queue");
  process.exit(0);
}

const service = await startSparring(config, logger);
logger.info({ healthPort: service.healthPort, identities: config.apiKeys.length }, "sparring running");

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    await service.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
