import { randomUUID } from "node:crypto";
import type { WireEvent } from "@aichess/core/protocol";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeLogger } from "../logger.js";
import { startTestRedis, type TestRedis } from "../testing.js";
import { EventBus, agentChannel, gameChannel } from "./bus.js";

function ping(at: string): WireEvent {
  return { type: "ping", at };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("EventBus", () => {
  let redis: TestRedis;
  let logger: RuntimeLogger;
  let bus: EventBus;

  beforeAll(async () => {
    redis = await startTestRedis();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bus = await EventBus.connect(redis.url, logger);
  });

  afterAll(async () => {
    await bus.close();
    await redis.stop();
  });

  it("names channels by recipient", () => {
    expect(agentChannel("a1")).toBe("agent:a1");
    expect(gameChannel("g1")).toBe("game:g1");
  });

  it("routes each recipient list to its own channel, in order", async () => {
    const parties = { gameId: randomUUID(), whiteAgentId: randomUUID(), blackAgentId: randomUUID() };
    const white: WireEvent[] = [];
    const black: WireEvent[] = [];
    const pub: WireEvent[] = [];
    const offWhite = await bus.subscribeAgent(parties.whiteAgentId, (e) => white.push(e));
    const offBlack = await bus.subscribeAgent(parties.blackAgentId, (e) => black.push(e));
    const offPublic = await bus.subscribeGame(parties.gameId, (e) => pub.push(e));

    await bus.publish(parties, {
      toWhite: [ping("2026-01-01T00:00:00.000Z"), ping("2026-01-01T00:00:01.000Z")],
      toBlack: [ping("2026-01-01T00:00:02.000Z")],
      toPublic: [ping("2026-01-01T00:00:03.000Z")],
    });

    await waitFor(() => white.length === 2 && black.length === 1 && pub.length === 1);
    expect(white.map((e) => (e.type === "ping" ? e.at : ""))).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z",
    ]);
    expect(black[0]).toEqual(ping("2026-01-01T00:00:02.000Z"));
    expect(pub[0]).toEqual(ping("2026-01-01T00:00:03.000Z"));

    await offWhite();
    await offBlack();
    await offPublic();
  });

  it("stops delivering after unsubscribe and keeps other handlers alive", async () => {
    const gameId = randomUUID();
    const first: WireEvent[] = [];
    const second: WireEvent[] = [];
    const offFirst = await bus.subscribeGame(gameId, (e) => first.push(e));
    const offSecond = await bus.subscribeGame(gameId, (e) => second.push(e));
    const parties = { gameId, whiteAgentId: randomUUID(), blackAgentId: randomUUID() };

    await bus.publish(parties, { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:00.000Z")] });
    await waitFor(() => first.length === 1 && second.length === 1);

    await offFirst();
    await bus.publish(parties, { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:01.000Z")] });
    await waitFor(() => second.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(first).toHaveLength(1);
    await offSecond();
  });

  it("drops malformed messages with a warning", async () => {
    const gameId = randomUUID();
    const received: WireEvent[] = [];
    const off = await bus.subscribeGame(gameId, (e) => received.push(e));
    const raw = new Redis(redis.url);
    await raw.publish(gameChannel(gameId), "{not json");
    await raw.publish(gameChannel(gameId), JSON.stringify({ type: "game.nope" }));
    await raw.publish(gameChannel(gameId), JSON.stringify(ping("2026-01-01T00:00:00.000Z")));
    await waitFor(() => received.length === 1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await raw.quit();
    await off();
  });

  it("isolates a throwing handler", async () => {
    const gameId = randomUUID();
    const received: WireEvent[] = [];
    const offBad = await bus.subscribeGame(gameId, () => {
      throw new Error("boom");
    });
    const offGood = await bus.subscribeGame(gameId, (e) => received.push(e));
    await bus.publish(
      { gameId, whiteAgentId: randomUUID(), blackAgentId: randomUUID() },
      { toWhite: [], toBlack: [], toPublic: [ping("2026-01-01T00:00:00.000Z")] },
    );
    await waitFor(() => received.length === 1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ channel: gameChannel(gameId) }),
      "event handler failed",
    );
    await offBad();
    await offGood();
  });
});
