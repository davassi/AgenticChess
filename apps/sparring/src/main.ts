import pino from "pino";
import { ConfigError, loadConfig, type SparringConfig } from "./config.js";
import { startIdle, startSparring } from "./start.js";

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

// Exiting here would be worse than idling: the container restarts unless it is
// stopped, and a clean exit restarts too - so the documented off switch would
// produce a container restarting for ever instead of one sitting there healthy.
const service = config.enabled ? await startSparring(config, logger) : await startIdle(config);
if (config.enabled) {
  logger.info({ healthPort: service.healthPort, identities: config.apiKeys.length }, "sparring running");
} else {
  logger.info(
    { healthPort: service.healthPort },
    config.apiKeys.length === 0
      ? "no SPARRING_API_KEY: idling, so the arena runs without a house agent"
      : "SPARRING_ENABLED is false: idling, so the house agent stays out of the queue",
  );
}

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
