import { DEFAULT_GAME_CONFIG, type WireEvent } from "@aichess/core/protocol";
import { ratings } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameAgents } from "../events/wire.js";
import { noopLogger } from "../logger.js";
import { createRuntime, type RuntimeHandle } from "../runtime.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { MatchmakingService, toQueueStatus } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("MatchmakingService", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let runtime: RuntimeHandle;
  let agents: GameAgents;
  let clock: number;
  let service: MatchmakingService;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    runtime = await createRuntime({ databaseUrl: tdb.url, redisUrl: redis.url, game: DEFAULT_GAME_CONFIG }, noopLogger);
  });

  afterAll(async () => {
    await runtime.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(runtime.db);
    await runtime.queue.clear();
    await runtime.deadlines.obliterate({ force: true });
    agents = await seedTwoAgents(runtime.db, { owners: "distinct" });
    clock = T0;
    service = new MatchmakingService({
      db: runtime.db,
      queue: runtime.queue,
      bus: runtime.bus,
      logger: noopLogger,
      now: () => clock,
    });
  });

  it("joins, publishes queue.joined and refuses a second join", async () => {
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    // The count travels with the join result, not only in the event: an agent
    // that never opens the stream still has to be able to tell an empty queue
    // from an impossible one.
    expect(await service.join(agents.white.id)).toEqual({ ok: true, queuedAt: T0, mode: "rated", opponents: 0 });
    clock = T0 + 1_000;
    expect(await service.join(agents.white.id)).toEqual({ ok: false, code: "already_in_queue" });
    expect(await service.status(agents.white.id)).toEqual({ queuedAt: T0, mode: "rated" });
    expect(await runtime.queue.entries("rated")).toEqual([
      { agentId: agents.white.id, rating: 1500, queuedAt: T0, mode: "rated" },
    ]);
    await waitFor(() => events.length === 1);
    expect(events[0]).toEqual({
      type: "queue.joined",
      queuedAt: new Date(T0).toISOString(),
      mode: "rated",
      opponents: 0,
    });
    await off();
  });

  it("tells a joining agent how many of the waiting agents it may face", async () => {
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    await service.join(agents.black.id);
    await service.join(agents.white.id);
    await waitFor(() => events.length === 1);
    expect(events[0]).toEqual({
      type: "queue.joined",
      queuedAt: new Date(T0).toISOString(),
      mode: "rated",
      opponents: 1,
    });
    await off();
  });

  it("reports nobody to face when the only other agent shares its owner", async () => {
    // The anti-self-play rule is invisible from inside the queue: both agents
    // wait, both are online, neither is ever paired, and nothing reports a
    // problem. Zero is what separates that from a queue that is merely quiet.
    agents = await seedTwoAgents(runtime.db, {});
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    await service.join(agents.black.id);
    await service.join(agents.white.id);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ type: "queue.joined", opponents: 0 });
    await off();
  });

  it("counts an agent sharing its owner once the queue is the unrated one", async () => {
    agents = await seedTwoAgents(runtime.db, {});
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    await service.join(agents.black.id, "unrated");
    await service.join(agents.white.id, "unrated");
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ type: "queue.joined", mode: "unrated", opponents: 1 });
    await off();
  });

  it("uses the stored rating as the queue score", async () => {
    await runtime.db.insert(ratings).values({ agentId: agents.black.id, rating: 1720.5, rd: 60, volatility: 0.06 });
    expect((await service.join(agents.black.id)).ok).toBe(true);
    expect(await runtime.queue.entries("rated")).toEqual([
      { agentId: agents.black.id, rating: 1720.5, queuedAt: T0, mode: "rated" },
    ]);
  });

  it("refuses an agent that is playing", async () => {
    const created = await runtime.service.createAndStartGame({
      whiteAgentId: agents.white.id,
      blackAgentId: agents.black.id,
    });
    expect(created.ok).toBe(true);
    expect(await service.join(agents.white.id)).toEqual({ ok: false, code: "in_active_game" });
    expect(await runtime.queue.size("rated")).toBe(0);
  });

  it("leaves, publishes queue.left and refuses a second leave", async () => {
    const events: WireEvent[] = [];
    const off = await runtime.bus.subscribeAgent(agents.white.id, (e) => events.push(e));
    await service.join(agents.white.id);
    clock = T0 + 5_000;
    expect(await service.leave(agents.white.id)).toEqual({ ok: true, queuedAt: T0, mode: "rated" });
    expect(await service.leave(agents.white.id)).toEqual({ ok: false, code: "not_in_queue" });
    expect(await service.status(agents.white.id)).toBeNull();
    await waitFor(() => events.length === 2);
    expect(events.map((e) => e.type)).toEqual(["queue.joined", "queue.left"]);
    expect(events[1]).toEqual({ type: "queue.left", queuedAt: new Date(T0).toISOString(), mode: "rated" });
    await off();
  });

  it("formats a membership for the wire", () => {
    expect(toQueueStatus({ queuedAt: T0, mode: "unrated" })).toEqual({
      queuedAt: "2026-09-03T10:00:00.000Z",
      mode: "unrated",
    });
  });
});
