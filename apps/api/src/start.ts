import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { buildApp } from "./app.js";
import type { ApiConfig } from "./config.js";
import { createDeps, type AppDeps } from "./deps.js";

export interface RunningServer {
  app: FastifyInstance;
  deps: AppDeps;
  stop: () => Promise<void>;
}

export async function startServer(config: ApiConfig, logger: Logger): Promise<RunningServer> {
  const handle = await createDeps(config, logger);
  let app: FastifyInstance | null = null;
  try {
    app = await buildApp(handle.deps);
    const rearmed = await handle.deps.service.rearmActiveDeadlines();
    logger.info({ rearmed }, "deadlines re-armed on boot");
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
  } catch (error) {
    if (app !== null) await app.close();
    await handle.close();
    throw error;
  }
  const running = app;
  let stopped = false;
  return {
    app: running,
    deps: handle.deps,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await running.close();
      await handle.close();
    },
  };
}
