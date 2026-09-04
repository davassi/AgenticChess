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

export const TEST_INTERNAL_TOKEN = "test-internal-token-0123456789abcdef0123456789abcdef";

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
  baseUrl: string;
  agents: { white: SeededAgent; black: SeededAgent };
  seedAgent: () => Promise<SeededAgent>;
  createGame: (timePerMoveMs?: number) => Promise<string>;
  reseed: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  listen?: boolean;
  register?: (app: FastifyInstance, deps: AppDeps) => void;
  owners?: "shared" | "distinct";
}

async function assignKey(db: Database, summary: GameAgents["white"]): Promise<SeededAgent> {
  const generated = generateApiKey();
  await db
    .update(agents)
    .set({ apiKeyPrefix: generated.prefix, apiKeyHash: generated.hash })
    .where(eq(agents.id, summary.id));
  return { id: summary.id, name: summary.name, slug: summary.slug, key: generated.key };
}

async function seedWithKeys(db: Database, owners: "shared" | "distinct"): Promise<Harness["agents"]> {
  const seeded: GameAgents = await seedTwoAgents(db, { owners });
  return { white: await assignKey(db, seeded.white), black: await assignKey(db, seeded.black) };
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
    INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
    ...options.env,
  });
  const handle = await createDeps(config, noopLogger);
  const app = await buildApp(handle.deps);
  options.register?.(app, handle.deps);
  await app.ready();

  let baseUrl = "";
  if (options.listen === true) {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind to a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  const harness: Harness = {
    app,
    config,
    deps: handle.deps,
    db: handle.deps.db,
    baseUrl,
    agents: await seedWithKeys(handle.deps.db, options.owners ?? "shared"),
    seedAgent: async () => {
      const extra = await seedTwoAgents(handle.deps.db);
      return assignKey(handle.deps.db, extra.white);
    },
    createGame: async (timePerMoveMs) => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: {
          whiteAgentId: harness.agents.white.id,
          blackAgentId: harness.agents.black.id,
          ...(timePerMoveMs === undefined ? {} : { timePerMoveMs }),
        },
      });
      if (res.statusCode !== 201) throw new Error(`createGame failed: ${res.statusCode} ${res.body}`);
      return (res.json() as { id: string }).id;
    },
    reseed: async () => {
      await truncateAll(handle.deps.db);
      await handle.deps.deadlines.obliterate({ force: true });
      await handle.deps.queue.clear();
      harness.agents = await seedWithKeys(handle.deps.db, options.owners ?? "shared");
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
