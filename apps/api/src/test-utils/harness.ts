import { generateApiKey } from "@aichess/core";
import { agents, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { noopLogger, type GameAgents } from "@aichess/runtime";
import { seedTwoAgents, startTestRedis, type TestRedis } from "@aichess/runtime/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig, type ApiConfig } from "../config.js";
import { createDeps, type AppDeps } from "../deps.js";

export interface SeededAgent {
  id: string;
  name: string;
  slug: string;
  key: string;
}

export interface Harness {
  app: FastifyInstance;
  config: ApiConfig;
  deps: AppDeps;
  db: Database;
  agents: { white: SeededAgent; black: SeededAgent };
  reseed: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  register?: (app: FastifyInstance, deps: AppDeps) => void;
}

async function seedWithKeys(db: Database): Promise<Harness["agents"]> {
  const seeded: GameAgents = await seedTwoAgents(db);
  const withKey = async (summary: GameAgents["white"]): Promise<SeededAgent> => {
    const generated = generateApiKey();
    await db
      .update(agents)
      .set({ apiKeyPrefix: generated.prefix, apiKeyHash: generated.hash })
      .where(eq(agents.id, summary.id));
    return { id: summary.id, name: summary.name, slug: summary.slug, key: generated.key };
  };
  return { white: await withKey(seeded.white), black: await withKey(seeded.black) };
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const tdb: TestDatabase = await startTestDatabase();
  const redis: TestRedis = await startTestRedis();
  const config = loadConfig({
    DATABASE_URL: tdb.url,
    REDIS_URL: redis.url,
    LOG_LEVEL: "silent",
    SSE_PING_INTERVAL_MS: "1000",
    PRESENCE_TTL_SECONDS: "5",
    ...options.env,
  });
  const handle = await createDeps(config, noopLogger);
  const app = await buildApp(handle.deps);
  options.register?.(app, handle.deps);
  await app.ready();
  const harness: Harness = {
    app,
    config,
    deps: handle.deps,
    db: handle.deps.db,
    agents: await seedWithKeys(handle.deps.db),
    reseed: async () => {
      await truncateAll(handle.deps.db);
      await handle.deps.deadlines.obliterate({ force: true });
      harness.agents = await seedWithKeys(handle.deps.db);
    },
    stop: async () => {
      await app.close();
      await handle.close();
      await redis.stop();
      await tdb.stop();
    },
  };
  return harness;
}
