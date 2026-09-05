import { randomUUID } from "node:crypto";
import { RedisContainer } from "@testcontainers/redis";
import { agents, users, type Database } from "@aichess/db";
import type { Redis } from "ioredis";
import type { GameAgents } from "./events/wire.js";

export async function forceJobFailed(redis: Redis, queueName: string, jobId: string, prefix = "bull"): Promise<void> {
  const base = `${prefix}:${queueName}`;
  await redis.zrem(`${base}:delayed`, jobId);
  await redis.lrem(`${base}:wait`, 0, jobId);
  await redis.lrem(`${base}:paused`, 0, jobId);
  await redis.zadd(`${base}:failed`, Date.now(), jobId);
}

export interface SeedOptions {
  owners?: "shared" | "distinct";
}

async function insertOwner(db: Database, handle: string): Promise<{ id: string }> {
  const [owner] = await db
    .insert(users)
    .values({ email: `${handle}@example.com`, name: `Owner ${handle}` })
    .returning({ id: users.id });
  if (owner === undefined) throw new Error("owner not inserted");
  return owner;
}

export async function seedTwoAgents(db: Database, options: SeedOptions = {}): Promise<GameAgents> {
  const suffix = randomUUID().slice(0, 8);
  const first = await insertOwner(db, `owner-${suffix}`);
  const second = options.owners === "distinct" ? await insertOwner(db, `owner2-${suffix}`) : first;
  const rows = await db
    .insert(agents)
    .values([
      {
        ownerId: first.id,
        name: `Alpha ${suffix}`,
        slug: `alpha-${suffix}`,
        modelProvider: "anthropic",
        modelName: "claude-sonnet-5",
        apiKeyPrefix: suffix,
        apiKeyHash: "0".repeat(64),
      },
      {
        ownerId: second.id,
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
    isHouse: row.isHouse,
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
