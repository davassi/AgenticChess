import pino from "pino";
import { ConfigError, loadConfig } from "./config.js";
import { startServer } from "./start.js";

function readConfig(): ReturnType<typeof loadConfig> {
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
const logger = pino({ level: config.LOG_LEVEL });
const server = await startServer(config, logger);
logger.info({ port: config.API_PORT, host: config.API_HOST }, "api listening");

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
