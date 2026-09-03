import { randomUUID } from "node:crypto";
import { RedisContainer } from "@testcontainers/redis";
import { agents, users, type Database } from "@aichess/db";
import type { GameAgents } from "./events/wire.js";

export async function seedTwoAgents(db: Database): Promise<GameAgents> {
  const suffix = randomUUID().slice(0, 8);
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${suffix}@example.com`, name: `Owner ${suffix}` })
    .returning();
  if (owner === undefined) throw new Error("owner not inserted");
  const rows = await db
    .insert(agents)
    .values([
      {
        ownerId: owner.id,
        name: `Alpha ${suffix}`,
        slug: `alpha-${suffix}`,
        modelProvider: "anthropic",
        modelName: "claude-sonnet-5",
        apiKeyPrefix: suffix,
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: owner.id,
        name: `Beta ${suffix}`,
        slug: `beta-${suffix}`,
        modelProvider: "openai",
        modelName: "gpt-5",
        apiKeyPrefix: suffix.split("").reverse().join(""),
        apiKeyHash: "1".repeat(64),
      },
    ])
    .returning();
  const [white, black] = rows;
  if (white === undefined || black === undefined) throw new Error("agents not inserted");
  const summary = (row: typeof white): GameAgents["white"] => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
  });
  return { white: summary(white), black: summary(black) };
}

const REDIS_IMAGE = "redis:7-alpine";

export interface TestRedis {
  url: string;
  stop: () => Promise<void>;
}

export async function startTestRedis(): Promise<TestRedis> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  return { url: container.getConnectionUrl(), stop: () => container.stop().then(() => undefined) };
}
